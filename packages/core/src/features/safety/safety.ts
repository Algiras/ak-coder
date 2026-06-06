import { FileSystem } from '../../ports';

export class CommandSafetyGate {
  private allowedPatterns: string[] = [];
  private permissionsPath: string;

  constructor(private fs: FileSystem, private workspaceRoot: string) {
    this.permissionsPath = `${this.workspaceRoot.replace(/\/$/, '')}/.ak-coder/permissions.json`;
  }

  async loadPermissions(): Promise<void> {
    if (await this.fs.exists(this.permissionsPath)) {
      try {
        const content = await this.fs.readFile(this.permissionsPath);
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed.allowedPatterns)) {
          this.allowedPatterns = parsed.allowedPatterns;
        }
      } catch {
        this.allowedPatterns = [];
      }
    }
  }

  async savePermissions(): Promise<void> {
    const data = JSON.stringify({ allowedPatterns: this.allowedPatterns }, null, 2);
    await this.fs.writeFile(this.permissionsPath, data);
  }

  classifyCommand(command: string): 'safe' | 'unsafe' {
    const trimmed = command.trim();
    // Commands that are pure reads or Git metadata checks
    const safeRegexes = [
      /^(git\s+)?(status|diff|log|show|branch|tag)(\s+.*)?$/,
      /^(ls|pwd|echo|cat|grep|find)(\s+.*)?$/,
      /^touch(\s+[^\s|;&><]+(\s+[^\s|;&><]+)*)?$/
    ];

    for (const rx of safeRegexes) {
      if (rx.test(trimmed)) {
        return 'safe';
      }
    }
    return 'unsafe';
  }

  isAuthorized(command: string): boolean {
    const trimmed = command.trim();
    for (const pattern of this.allowedPatterns) {
      if (trimmed === pattern || trimmed.startsWith(pattern)) {
        return true;
      }
    }
    return false;
  }

  async authorizePattern(pattern: string): Promise<void> {
    const trimmed = pattern.trim();
    if (!this.allowedPatterns.includes(trimmed)) {
      this.allowedPatterns.push(trimmed);
      await this.savePermissions();
    }
  }
}
