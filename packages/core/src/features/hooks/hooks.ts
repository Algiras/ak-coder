export interface HookContext {
  sessionId: string;
  workspaceRoot: string;
}

export interface PreWriteContext extends HookContext {
  path: string;
  content: string;
}

export interface PostWriteContext extends HookContext {
  path: string;
  content: string;
  success: boolean;
}

export interface PreCommandContext extends HookContext {
  command: string;
}

export interface PostCommandContext extends HookContext {
  command: string;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface AgentHooks {
  beforeChat?: (messages: any[], context: HookContext) => Promise<any[] | void> | any[] | void;
  afterChat?: (response: string, context: HookContext) => Promise<string | void> | string | void;
  beforeWriteFile?: (context: PreWriteContext) => Promise<{ content?: string; cancel?: boolean } | void> | { content?: string; cancel?: boolean } | void;
  afterWriteFile?: (context: PostWriteContext) => Promise<void> | void;
  beforeExecuteCommand?: (context: PreCommandContext) => Promise<{ command?: string; cancel?: boolean } | void> | { command?: string; cancel?: boolean } | void;
  afterExecuteCommand?: (context: PostCommandContext) => Promise<void> | void;
}
