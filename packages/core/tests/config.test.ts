import { describe, it, expect } from 'bun:test';
import { ConfigManager } from '../src/config';
import { MockFileSystem } from '../src/mocks';

describe('ConfigManager', () => {
  it('should load default config when file does not exist', async () => {
    const mockFs = new MockFileSystem();
    const manager = new ConfigManager(mockFs, '/config.json');
    const config = await manager.load();

    expect(config.apiKey).toBe('mock-key');
    expect(config.baseUrl).toBe('https://api.openai.com/v1');
    expect(config.model).toBe('gpt-4o');
    expect(config.providers).toBeDefined();
    expect(config.providers!.openai).toBeDefined();
    expect(config.providers!.ollama).toBeDefined();
    expect(config.providers!.groq).toBeDefined();
    expect(config.providers!.gemini).toBeDefined();
    expect(config.providers!.deepseek).toBeDefined();
    expect(config.providers!.openrouter).toBeDefined();
    expect(config.activeProvider).toBe('openai');
  });

  it('should migrate old configuration to include providers map', async () => {
    const mockFs = new MockFileSystem();
    await mockFs.writeFile('/config.json', JSON.stringify({
      apiKey: 'custom-key',
      baseUrl: 'https://custom-api.com',
      model: 'custom-model'
    }));

    const manager = new ConfigManager(mockFs, '/config.json');
    const config = await manager.load();

    expect(config.providers).toBeDefined();
    expect(config.providers!.openai.apiKey).toBe('custom-key');
    expect(config.providers!.openai.baseUrl).toBe('https://custom-api.com');
    expect(config.providers!.openai.model).toBe('custom-model');
  });

  it('should dynamically override configuration settings when activeProvider is set', async () => {
    const mockFs = new MockFileSystem();
    await mockFs.writeFile('/config.json', JSON.stringify({
      activeProvider: 'ollama',
      providers: {
        openai: {
          apiKey: 'openai-key',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o'
        },
        ollama: {
          apiKey: 'ollama-key',
          baseUrl: 'http://localhost:11434/v1',
          model: 'custom-ollama-model',
          costInput: 0.0,
          costOutput: 0.0
        }
      }
    }));

    const manager = new ConfigManager(mockFs, '/config.json');
    const config = await manager.load();

    expect(config.activeProvider).toBe('ollama');
    expect(config.apiKey).toBe('ollama-key');
    expect(config.baseUrl).toBe('http://localhost:11434/v1');
    expect(config.model).toBe('custom-ollama-model');
    expect(config.costInput).toBe(0.0);
    expect(config.costOutput).toBe(0.0);
  });
});
