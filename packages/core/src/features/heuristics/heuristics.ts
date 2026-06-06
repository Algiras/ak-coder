import { TerminalIo, Logger } from '../../ports';

export class HeuristicAuditor {
  private consecutiveReadsCount = 0;
  private hasModifiedFiles = false;
  private hasExecutedTests = false;

  constructor(
    private terminalIo: TerminalIo | undefined,
    private logger: Logger
  ) {}

  incrementConsecutiveReads(): number {
    this.consecutiveReadsCount++;
    if (this.consecutiveReadsCount > 5) {
      const warnMsg = `\x1b[33m[Heuristic Alert: Agent has read ${this.consecutiveReadsCount} files consecutively without taking modifying actions.]\x1b[0m\n`;
      if (this.terminalIo) {
        this.terminalIo.write(warnMsg);
      }
    }
    return this.consecutiveReadsCount;
  }

  resetConsecutiveReads(): void {
    this.consecutiveReadsCount = 0;
  }

  markModified(): void {
    this.hasModifiedFiles = true;
  }

  markTestsExecuted(): void {
    this.hasExecutedTests = true;
  }

  resetSession(): void {
    this.consecutiveReadsCount = 0;
    this.hasModifiedFiles = false;
    this.hasExecutedTests = false;
  }

  auditSessionEnd(): void {
    if (this.hasModifiedFiles && !this.hasExecutedTests) {
      const testWarning = '\x1b[33m[Heuristic Alert: Files modified but no test commands executed. Consider running bun test.]\x1b[0m\n';
      if (this.terminalIo) {
        this.terminalIo.write(testWarning);
      }
      this.logger.info('Heuristics check: changes made but no tests executed');
    }
  }
}
