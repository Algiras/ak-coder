import { FileSystem } from '../../ports';
import { Logger } from '../../ports';

export function isSkillFilePath(filePath: string): boolean {
  return filePath.replace(/\\/g, '/').endsWith('SKILL.md');
}

export interface SkillDefinition {
  name: string;
  description: string;
  content: string;
  path?: string;
}

export class SkillsManager {
  private loadedSkills: SkillDefinition[] = [];

  constructor(private fs: FileSystem, private logger: Logger) {}

  getSkills(): SkillDefinition[] {
    return this.loadedSkills;
  }

  clear(): void {
    this.loadedSkills = [];
  }

  async loadSkills(workspaceRoot: string): Promise<void> {
    try {
      const allFiles = await this.fs.listFiles(workspaceRoot);
      const skillFiles = allFiles.filter(f => f.endsWith('SKILL.md'));

      // Remove any previously loaded skills from this workspaceRoot
      const normalizedRoot = workspaceRoot.replace(/\/$/, '') + '/';
      this.loadedSkills = this.loadedSkills.filter(s => !s.path || !s.path.startsWith(normalizedRoot));

      for (const file of skillFiles) {
        try {
          const rawContent = await this.fs.readFile(file);
          const parsed = this.parseSkillMarkdown(rawContent);

          const parts = file.split('/');
          parts.pop(); // Remove SKILL.md
          const parentFolder = parts.pop() || '';

          this.loadedSkills.push({
            name: parsed.name || parentFolder || 'unknown-skill',
            description: parsed.description || '',
            content: rawContent,
            path: file
          });
          this.logger.info(`Loaded skill: ${parsed.name || parentFolder || file}`);
        } catch (e) {
          this.logger.warn(`Failed to parse skill file ${file}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to list skill files: ${(e as Error).message}`);
    }
  }

  private parseSkillMarkdown(content: string): { name?: string; description?: string } {
    const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
    if (!match) return {};

    const yamlStr = match[1];
    const lines = yamlStr.split('\n');
    const result: Record<string, string> = {};
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx !== -1) {
        const key = line.substring(0, idx).trim().toLowerCase();
        const val = line.substring(idx + 1).replace(/^['"]|['"]$/g, '').trim();
        result[key] = val;
      }
    }
    return result;
  }
}
