import { FileSystem, TerminalIo, ProcessRunner, LLMService, SessionStore, Logger, ChatMessage, ConfirmationRequest, ConfirmationResult, StreamCallback } from '../ports';

export class MockFileSystem implements FileSystem {
  public files = new Map<string, string>();

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async exists(path: string): Promise<boolean> {
    if (this.files.has(path)) return true;
    // Also return true for directory paths that are prefixes of known files
    const prefix = path.endsWith('/') ? path : path + '/';
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async listFiles(dir: string): Promise<string[]> {
    return Array.from(this.files.keys()).filter(p => p.startsWith(dir));
  }
}

export class MockTerminalIo implements TerminalIo {
  public inputs: string[] = [];
  public confirms: boolean[] = [];
  public confirmResults: ConfirmationResult[] = [];
  public outputs: string[] = [];
  public errors: string[] = [];
  public activities: string[] = [];
  public selectedMenuIndex = 0;

  async ask(question: string): Promise<string> {
    const val = this.inputs.shift();
    return val !== undefined ? val : '';
  }

  async askConfirm(question: string, defaultConfirm = true): Promise<boolean> {
    const val = this.confirms.shift();
    return val !== undefined ? val : defaultConfirm;
  }

  write(text: string): void {
    this.outputs.push(text);
  }

  setActivity(label: string): void {
    this.activities.push(label);
  }

  clearActivity(): void {
    this.activities.push('');
  }

  writeError(text: string): void {
    this.errors.push(text);
  }

  async confirm(request: ConfirmationRequest): Promise<ConfirmationResult> {
    const result = this.confirmResults.shift();
    return result ?? { approved: false, applyToAll: false };
  }

  async selectMenu<T>(message: string, choices: { name: string; value: T }[]): Promise<T> {
    const choice = choices[this.selectedMenuIndex];
    if (!choice) throw new Error('Selected menu choice out of bounds');
    return choice.value;
  }
}

export class MockProcessRunner implements ProcessRunner {
  public mockOutputs = new Map<string, { code: number; stdout: string; stderr: string }>();
  public commands: string[] = [];

  async run(command: string, options?: { cwd?: string; timeout?: number; env?: Record<string, string> }): Promise<{ code: number | null; stdout: string; stderr: string }> {
    this.commands.push(command);
    const mock = this.mockOutputs.get(command);
    if (mock) return mock;
    return { code: 0, stdout: `Executed: ${command}`, stderr: '' };
  }
}


export class MockLlmService implements LLMService {
  public mockResponse = 'Hello from Mock LLM';
  public inputTokens = 10;
  public outputTokens = 15;
  public lastPrompt: ChatMessage[] = [];

  async chat(
    messages: ChatMessage[],
    options?: { stream?: StreamCallback; signal?: AbortSignal }
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    this.lastPrompt = messages;
    if (options?.stream) {
      options.stream({ type: 'content', text: this.mockResponse });
    }
    return {
      text: this.mockResponse,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens
    };
  }
}

export class MockSessionStore implements SessionStore {
  public sessions = new Map<string, ChatMessage[]>();
  public calls: any[] = [];

  async saveSession(sessionId: string, messages: ChatMessage[]): Promise<void> {
    this.sessions.set(sessionId, messages);
  }

  async loadSession(sessionId: string): Promise<ChatMessage[]> {
    const history = this.sessions.get(sessionId);
    if (!history) throw new Error(`Session ${sessionId} not found`);
    return history;
  }

  async listSessions(): Promise<{ sessionId: string; timestamp: number }[]> {
    return Array.from(this.sessions.keys()).map(id => ({
      sessionId: id,
      timestamp: Date.now()
    }));
  }

  async forkSession(sessionId: string, turnIndex: number, newSessionId: string): Promise<ChatMessage[]> {
    const history = this.sessions.get(sessionId);
    if (!history) throw new Error(`Session ${sessionId} not found`);
    if (turnIndex < 0 || turnIndex >= history.length) {
      throw new Error(`Turn index ${turnIndex} out of bounds (history size: ${history.length})`);
    }
    const forked = history.slice(0, turnIndex + 1);
    this.sessions.set(newSessionId, forked);
    return forked;
  }

  async truncateSession(sessionId: string, keepCount: number): Promise<void> {
    const history = this.sessions.get(sessionId) ?? [];
    this.sessions.set(sessionId, history.slice(0, keepCount));
  }

  async recordCall(record: any): Promise<void> {
    this.calls.push(record);
  }

  async getCallRecords(): Promise<any[]> {
    return this.calls;
  }
}

export class MockLogger implements Logger {
  public logs: { level: 'info' | 'warn' | 'error'; message: string; meta?: any }[] = [];
  public activeSpans = new Set<string>();

  info(message: string, meta?: any): void {
    this.logs.push({ level: 'info', message, meta });
  }

  warn(message: string, meta?: any): void {
    this.logs.push({ level: 'warn', message, meta });
  }

  error(message: string, error?: any): void {
    this.logs.push({ level: 'error', message, meta: error });
  }

  startSpan(name: string): string {
    const id = `${name}-${Math.random()}`;
    this.activeSpans.add(id);
    return id;
  }

  endSpan(spanId: string): void {
    this.activeSpans.delete(spanId);
  }

  async rotate(): Promise<void> {
    // No-op in mock
  }
}
