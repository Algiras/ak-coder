import { FileSystem, Logger } from '../../ports';

export class AgentContextManager {
  private activeFiles = new Set<string>();

  constructor(
    private fs: FileSystem,
    private logger: Logger,
    private resolvePath: (p: string) => string
  ) {}

  addFile(filePath: string): void {
    this.activeFiles.add(filePath);
  }

  removeFile(filePath: string): void {
    this.activeFiles.delete(filePath);
  }

  getActiveFiles(): string[] {
    return Array.from(this.activeFiles);
  }

  async getFormattedContextPrompt(): Promise<string> {
    let contextStr = '';
    for (const file of this.activeFiles) {
      try {
        const content = await this.fs.readFile(file);
        contextStr += `\n--- File: ${file} ---\n${content}\n---------------------\n`;
      } catch (e) {
        this.logger.warn(`Failed to read file for context: ${file}`, e);
      }
    }
    return contextStr;
  }

  async expandFileReferences(input: string): Promise<string> {
    const FILE_SIZE_LIMIT = 100 * 1024; // 100KB
    const pattern = /@([^\s]+)/g;
    let result = input;
    const matches = [...input.matchAll(pattern)];
    for (const match of matches) {
      const token = match[1];
      const resolved = this.resolvePath(token);
      if (await this.fs.exists(resolved)) {
        try {
          const content = await this.fs.readFile(resolved);
          if (content.length > FILE_SIZE_LIMIT) {
            result = result.replace(match[0], `[file too large: ${token}]`);
          } else {
            result = result.replace(
              match[0],
              `@${token}\n<file path="${token}">\n${content}\n</file>`
            );
          }
        } catch {
          // leave token untouched on read error
        }
      }
    }
    return result;
  }
}
