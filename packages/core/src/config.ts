import { FileSystem } from './ports';

export interface AppConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  costInput: number; // per 1M tokens
  costOutput: number; // per 1M tokens
  mcpServers: Record<string, { command: string; args: string[] }>;
  assistantName: string; // displayed label for assistant messages
  systemName: string;    // displayed product name in banner / status
  contextTokens: number; // max context window size (tokens)
}

export class ConfigManager {
  private config: AppConfig | null = null;

  constructor(private fs: FileSystem, private configPath: string) {}

  async load(): Promise<AppConfig> {
    if (this.config) return this.config;

    const exists = await this.fs.exists(this.configPath);
    if (!exists) {
      // Return default config
      return {
        apiKey: process.env.OPENAI_API_KEY || 'mock-key',
        baseUrl: process.env.OPENAI_API_BASE || 'https://api.openai.com/v1',
        model: 'gpt-4o',
        costInput: 5.0,
        costOutput: 15.0,
        mcpServers: {},
        assistantName: 'AKCoder',
        systemName: 'ak-coder',
        contextTokens: 128000,
      };
    }

    try {
      const data = await this.fs.readFile(this.configPath);
      const parsed = JSON.parse(data);
      this.config = this.validateAndMigrate(parsed);
      return this.config;
    } catch (e) {
      throw new Error(`Failed to parse configuration file: ${(e as Error).message}`);
    }
  }

  async save(config: AppConfig): Promise<void> {
    this.config = this.validateAndMigrate(config);
    await this.fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
  }

  private validateAndMigrate(data: any): AppConfig {
    // Basic structural validation
    const apiKey = typeof data.apiKey === 'string' ? data.apiKey : 'mock-key';
    const baseUrl = typeof data.baseUrl === 'string' ? data.baseUrl : 'https://api.openai.com/v1';
    const model = typeof data.model === 'string' ? data.model : 'gpt-4o';
    const costInput = typeof data.costInput === 'number' ? data.costInput : 5.0;
    const costOutput = typeof data.costOutput === 'number' ? data.costOutput : 15.0;
    const mcpServers = data.mcpServers && typeof data.mcpServers === 'object' ? data.mcpServers : {};
    const assistantName = typeof data.assistantName === 'string' && data.assistantName.trim() ? data.assistantName.trim() : 'AKCoder';
    const systemName = typeof data.systemName === 'string' && data.systemName.trim() ? data.systemName.trim() : 'ak-coder';
    const contextTokens = typeof data.contextTokens === 'number' && data.contextTokens > 0 ? data.contextTokens : 128000;

    return {
      apiKey,
      baseUrl,
      model,
      costInput,
      costOutput,
      mcpServers,
      assistantName,
      systemName,
      contextTokens,
    };
  }
}
