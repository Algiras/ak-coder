import { describe, it, expect } from 'bun:test';
import { ConfigManager } from '@ak-coder/core';
import { MockFileSystem } from '@ak-coder/core';

describe('Project Configuration Overrides', () => {
  it('should merge global config with local workspace overrides', async () => {
    const mockFs = new MockFileSystem();

    // Setup global config file
    const globalConfigPath = '/home/.ak-coder/config.json';
    const globalConfig = {
      apiKey: 'global-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      costInput: 5.0,
      costOutput: 15.0,
      mcpServers: {
        globalServer: { command: 'node', args: ['global.js'] }
      }
    };
    await mockFs.writeFile(globalConfigPath, JSON.stringify(globalConfig, null, 2));

    // Setup local override config file
    const localConfigPath = '/workspace/.ak-coder/config.json';
    const localConfig = {
      apiKey: 'local-key',
      model: 'local-model',
      costInput: 1.0,
      costOutput: 2.0,
      mcpServers: {
        localServer: { command: 'node', args: ['local.js'] }
      }
    };
    await mockFs.writeFile(localConfigPath, JSON.stringify(localConfig, null, 2));

    // Simulate merging logic
    const globalConfigManager = new ConfigManager(mockFs, globalConfigPath);
    const loadedGlobal = await globalConfigManager.load();
    let finalConfig = { ...loadedGlobal };

    if (await mockFs.exists(localConfigPath)) {
      const localConfigManager = new ConfigManager(mockFs, localConfigPath);
      const loadedLocal = await localConfigManager.load();
      finalConfig = {
        ...loadedGlobal,
        ...loadedLocal,
        mcpServers: {
          ...loadedGlobal.mcpServers,
          ...(loadedLocal.mcpServers || {})
        }
      };
    }

    // Assert correctness
    expect(finalConfig.apiKey).toBe('local-key');
    expect(finalConfig.model).toBe('local-model');
    expect(finalConfig.costInput).toBe(1.0);
    expect(finalConfig.costOutput).toBe(2.0);
    expect(finalConfig.baseUrl).toBe('https://api.openai.com/v1'); // inherited
    expect(finalConfig.mcpServers).toHaveProperty('globalServer');
    expect(finalConfig.mcpServers).toHaveProperty('localServer');
  });
});
