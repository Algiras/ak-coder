import { describe, it, expect } from 'bun:test';
import winston from '../src/adapters/winston_compat';
import * as fs from 'fs';
import * as path from 'path';

describe('Winston Compat Adapter', () => {
  it('should format logs as json with timestamp using combine', () => {
    const logger = winston.createLogger({
      level: 'debug',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: []
    });

    let loggedInfo: any = null;
    const mockTransport = {
      log: (info: any) => {
        loggedInfo = info;
      }
    };
    logger.add(mockTransport as any);

    logger.info('test message', { customKey: 'customVal' });

    expect(loggedInfo).toBeDefined();
    expect(loggedInfo.level).toBe('info');
    expect(loggedInfo.message).toBe('test message');
    expect(loggedInfo.timestamp).toBeDefined();
    expect(loggedInfo.customKey).toBe('customVal');
  });

  it('should support printf custom formats', () => {
    const customFormat = winston.format.printf(({ level, message, timestamp }) => {
      return `[${timestamp}] [${level.toUpperCase()}]: ${message}`;
    });

    const logger = winston.createLogger({
      format: winston.format.combine(
        winston.format.timestamp(),
        customFormat
      ),
      transports: []
    });

    let loggedOutput: string = '';
    const mockTransport = {
      log: (info: string) => {
        loggedOutput = info;
      }
    };
    logger.add(mockTransport as any);

    logger.warn('warning message');

    expect(loggedOutput).toContain('[WARN]');
    expect(loggedOutput).toContain('warning message');
  });

  it('should support simple format', () => {
    const logger = winston.createLogger({
      format: winston.format.simple(),
      transports: []
    });

    let loggedOutput: string = '';
    const mockTransport = {
      log: (info: string) => {
        loggedOutput = info;
      }
    };
    logger.add(mockTransport as any);

    logger.error('err msg', { trace: 'stacktrace' });

    expect(loggedOutput).toContain('[error]: err msg {"trace":"stacktrace"}');
  });

  it('should rotate logs based on size', async () => {
    const tempDir = path.join(__dirname, 'temp_winston_test');
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    const logFile = path.join(tempDir, 'winston.log');

    try {
      const logger = winston.createLogger({
        level: 'info',
        format: winston.format.simple(),
        transports: [
          new winston.transports.File({
            filename: logFile,
            maxsize: 50, // very small
            maxFiles: 3
          })
        ]
      });

      // Write a short line first (14 bytes output: '[info]: short\n')
      logger.info('short');
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(fs.existsSync(logFile)).toBe(true);

      // Write a long line that exceeds the 50 bytes limit (triggering rotation)
      logger.info('this is a very long log line that easily exceeds fifty bytes');
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(fs.existsSync(logFile + '.1')).toBe(true);
    } finally {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });
});
