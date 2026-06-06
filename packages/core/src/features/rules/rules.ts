import { FileSystem } from '../../ports';
import { Logger } from '../../ports';

export class RulesManager {
  private agentsRules: string | null = null;

  constructor(private fs: FileSystem, private logger: Logger) {}

  getRules(): string | null {
    return this.agentsRules;
  }

  clear(): void {
    this.agentsRules = null;
  }

  setRules(val: string | null): void {
    this.agentsRules = val;
  }

  async loadAgentsRules(workspaceRoot: string): Promise<void> {
    const agentsPath = `${workspaceRoot.replace(/\/$/, '')}/AGENTS.md`;
    const claudePath = `${workspaceRoot.replace(/\/$/, '')}/CLAUDE.md`;
    if (await this.fs.exists(agentsPath)) {
      this.agentsRules = await this.fs.readFile(agentsPath);
      this.logger.info('Loaded instructions from AGENTS.md');
    } else if (await this.fs.exists(claudePath)) {
      this.agentsRules = await this.fs.readFile(claudePath);
      this.logger.info('Loaded instructions from CLAUDE.md');
    }
  }
}
