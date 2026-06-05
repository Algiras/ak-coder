import { describe, it, expect, beforeEach } from 'bun:test';
import { MockFileSystem } from '../src/mocks';
import { ConfigManager } from '../src/config';
import { FileSessionStore } from '../src/history';
import { FileLogger } from '../src/logger';
import { ChatMessage } from '../src/ports';
import * as fs from 'fs';
import * as path from 'path';

describe('Core Logic Components', () => {
  let mockFs: MockFileSystem;

  beforeEach(() => {
    mockFs = new MockFileSystem();
  });

  describe('ConfigManager', () => {
    it('should load default config if file does not exist', async () => {
      const configManager = new ConfigManager(mockFs, '/config.json');
      const config = await configManager.load();
      expect(config.model).toBe('gpt-4o');
      expect(config.costInput).toBe(5.0);
    });

    it('should save and validate config correctly', async () => {
      const configManager = new ConfigManager(mockFs, '/config.json');
      await configManager.save({
        apiKey: 'test-key',
        baseUrl: 'https://api.test.com',
        model: 'custom-model',
        costInput: 2.0,
        costOutput: 4.0,
        mcpServers: {}
      });

      const loaded = await configManager.load();
      expect(loaded.apiKey).toBe('test-key');
      expect(loaded.baseUrl).toBe('https://api.test.com');
      expect(loaded.model).toBe('custom-model');
    });
  });

  describe('FileSessionStore', () => {
    it('should persist and load history in JSONL format', async () => {
      const store = new FileSessionStore(mockFs, '/history');
      const messages: ChatMessage[] = [
        { role: 'system', content: 'system message' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' }
      ];

      await store.saveSession('sess-1', messages);

      const loaded = await store.loadSession('sess-1');
      expect(loaded).toHaveLength(3);
      expect(loaded[0].role).toBe('system');
      expect(loaded[1].content).toBe('hello');
    });

    it('should list sessions in directory', async () => {
      const store = new FileSessionStore(mockFs, '/history');
      await store.saveSession('123456-abc', [{ role: 'user', content: 'hi' }]);
      await store.saveSession('789012-def', [{ role: 'user', content: 'bye' }]);

      const sessions = await store.listSessions();
      expect(sessions.map(s => s.sessionId)).toContain('123456-abc');
      expect(sessions.map(s => s.sessionId)).toContain('789012-def');
    });

    it('should fork a session at a specific turn index', async () => {
      const store = new FileSessionStore(mockFs, '/history');
      const messages: ChatMessage[] = [
        { role: 'user', content: 'step 1' },
        { role: 'assistant', content: 'res 1' },
        { role: 'user', content: 'step 2' }
      ];

      await store.saveSession('original', messages);
      const forked = await store.forkSession('original', 1, 'forked');

      expect(forked).toHaveLength(2);
      expect(forked[0].content).toBe('step 1');
      expect(forked[1].content).toBe('res 1');

      const loadedFork = await store.loadSession('forked');
      expect(loadedFork).toHaveLength(2);
      expect(loadedFork[1].content).toBe('res 1');
    });

    it('should truncate a session to keepCount messages and persist', async () => {
      const store = new FileSessionStore(mockFs, '/history');
      const messages: ChatMessage[] = [
        { role: 'user', content: 'turn 1' },
        { role: 'assistant', content: 'reply 1' },
        { role: 'user', content: 'turn 2' },
        { role: 'assistant', content: 'reply 2' },
        { role: 'user', content: 'turn 3' },
      ];
      await store.saveSession('trunc-sess', messages);

      await store.truncateSession('trunc-sess', 2);

      const loaded = await store.loadSession('trunc-sess');
      expect(loaded).toHaveLength(2);
      expect(loaded[0].content).toBe('turn 1');
      expect(loaded[1].content).toBe('reply 1');
    });

    it('should leave session unchanged when keepCount >= length', async () => {
      const store = new FileSessionStore(mockFs, '/history');
      const messages: ChatMessage[] = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ];
      await store.saveSession('trunc-noop', messages);

      await store.truncateSession('trunc-noop', 10);

      const loaded = await store.loadSession('trunc-noop');
      expect(loaded).toHaveLength(2);
    });

    it('should record and load LLM call history for budget tracking', async () => {
      const store = new FileSessionStore(mockFs, '/history');
      const record = {
        timestamp: new Date().toISOString(),
        sessionId: 'sess-123',
        model: 'gemma4:12b-mlx',
        prompt: [{ role: 'user', content: 'test prompt' } as ChatMessage],
        response: 'test response',
        inputTokens: 10,
        outputTokens: 20,
        cost: 0.00035,
        latencyMs: 150
      };

      await store.recordCall(record);
      
      const calls = await store.getCallRecords();
      expect(calls).toHaveLength(1);
      expect(calls[0].sessionId).toBe('sess-123');
      expect(calls[0].model).toBe('gemma4:12b-mlx');
      expect(calls[0].cost).toBe(0.00035);
    });
  });

  describe('FileLogger', () => {
    it('should log messages and rotate files when size threshold exceeded', async () => {
      const tempLogDir = path.join(__dirname, 'temp_logs_test');
      if (fs.existsSync(tempLogDir)) {
        fs.rmSync(tempLogDir, { recursive: true, force: true });
      }
      fs.mkdirSync(tempLogDir, { recursive: true });

      try {
        const logger = new FileLogger(mockFs, tempLogDir, 100, 3); // 100 bytes limit
        logger.info('line 1');
        await new Promise(resolve => setTimeout(resolve, 50));
        
        const mainLogPath = path.join(tempLogDir, 'agent.log');
        expect(fs.existsSync(mainLogPath)).toBe(true);

        // Log more to trigger rotation
        logger.info('line 2');
        logger.info('line 3');
        logger.info('line 4');
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(fs.existsSync(path.join(tempLogDir, 'agent.log.1'))).toBe(true);
      } finally {
        if (fs.existsSync(tempLogDir)) {
          fs.rmSync(tempLogDir, { recursive: true, force: true });
        }
      }
    });
  });
});
