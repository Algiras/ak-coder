import { ProcessRunner } from '@ak-coder/core';
import { exec } from 'child_process';

export class NodeProcessRunner implements ProcessRunner {
  run(command: string, options?: { cwd?: string; timeout?: number }): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const timeoutMs = options?.timeout ?? 300000; // default 5 minutes
      const child = exec(
        command,
        {
          cwd: options?.cwd,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              code: error.code ?? 1,
              stdout: stdout.toString(),
              stderr: stderr.toString()
            });
          } else {
            resolve({
              code: 0,
              stdout: stdout.toString(),
              stderr: stderr.toString()
            });
          }
        }
      );
    });
  }
}
