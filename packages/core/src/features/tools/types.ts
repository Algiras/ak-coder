import { FileSystem, TerminalIo, ProcessRunner, Logger, ToolAnnotations, StreamCallback } from '../../ports';
import { ConfirmationPolicy } from '../confirmation/confirmation';
import { CommandSafetyGate } from '../safety/safety';
import { AgentHooks } from '../hooks/hooks';
import { VectorStore } from '../history/vector-store';
import { WorkspaceIndexer } from '../history/indexer';
import { z } from 'zod';

export interface CoreToolDefinition<TSchema extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string;
  description: string;
  schema: TSchema;
  outputSchema?: z.ZodTypeAny;
  annotations?: ToolAnnotations;
  handler: (args: z.infer<TSchema>) => Promise<string> | string;
}

export interface ChildAgent {
  delegationDepth: number;
  agentsRules: string | null;
  addFileToContext(path: string): Promise<void>;
  startSession(id: string): Promise<void>;
  processMessage(
    text: string,
    images?: string[],
    streamCallback?: StreamCallback,
    signal?: AbortSignal
  ): Promise<{ text: string; inputTokens: number; outputTokens: number; cost: number; compacted: boolean }>;
}

export interface ToolContext {
  fs: FileSystem;
  processRunner: ProcessRunner | undefined;
  terminalIo: TerminalIo | undefined;
  confirmationPolicy: ConfirmationPolicy;
  safetyGate: CommandSafetyGate;
  workspaceRoot: string;
  logger: Logger;
  hooks: AgentHooks;
  readFiles: Set<string>;

  // Semantic search state
  vectorStore: VectorStore;
  getIndexer(): WorkspaceIndexer;
  setIndexer(idx: WorkspaceIndexer): void;

  // Session
  getSessionId(): string | null;

  // Delegation depth for delegate_task recursion guard
  delegationDepth: number;

  // Mutable counters / flags
  incrementConsecutiveReads(): number;
  resetConsecutiveReads(): void;
  markModified(): void;
  markTestsExecuted(): void;

  // Path utilities
  resolveWorkspacePath(path: string): string;

  // Sub-agent factory for delegate_task
  createChildAgent(sessionId: string): ChildAgent;
}
