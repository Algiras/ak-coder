import { FileSystem, TerminalIo, ProcessRunner, LLMService, SessionStore, Logger, ChatMessage } from '../ports';

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
    return this.files.has(path);
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
  public outputs: string[] = [];
  public errors: string[] = [];
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

  writeError(text: string): void {
    this.errors.push(text);
  }

  async selectMenu<T>(message: string, choices: { name: string; value: T }[]): Promise<T> {
    const choice = choices[this.selectedMenuIndex];
    if (!choice) throw new Error('Selected menu choice out of bounds');
    return choice.value;
  }
}

export class MockProcessRunner implements ProcessRunner {
  public mockOutputs = new Map<string, { code: number; stdout: string; stderr: string }>();

  async run(command: string, options?: { cwd?: string; timeout?: number }): Promise<{ code: number | null; stdout: string; stderr: string }> {
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
    options?: { stream?: (chunk: string) => void; signal?: AbortSignal }
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    this.lastPrompt = messages;
    if (options?.stream) {
      options.stream(this.mockResponse);
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
