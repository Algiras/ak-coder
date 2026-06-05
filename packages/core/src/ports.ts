export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  deleteFile(path: string): Promise<void>;
  listFiles(dir: string): Promise<string[]>;
}

export interface TerminalIo {
  ask(question: string): Promise<string>;
  askConfirm(question: string, defaultConfirm?: boolean): Promise<boolean>;
  write(text: string): void;
  writeError(text: string): void;
  selectMenu<T>(message: string, choices: { name: string; value: T }[]): Promise<T>;
}

export interface ProcessRunner {
  run(command: string, options?: { cwd?: string; timeout?: number; env?: Record<string, string> }): Promise<{ code: number | null; stdout: string; stderr: string }>;
}


export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: {
      type: 'object';
      properties?: Record<string, any>;
      required?: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[]; // base64 or file paths
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface LLMService {
  chat(
    messages: ChatMessage[],
    options?: {
      stream?: (chunk: string) => void;
      signal?: AbortSignal;
      tools?: ToolDefinition[];
    }
  ): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    tool_calls?: ToolCall[];
  }>;
}

export interface LLMCallRecord {
  timestamp: string;
  sessionId: string;
  model: string;
  prompt: ChatMessage[];
  response: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  latencyMs: number;
}

export interface SessionStore {
  saveSession(sessionId: string, messages: ChatMessage[]): Promise<void>;
  loadSession(sessionId: string): Promise<ChatMessage[]>;
  listSessions(): Promise<{ sessionId: string; timestamp: number }[]>;
  recordCall(record: LLMCallRecord): Promise<void>;
  getCallRecords(): Promise<LLMCallRecord[]>;
}

export interface Logger {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, error?: any): void;
  startSpan(name: string): string;
  endSpan(spanId: string): void;
  rotate(): Promise<void>;
}
