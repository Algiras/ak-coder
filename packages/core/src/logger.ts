import { Logger, FileSystem } from './ports';
import winston from './adapters/winston_compat';

export class FileLogger implements Logger {
  private winstonLogger: any;
  private logPath: string;

  constructor(
    private fs: FileSystem, 
    private logDir: string, 
    maxSizeBytes: number = 10 * 1024 * 1024, 
    maxBackupFiles: number = 5,
    level: string = 'info'
  ) {
    this.logPath = `${this.logDir.replace(/\/$/, '')}/agent.log`;
    this.winstonLogger = winston.createLogger({
      level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({
          filename: this.logPath,
          maxsize: maxSizeBytes,
          maxFiles: maxBackupFiles
        })
      ]
    });
  }

  info(message: string, meta?: any): void {
    this.winstonLogger.info(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.winstonLogger.warn(message, meta);
  }

  error(message: string, error?: any): void {
    const meta = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
    this.winstonLogger.error(message, meta);
  }

  debug(message: string, meta?: any): void {
    this.winstonLogger.debug(message, meta);
  }

  startSpan(name: string): string {
    const spanId = `${name}-${Math.random().toString(36).substring(2, 9)}`;
    this.info(`Span started: ${name}`, { spanId });
    return spanId;
  }

  endSpan(spanId: string): void {
    this.info(`Span ended`, { spanId });
  }

  async rotate(): Promise<void> {
    // Rotation is automatically handled by the Winston File transport (or custom CompatFileTransport fallback)
  }
}

