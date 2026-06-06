import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import * as osModule from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';

let testHomedir = '';

mock.module('os', () => {
  return {
    ...osModule,
    homedir: () => testHomedir
  };
});

import { COMMANDS } from '../src/repl';
import { AgentCore, MockFileSystem, MockLlmService, MockSessionStore, MockLogger } from '@ak-coder/core';

describe('/providers CLI Command', () => {
  let mockFs: MockFileSystem;
  let mockLlm: MockLlmService;
  let mockStore: MockSessionStore;
  let mockLogger: MockLogger;
  let core: AgentCore;
  let written: string[];
  let errors: string[];

  const nio = {
    write: (text: string) => {
      written.push(text);
    },
    writeError: (text: string) => {
      errors.push(text);
    },
    ask: async () => '',
    askConfirm: async () => true,
    confirm: async () => ({ approved: true, applyToAll: false }),
    selectMenu: async () => null as any,
  };

  beforeEach(async () => {
    testHomedir = await fs.mkdtemp(path.join(osModule.tmpdir(), 'ak-providers-test-'));
    await fs.mkdir(path.join(testHomedir, '.ak-coder'), { recursive: true });
    
    mockFs = new MockFileSystem();
    mockLlm = new MockLlmService();
    mockStore = new MockSessionStore();
    mockLogger = new MockLogger();
    core = new AgentCore(mockFs, mockLlm, mockStore, mockLogger);

    written = [];
    errors = [];
  });

  afterEach(async () => {
    if (testHomedir) {
      await fs.rm(testHomedir, { recursive: true, force: true });
    }
  });

  it('should list default providers when /providers is run without arguments', async () => {
    const handler = COMMANDS['/providers'].handler;
    await handler('', {
      core,
      nio,
      workspaceRoot: testHomedir,
      store: mockStore,
      llm: mockLlm,
      npr: {} as any
    });

    const output = written.join('\n');
    expect(output).toContain('Configured Providers');
    expect(output).toContain('openai');
    expect(output).toContain('ollama');
    expect(output).toContain('groq');
  });

  it('should allow selecting a provider and update the live config dynamically', async () => {
    const handler = COMMANDS['/providers'].handler;
    
    // First let's check that default active is openai
    await handler('select ollama', {
      core,
      nio,
      workspaceRoot: testHomedir,
      store: mockStore,
      llm: mockLlm,
      npr: {} as any
    });

    expect(written.join('\n')).toContain('Switched active provider to: ollama');
    expect((mockLlm as any).apiKey).toBe('ollama');
    expect((mockLlm as any).baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect((mockLlm as any).defaultModel).toBe('gemma4:31b-cloud');

    // Read saved configuration file to verify it was written
    const savedConfigRaw = await fs.readFile(path.join(testHomedir, '.ak-coder', 'config.json'), 'utf8');
    const savedConfig = JSON.parse(savedConfigRaw);
    expect(savedConfig.activeProvider).toBe('ollama');
  });

  it('should allow setting parameters for a provider', async () => {
    const handler = COMMANDS['/providers'].handler;

    await handler('set openai model gpt-4-32k', {
      core,
      nio,
      workspaceRoot: testHomedir,
      store: mockStore,
      llm: mockLlm,
      npr: {} as any
    });

    expect(written.join('\n')).toContain('Updated [openai].model = gpt-4-32k');

    // Verify written config.json has the updated model
    const savedConfigRaw = await fs.readFile(path.join(testHomedir, '.ak-coder', 'config.json'), 'utf8');
    const savedConfig = JSON.parse(savedConfigRaw);
    expect(savedConfig.providers.openai.model).toBe('gpt-4-32k');
  });

  it('should validate subcommands and parameter keys', async () => {
    const handler = COMMANDS['/providers'].handler;

    await handler('invalidSubcommand', {
      core,
      nio,
      workspaceRoot: testHomedir,
      store: mockStore,
      llm: mockLlm,
      npr: {} as any
    });

    expect(errors.join('\n')).toContain('Unknown command "invalidsubcommand"');

    errors = [];
    await handler('set openai invalidKey value', {
      core,
      nio,
      workspaceRoot: testHomedir,
      store: mockStore,
      llm: mockLlm,
      npr: {} as any
    });

    expect(errors.join('\n')).toContain('Invalid setting "invalidKey"');
  });
});
