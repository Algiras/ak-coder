import { describe, it, expect, mock } from 'bun:test';
import * as readlineModule from 'readline';
import { EventEmitter } from 'events';

const originalCreateInterface = readlineModule.createInterface;
let lastCompleter: any = null;

mock.module('readline', () => {
  return {
    ...readlineModule,
    createInterface: (options: any) => {
      if (options && options.completer) {
        lastCompleter = options.completer;
        const emitter = new EventEmitter() as any;
        emitter.close = () => {};
        emitter.setPrompt = () => {};
        emitter.prompt = () => {};
        return emitter;
      }
      return originalCreateInterface(options);
    }
  };
});

import { NodeProcessRunner } from '../src/adapters/process';
import { NodeTerminalIo } from '../src/adapters/terminal';
import { DockerProcessRunner } from '@ak-coder/core';

describe('CLI Adapters & Sandboxing Options', () => {

  describe('NodeProcessRunner', () => {
    it('should run a command and return stdout/stderr/code', async () => {
      const runner = new NodeProcessRunner();
      const res = await runner.run('echo "test-output"');
      expect(res.code).toBe(0);
      expect(res.stdout.trim()).toBe('test-output');
      expect(res.stderr).toBe('');
    });

    it('should return error code for failing command', async () => {
      const runner = new NodeProcessRunner();
      const res = await runner.run('exit 42');
      expect(res.code).not.toBe(0);
    });
  });

  describe('NodeTerminalIo', () => {
    it('should construct with noReadline and write correctly', () => {
      const originalStdoutWrite = process.stdout.write;
      const originalStderrWrite = process.stderr.write;
      let stdoutData = '';
      let stderrData = '';

      process.stdout.write = (chunk: any) => {
        stdoutData += chunk.toString();
        return true;
      };
      process.stderr.write = (chunk: any) => {
        stderrData += chunk.toString();
        return true;
      };

      try {
        const nio = new NodeTerminalIo(true);
        nio.write('output message');
        nio.writeError('error message');

        expect(stdoutData).toContain('output message');
        expect(stderrData).toContain('error message');
      } finally {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
      }
    });

    it('completer should work with completions supplier', () => {
      const getCompletions = () => ['/help', '/plan', '/exit'];
      new NodeTerminalIo(false, getCompletions);

      expect(lastCompleter).toBeDefined();
      const [hits, line] = lastCompleter('/pl');
      expect(hits).toEqual(['/plan']);
      expect(line).toBe('/pl');
    });
  });

  describe('DockerProcessRunner Configuration', () => {
    it('should initialize with correct container settings based on options', () => {
      const runner = new DockerProcessRunner({
        workspaceRoot: '/ws',
        image: 'node:20-alpine',
        readOnly: true,
        timeout: 10000,
        extraArgs: ['--network=none']
      }) as any;

      expect(runner.image).toBe('node:20-alpine');
      expect(runner.workspaceRoot).toBe('/ws');
      expect(runner.readOnly).toBe(true);
      expect(runner.timeout).toBe(10000);
      expect(runner.extraArgs).toEqual(['--network=none']);
    });
  });
});
