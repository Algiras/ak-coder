import * as fs from 'fs';
import * as path from 'path';

// Types for Winston compatibility
export interface LogInfo {
  level: string;
  message: string;
  timestamp?: string;
  [key: string]: any;
}

export type LogFormatFn = (info: LogInfo) => string;

export interface LogFormat {
  transform: (info: LogInfo) => LogInfo | string | boolean;
}

// Fallback Format Implementations
const formatCombine = (...formats: LogFormat[]): LogFormat => {
  return {
    transform: (info: LogInfo) => {
      let currentInfo: any = { ...info };
      for (const format of formats) {
        const result = format.transform(currentInfo);
        if (result === false) return false;
        if (typeof result === 'string') {
          return result;
        }
        currentInfo = result;
      }
      return currentInfo;
    }
  };
};

const formatTimestamp = (): LogFormat => {
  return {
    transform: (info: LogInfo) => {
      info.timestamp = new Date().toISOString();
      return info;
    }
  };
};

const formatJson = (): LogFormat => {
  return {
    transform: (info: LogInfo) => {
      return info;
    }
  };
};

const formatPrintf = (templateFn: LogFormatFn): LogFormat => {
  return {
    transform: (info: LogInfo) => {
      return templateFn(info);
    }
  };
};

const formatSimple = (): LogFormat => {
  return {
    transform: (info: LogInfo) => {
      const { level, message, timestamp, ...meta } = info;
      const ts = timestamp ? `${timestamp} ` : '';
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${ts}[${level}]: ${message}${metaStr}`;
    }
  };
};

// Custom Fallback Transports
export abstract class CompatTransport {
  level?: string;
  abstract log(info: LogInfo | string): void;
}

export interface ConsoleTransportOptions {
  level?: string;
}

export class CompatConsoleTransport extends CompatTransport {
  constructor(options: ConsoleTransportOptions = {}) {
    super();
    this.level = options.level;
  }

  log(info: LogInfo | string): void {
    const output = typeof info === 'string' ? info : JSON.stringify(info);
    if (typeof info !== 'string' && info.level === 'error') {
      console.error(output);
    } else {
      console.log(output);
    }
  }
}

export interface FileTransportOptions {
  filename: string;
  level?: string;
  maxsize?: number; // bytes
  maxFiles?: number;
}

export class CompatFileTransport extends CompatTransport {
  private filename: string;
  private maxsize: number;
  private maxFiles: number;

  constructor(options: FileTransportOptions) {
    super();
    this.filename = options.filename;
    this.level = options.level;
    this.maxsize = options.maxsize || 10 * 1024 * 1024; // 10MB default
    this.maxFiles = options.maxFiles || 5;

    // Ensure directory exists
    const dir = path.dirname(this.filename);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  log(info: LogInfo | string): void {
    try {
      const output = typeof info === 'string' ? info : JSON.stringify(info);
      fs.appendFileSync(this.filename, output + '\n', 'utf8');

      // Check size for rotation
      const stats = fs.statSync(this.filename);
      if (stats.size > this.maxsize) {
        this.rotate();
      }
    } catch (err) {
      // Fallback silent fail
    }
  }

  private rotate(): void {
    try {
      const dir = path.dirname(this.filename);
      const ext = path.extname(this.filename);
      const base = path.basename(this.filename, ext);

      // Shift backup files: base.log.4 -> base.log.5
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const src = path.join(dir, `${base}${ext}.${i}`);
        const dest = path.join(dir, `${base}${ext}.${i + 1}`);
        if (fs.existsSync(src)) {
          fs.renameSync(src, dest);
        }
      }

      // Shift base.log -> base.log.1
      if (fs.existsSync(this.filename)) {
        const dest = path.join(dir, `${base}${ext}.1`);
        fs.renameSync(this.filename, dest);
      }
    } catch (err) {
      // Fail silently to avoid logger disrupting the app
    }
  }
}

// Compat Logger class
export class CompatLoggerInstance {
  private transports: CompatTransport[] = [];
  private format?: LogFormat;
  private level: string = 'info';

  constructor(options: { level?: string; format?: LogFormat; transports?: CompatTransport[] }) {
    this.level = options.level || 'info';
    this.format = options.format;
    if (options.transports) {
      this.transports = options.transports;
    }
  }

  add(transport: CompatTransport): this {
    this.transports.push(transport);
    return this;
  }

  clear(): this {
    this.transports = [];
    return this;
  }

  log(level: string, message: string, meta: any = {}): void {
    const levels: Record<string, number> = { error: 0, warn: 1, info: 2, verbose: 3, debug: 4 };
    const currentLevelWeight = levels[this.level] ?? 2;
    const logLevelWeight = levels[level] ?? 2;

    if (logLevelWeight > currentLevelWeight) {
      return; // Skip logging if severity is lower than configured
    }

    // Build the initial info object
    let info: LogInfo = { level, message };
    if (meta) {
      if (meta instanceof Error) {
        info.error = { name: meta.name, message: meta.message, stack: meta.stack };
      } else if (typeof meta === 'object') {
        info = { ...info, ...meta };
      } else {
        info.meta = meta;
      }
    }

    // Apply format transforms
    let formatted: LogInfo | string | boolean = info;
    if (this.format) {
      formatted = this.format.transform(info);
      if (formatted === false) return; // Discarded by formatter
    }

    // Output to all transports
    for (const transport of this.transports) {
      if (transport.level) {
        const transportWeight = levels[transport.level] ?? 2;
        if (logLevelWeight > transportWeight) continue;
      }
      transport.log(formatted);
    }
  }

  error(message: string, meta?: any): void { this.log('error', message, meta); }
  warn(message: string, meta?: any): void { this.log('warn', message, meta); }
  info(message: string, meta?: any): void { this.log('info', message, meta); }
  verbose(message: string, meta?: any): void { this.log('verbose', message, meta); }
  debug(message: string, meta?: any): void { this.log('debug', message, meta); }
}

// Module Exports
export const winstonCompat = {
  format: {
    combine: formatCombine,
    timestamp: formatTimestamp,
    json: formatJson,
    printf: formatPrintf,
    simple: formatSimple
  },
  transports: {
    Console: CompatConsoleTransport,
    File: CompatFileTransport
  },
  createLogger(options: any): CompatLoggerInstance {
    return new CompatLoggerInstance(options);
  }
};

// Check if winston is available, otherwise export compatibility layer
let winstonInstance: any;
try {
  winstonInstance = require('winston');
} catch (e) {
  winstonInstance = winstonCompat;
}

export default winstonInstance;
