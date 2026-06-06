export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  deleteFile(path: string): Promise<void>;
  listFiles(dir: string): Promise<string[]>;
}

export type ConfirmationAction = 'write_file' | 'patch_file' | 'bash';

export interface ConfirmationRequest {
  action: ConfirmationAction;
  description: string;
  detail: string;          // diff output or command string
  path?: string;           // file path (for writes/patches)
  command?: string;        // command string (for commands)
}

export interface ConfirmationResult {
  approved: boolean;
  applyToAll: boolean;     // "approve all similar" for this session
  edited?: string;         // user-edited content or command
}

export interface TerminalIo {
  ask(question: string): Promise<string>;
  askConfirm(question: string, defaultConfirm?: boolean): Promise<boolean>;
  confirm(request: ConfirmationRequest): Promise<ConfirmationResult>;
  write(text: string): void;
  writeError(text: string): void;
  selectMenu<T>(message: string, choices: { name: string; value: T }[]): Promise<T>;
}

export interface ProcessRunner {
  run(command: string, options?: { cwd?: string; timeout?: number; env?: Record<string, string> }): Promise<{ code: number | null; stdout: string; stderr: string }>;
}


export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
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
    outputSchema?: {
      type: 'object';
      properties?: Record<string, any>;
      required?: string[];
      description?: string;
    };
    annotations?: ToolAnnotations;
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
  forkSession(sessionId: string, turnIndex: number, newSessionId: string): Promise<ChatMessage[]>;
  /** Truncate a session to `keepCount` messages and persist. */
  truncateSession(sessionId: string, keepCount: number): Promise<void>;
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
