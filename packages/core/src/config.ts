import { FileSystem } from './ports';

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  costInput?: number; // per 1M tokens
  costOutput?: number; // per 1M tokens
}

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

  // Multi-provider configuration
  providers?: Record<string, ProviderConfig>;
  activeProvider?: string;
}

export class ConfigManager {
  private config: AppConfig | null = null;

  constructor(private fs: FileSystem, private configPath: string) {}

  async load(): Promise<AppConfig> {
    if (this.config) return this.config;

    const exists = await this.fs.exists(this.configPath);
    if (!exists) {
      // Return default config
      const defaultConfig = this.validateAndMigrate({});
      return defaultConfig;
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
    let providers = data.providers && typeof data.providers === 'object' ? { ...data.providers } : null;
    let activeProvider = typeof data.activeProvider === 'string' ? data.activeProvider : undefined;

    // Smooth migration: if no providers are defined, initialize them with default presets using the existing root values
    if (!providers) {
      providers = {
        openai: {
          apiKey: data.apiKey === 'ollama' ? 'mock-key' : (typeof data.apiKey === 'string' ? data.apiKey : (process.env.OPENAI_API_KEY || 'mock-key')),
          baseUrl: data.baseUrl && data.baseUrl.includes('11434') ? 'https://api.openai.com/v1' : (typeof data.baseUrl === 'string' ? data.baseUrl : (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1')),
          model: data.model && data.model.includes('gemma') ? 'gpt-4o' : (typeof data.model === 'string' ? data.model : 'gpt-4o'),
          costInput: typeof data.costInput === 'number' ? data.costInput : 5.0,
          costOutput: typeof data.costOutput === 'number' ? data.costOutput : 15.0,
        },
        ollama: {
          apiKey: 'ollama',
          baseUrl: data.baseUrl && data.baseUrl.includes('11434') ? data.baseUrl : 'http://127.0.0.1:11434/v1',
          model: data.model && data.model.includes('gemma') ? data.model : 'gemma4:31b-cloud',
          costInput: 0.0,
          costOutput: 0.0,
        }
      };
      if (!activeProvider) {
        activeProvider = data.baseUrl && data.baseUrl.includes('11434') ? 'ollama' : 'openai';
      }
    }

    if (!providers.groq) {
      providers.groq = {
        apiKey: process.env.GROQ_KEY || process.env.GROQ_API_KEY || 'mock-key',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'openai/gpt-oss-120b',
        costInput: 0.59,
        costOutput: 0.79,
      };
    }

    if (!providers.gemini) {
      providers.gemini = {
        apiKey: process.env.GEMINI_API_KEY || 'mock-key',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-1.5-flash',
        costInput: 0.075,
        costOutput: 0.30,
      };
    }

    if (!providers.deepseek) {
      providers.deepseek = {
        apiKey: process.env.DEEPSEEK_API_KEY || 'mock-key',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        costInput: 0.14,
        costOutput: 0.28,
      };
    }

    if (!providers.openrouter) {
      providers.openrouter = {
        apiKey: process.env.OPEN_ROUTER_KEY || process.env.OPENROUTER_API_KEY || 'mock-key',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openrouter/free',
        costInput: 0.0,
        costOutput: 0.0,
      };
    }

    let apiKey = typeof data.apiKey === 'string' ? data.apiKey : (process.env.OPENAI_API_KEY || 'mock-key');
    let baseUrl = typeof data.baseUrl === 'string' ? data.baseUrl : (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1');
    let model = typeof data.model === 'string' ? data.model : 'gpt-4o';
    let costInput = typeof data.costInput === 'number' ? data.costInput : 5.0;
    let costOutput = typeof data.costOutput === 'number' ? data.costOutput : 15.0;

    // Override core configs dynamically if activeProvider is set
    if (activeProvider && providers[activeProvider]) {
      const activeCfg = providers[activeProvider];
      apiKey = activeCfg.apiKey ?? apiKey;
      baseUrl = activeCfg.baseUrl ?? baseUrl;
      model = activeCfg.model ?? model;
      costInput = activeCfg.costInput ?? costInput;
      costOutput = activeCfg.costOutput ?? costOutput;
    }

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
      providers,
      activeProvider,
    };
  }
}
