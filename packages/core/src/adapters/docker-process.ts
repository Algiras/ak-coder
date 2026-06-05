/**
 * DockerProcessRunner — implements the ProcessRunner port by running
 * each command inside a Docker container instead of the host shell.
 *
 * The workspace directory is bind-mounted into the container so the
 * agent can still read/write files, but any destructive host-level
 * side-effects (package installs, `rm -rf`, etc.) are contained.
 *
 * Usage:
 *   const runner = new DockerProcessRunner({
 *     image: 'node:20-alpine',      // Docker image to use
 *     workspaceRoot: '/my/project', // absolute host path to mount
 *     readOnly: false,              // allow writes inside container
 *     timeout: 60000,               // ms (default 60 s)
 *     extraArgs: ['--network=none'] // optional extra docker flags
 *   });
 */

import { ProcessRunner } from '../ports';
import { exec } from 'child_process';

export interface DockerProcessRunnerOptions {
  /** Docker image to run commands in (default: 'node:20-alpine') */
  image?: string;
  /** Absolute host path to mount as /workspace inside the container */
  workspaceRoot: string;
  /**
   * If true the workspace mount is read-only (default false).
   * Note: the agent's write_file tool writes via the FileSystem port
   * (host FS), so commands that produce build artefacts still work
   * when readOnly is false.
   */
  readOnly?: boolean;
  /** Command execution timeout in ms (default 60 000) */
  timeout?: number;
  /** Extra arguments appended to `docker run` (e.g. ['--network=none']) */
  extraArgs?: string[];
  /** Docker container working directory (default: /workspace) */
  containerCwd?: string;
}

const DEFAULT_IMAGE = 'node:20-alpine';
const DEFAULT_TIMEOUT = 60_000;
const CONTAINER_WORKDIR = '/workspace';

export class DockerProcessRunner implements ProcessRunner {
  private image: string;
  private workspaceRoot: string;
  private readOnly: boolean;
  private timeout: number;
  private extraArgs: string[];
  private containerCwd: string;

  constructor(opts: DockerProcessRunnerOptions) {
    this.image = opts.image ?? DEFAULT_IMAGE;
    this.workspaceRoot = opts.workspaceRoot;
    this.readOnly = opts.readOnly ?? false;
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    this.extraArgs = opts.extraArgs ?? [];
    this.containerCwd = opts.containerCwd ?? CONTAINER_WORKDIR;
  }

  run(
    command: string,
    options?: { cwd?: string; timeout?: number; env?: Record<string, string> }
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const timeoutMs = options?.timeout ?? this.timeout;

    // Determine the effective working directory inside the container.
    // If a host cwd is provided and it's under the workspace, translate it.
    let containerWorkdir = this.containerCwd;
    if (options?.cwd) {
      const hostCwd = options.cwd;
      if (hostCwd.startsWith(this.workspaceRoot)) {
        const relative = hostCwd.slice(this.workspaceRoot.length) || '';
        containerWorkdir = `${CONTAINER_WORKDIR}${relative}`;
      }
    }

    // Build environment variable flags
    const envFlags = Object.entries(options?.env ?? {})
      .map(([k, v]) => `-e ${escapeShellArg(`${k}=${v}`)}`)
      .join(' ');

    // Mount: workspaceRoot → /workspace inside container
    const mountMode = this.readOnly ? 'ro' : 'rw';
    const mountFlag = `-v ${escapeShellArg(this.workspaceRoot)}:${CONTAINER_WORKDIR}:${mountMode}`;

    const extraFlags = this.extraArgs.join(' ');

    const dockerCmd = [
      'docker run --rm',
      `--workdir ${escapeShellArg(containerWorkdir)}`,
      mountFlag,
      envFlags,
      extraFlags,
      escapeShellArg(this.image),
      'sh', '-c', escapeShellArg(command),
    ]
      .filter(Boolean)
      .join(' ');

    return new Promise((resolve) => {
      exec(
        dockerCmd,
        { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          resolve({
            code: error?.code ?? (error ? 1 : 0),
            stdout: stdout.toString(),
            stderr: stderr.toString(),
          });
        }
      );
    });
  }
}

/** Wrap a value in single quotes, escaping any existing single quotes. */
function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
