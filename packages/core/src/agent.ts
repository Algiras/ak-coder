import {
  FileSystem,
  TerminalIo,
  ProcessRunner,
  LLMService,
  SessionStore,
  Logger,
  ChatMessage,
  ToolDefinition
} from './ports';
import { McpClient } from './mcp';
import { CommandSafetyGate } from './safety';
import { AgentHooks } from './hooks';
import { ConfirmationPolicy, ConfirmationPreset } from './confirmation';
import { VectorStore } from './features/history/vector-store';
import { WorkspaceIndexer } from './features/history/indexer';
import { CoreToolDefinition, ToolContext, registerCoreTools } from './core-tools';
import { z } from 'zod';
import { SkillsManager } from './features/skills/skills';
import { RulesManager } from './features/rules/rules';

// Re-export so downstream code that imports CoreToolDefinition from agent.ts keeps working.
export type { CoreToolDefinition };

/** Returns a compact human-readable label for a tool invocation, e.g. `read_file(src/app.ts)`. */
function formatToolCall(name: string, args: Record<string, unknown>): string {
  // Key parameter per tool name — pick the most informative one
  const key =
    args['path'] ??
    args['file_path'] ??
    args['command'] ??
    args['query'] ??
    args['pattern'] ??
    args['dir'] ??
    args['directory'] ??
    args['url'] ??
    null;

  if (key == null) return name;

  let display = String(key);
  // For paths, keep only the last 2 segments to stay compact
  if (typeof key === 'string' && (key.includes('/') || key.includes('\\'))) {
    const parts = key.replace(/\\/g, '/').split('/').filter(Boolean);
    display = parts.slice(-2).join('/');
  }
  // Truncate long values (e.g. bash commands)
  if (display.length > 40) display = display.slice(0, 38) + '…';

  return `${name}(${display})`;
}

function zodToJsonSchema(schema: z.ZodTypeAny): any {
  const description = schema.description;
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [key, propSchema] of Object.entries(schema.shape)) {
      properties[key] = zodToJsonSchema(propSchema as z.ZodTypeAny);
      if (!(propSchema instanceof z.ZodOptional) && !(propSchema instanceof z.ZodNullable)) {
        required.push(key);
      }
    }
    return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    const inner = zodToJsonSchema(schema.unwrap());
    if (description && !inner.description) inner.description = description;
    return inner;
  }
  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: schema.options, ...(description ? { description } : {}) };
  }
  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonSchema(schema.element), ...(description ? { description } : {}) };
  }
  const typeStr = schema instanceof z.ZodNumber ? 'number' : schema instanceof z.ZodBoolean ? 'boolean' : 'string';
  return { type: typeStr, ...(description ? { description } : {}) };
}

export class AgentCore {
  private messages: ChatMessage[] = [];
  private activeFiles = new Set<string>();
  private summary: string | null = null;
  private sessionId: string | null = null;
  private maxContextTokens = 16000;
  private rulesManager: RulesManager;
  private skillsManager: SkillsManager;
  private costInput = 5.0;
  private costOutput = 15.0;

  // Session-level tool execution state
  private readFiles = new Set<string>();
  private mcpClients = new Map<string, McpClient>();
  private safetyGate: CommandSafetyGate;
  private confirmationPolicy: ConfirmationPolicy;
  private hooks: AgentHooks = {};
  public delegationDepth = 0;

  // Heuristics session states
  private consecutiveReadsCount = 0;
  private hasModifiedFiles = false;
  private hasExecutedTests = false;

  private coreTools = new Map<string, CoreToolDefinition>();
  private vectorStore = new VectorStore();
  private indexer = new WorkspaceIndexer(this.vectorStore);
  public onPlanProduced?: (planText: string) => Promise<string>;
  public onCompactingStart?: () => void;
  public onCompactingEnd?: () => void;

  constructor(
    private fs: FileSystem,
    private llm: LLMService,
    private store: SessionStore,
    private logger: Logger,
    private processRunner?: ProcessRunner,
    private terminalIo?: TerminalIo,
    private workspaceRoot: string = process.cwd()
  ) {
    this.safetyGate = new CommandSafetyGate(this.fs, this.workspaceRoot);
    this.confirmationPolicy = new ConfirmationPolicy('default');
    this.rulesManager = new RulesManager(this.fs, this.logger);
    this.skillsManager = new SkillsManager(this.fs, this.logger);
    this.coreTools = registerCoreTools(this.makeToolContext());
  }

  private makeToolContext(): ToolContext {
    const self = this;
    return {
      get fs() { return self.fs; },
      get processRunner() { return self.processRunner; },
      get terminalIo() { return self.terminalIo; },
      get confirmationPolicy() { return self.confirmationPolicy; },
      get safetyGate() { return self.safetyGate; },
      get workspaceRoot() { return self.workspaceRoot; },
      get logger() { return self.logger; },
      get hooks() { return self.hooks; },
      get readFiles() { return self.readFiles; },
      get delegationDepth() { return self.delegationDepth; },
      vectorStore: this.vectorStore,
      getIndexer: () => self.indexer,
      setIndexer: (idx) => { self.indexer = idx; },
      getSessionId: () => self.sessionId,
       incrementConsecutiveReads: () => {
        self.consecutiveReadsCount++;
        if (self.consecutiveReadsCount > 5) {
          const warnMsg = `\x1b[33m[Heuristic Alert: Agent has read ${self.consecutiveReadsCount} files consecutively without taking modifying actions.]\x1b[0m\n`;
          if (self.terminalIo) {
            self.terminalIo.write(warnMsg);
          }
        }
        return self.consecutiveReadsCount;
      },
      resetConsecutiveReads: () => { self.consecutiveReadsCount = 0; },
      markModified: () => { self.hasModifiedFiles = true; },
      markTestsExecuted: () => { self.hasExecutedTests = true; },
      resolveWorkspacePath: (p) => self.resolveWorkspacePath(p),
      createChildAgent: (sessionId) => {
        const child = new AgentCore(
          self.fs, self.llm, self.store, self.logger,
          self.processRunner, self.terminalIo, self.workspaceRoot
        );
        child.delegationDepth = self.delegationDepth + 1;
        child.setPricing(self.costInput, self.costOutput);
        const preset = self.confirmationPolicy.getPresetName();
        if (preset) child.setConfirmationMode(preset);
        return child;
      }
    };
  }


  setMaxContextTokens(tokens: number): void {
    this.maxContextTokens = tokens;
  }

  setPricing(costInput: number, costOutput: number): void {
    this.costInput = costInput;
    this.costOutput = costOutput;
  }

  setConfirmationMode(preset: ConfirmationPreset): void {
    this.confirmationPolicy.setPreset(preset);
  }

  get agentsRules(): string | null {
    return this.rulesManager.getRules();
  }

  set agentsRules(val: string | null) {
    this.rulesManager.setRules(val);
  }

  getConfirmationPolicy(): ConfirmationPolicy {
    return this.confirmationPolicy;
  }

  registerHooks(hooks: AgentHooks): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  async startSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.readFiles.clear();
    this.consecutiveReadsCount = 0;
    this.hasModifiedFiles = false;
    this.hasExecutedTests = false;
    await this.safetyGate.loadPermissions();
    try {
      this.messages = await this.store.loadSession(sessionId);
      this.logger.info(`Session resumed: ${sessionId} (messages: ${this.messages.length})`);
    } catch {
      this.messages = [];
      this.logger.info(`New session started: ${sessionId}`);
    }
    // Automatically load workspace rules and skills at session start
    await this.loadAgentsRules(this.workspaceRoot);
    await this.loadSkills(this.workspaceRoot);
  }

  async loadAgentsRules(workspaceRoot: string): Promise<void> {
    await this.rulesManager.loadAgentsRules(workspaceRoot);
  }

  async loadSkills(workspaceRoot: string): Promise<void> {
    await this.skillsManager.loadSkills(workspaceRoot);
  }

  async listSessions(): Promise<{ sessionId: string; timestamp: number }[]> {
    return this.store.listSessions();
  }

  spawnChildAgent(): AgentCore {
    const child = new AgentCore(
      this.fs, this.llm, this.store, this.logger,
      this.processRunner, this.terminalIo, this.workspaceRoot
    );
    child.delegationDepth = this.delegationDepth + 1;
    child.setPricing(this.costInput, this.costOutput);
    child.setMaxContextTokens(this.maxContextTokens);
    // Inherit parent's confirmation mode so sub-agents respect yolo/plan/etc.
    const preset = this.confirmationPolicy.getPresetName();
    if (preset) child.setConfirmationMode(preset);
    return child;
  }

  async forkSession(turnIndex: number, newSessionId?: string): Promise<string> {
    if (!this.sessionId) throw new Error('No active session to fork.');
    // Persist current state first so forkSession can read it from the store
    await this.store.saveSession(this.sessionId, this.messages);
    const forkedId = newSessionId || `fork-${this.sessionId}-${Date.now()}`;
    await this.store.forkSession(this.sessionId, turnIndex, forkedId);
    return forkedId;
  }

  /**
   * Rewind the conversation to just after the Nth user turn (0-based).
   * Keeps the user message at that turn and its assistant reply; discards everything after.
   * Persists the truncated session to the store.
   */
  async rewindToTurn(turnIndex: number): Promise<void> {
    if (!this.sessionId) throw new Error('No active session to rewind.');

    // Collect indices of user messages to identify turn boundaries
    const userMessageIndices = this.messages
      .map((m, i) => (m.role === 'user' ? i : -1))
      .filter(i => i >= 0);

    if (turnIndex < 0 || turnIndex >= userMessageIndices.length) {
      throw new Error(`Turn ${turnIndex} out of range (0–${userMessageIndices.length - 1}).`);
    }

    // Keep everything up to (but not including) the NEXT user turn after the target
    const nextUserIdx = userMessageIndices[turnIndex + 1] ?? this.messages.length;
    this.messages = this.messages.slice(0, nextUserIdx);
    await this.store.saveSession(this.sessionId, this.messages);
  }

  /** Returns user turns as [{index, preview}] for display in rewind pickers. */
  getUserTurns(): { turnIndex: number; messageIndex: number; preview: string }[] {
    const result: { turnIndex: number; messageIndex: number; preview: string }[] = [];
    let turnIndex = 0;
    for (let i = 0; i < this.messages.length; i++) {
      const m = this.messages[i];
      if (m.role === 'user') {
        const raw = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        result.push({
          turnIndex: turnIndex++,
          messageIndex: i,
          preview: raw.replace(/\n+/g, ' ').slice(0, 60),
        });
      }
    }
    return result;
  }

  async loadPlugins(pluginsDir: string): Promise<void> {
    const exists = await this.fs.exists(pluginsDir);
    if (!exists) return;
    const allEntries = await this.fs.listFiles(pluginsDir);
    const manifestPaths = allEntries.filter(f => f.endsWith('/plugin.json') || f === `${pluginsDir}/plugin.json`);
    for (const manifestPath of manifestPaths) {
      try {
        const raw = await this.fs.readFile(manifestPath);
        const manifest = JSON.parse(raw) as { name?: string; command: string; args?: string[] };
        if (!manifest.command) continue;
        const dirParts = manifestPath.split('/');
        dirParts.pop();
        const pluginName = manifest.name || dirParts.pop() || 'plugin';
        const client = new McpClient(pluginName, manifest.command, manifest.args ?? [], this.logger);
        await client.start();
        this.mcpClients.set(pluginName, client);
        this.logger.info(`Loaded plugin: ${pluginName}`);
      } catch (e) {
        this.logger.warn(`Failed to load plugin from ${manifestPath}: ${(e as Error).message}`);
      }
    }
  }

  async loadMcpServers(mcpConfigs: Record<string, { command: string; args: string[] }>): Promise<void> {
    for (const [name, cfg] of Object.entries(mcpConfigs)) {
      try {
        const client = new McpClient(name, cfg.command, cfg.args, this.logger);
        await client.start();
        this.mcpClients.set(name, client);
        this.logger.info(`Successfully started MCP server "${name}"`);
      } catch (e) {
        this.logger.error(`Failed to start MCP server "${name}": ${(e as Error).message}`);
      }
    }
  }

  async stopMcpServers(): Promise<void> {
    for (const client of this.mcpClients.values()) {
      await client.stop();
    }
    this.mcpClients.clear();
  }

  private async getCombinedToolsList(): Promise<ToolDefinition[]> {
    const combined: ToolDefinition[] = [];
    
    // Register Core Tools using Zod-to-JSON-Schema converter
    for (const tool of this.coreTools.values()) {
      const toolDef: ToolDefinition = {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: zodToJsonSchema(tool.schema),
          ...(tool.outputSchema ? { outputSchema: zodToJsonSchema(tool.outputSchema) } : {}),
          ...(tool.annotations ? { annotations: tool.annotations } : {})
        }
      };
      combined.push(toolDef);
    }

    // Register MCP Tools
    for (const [serverName, client] of this.mcpClients.entries()) {
      try {
        const tools = await client.listTools();
        for (const tool of tools) {
          combined.push({
            type: 'function',
            function: {
              name: `${serverName}__${tool.name}`,
              description: `[MCP: ${serverName}] ${tool.description || ''}`,
              parameters: tool.inputSchema as any,
              ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {})
            }
          });
        }
      } catch (e) {
        this.logger.warn(`Failed to retrieve tools from MCP server "${serverName}": ${(e as Error).message}`);
      }
    }
    if (this.confirmationPolicy.getPresetName() === 'plan') {
      const mutatingTools = new Set(['write_file', 'patch_file', 'bash']);
      return combined.filter(t => !mutatingTools.has(t.function.name));
    }

    return combined;
  }

  async addFileToContext(filePath: string): Promise<void> {
    if (await this.fs.exists(filePath)) {
      this.activeFiles.add(filePath);
      this.logger.info(`File added to context: ${filePath}`);
    } else {
      throw new Error(`File does not exist: ${filePath}`);
    }
  }

  removeFileFromContext(filePath: string): void {
    this.activeFiles.delete(filePath);
    this.logger.info(`File removed from context: ${filePath}`);
  }

  getActiveFiles(): string[] {
    return Array.from(this.activeFiles);
  }

  getSkills(): { name: string; description: string; content: string }[] {
    return this.skillsManager.getSkills();
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  getContextSummary(): string | null {
    return this.summary;
  }

  getContextInfo(): {
    sessionId: string | null;
    mode: string | null;
    contextPct: number;
    estimatedTokens: number;
    maxTokens: number;
    messageCount: number;
    agentsRulesChars: number;
    summary: string | null;
    activeFiles: string[];
    skills: { name: string; description: string }[];
    mcpServers: string[];
  } {
    const totalChars = this.messages.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = Math.ceil(totalChars / 4);
    const contextPct = Math.min(100, Math.round((estimatedTokens / this.maxContextTokens) * 100));
    return {
      sessionId: this.sessionId,
      mode: this.confirmationPolicy.getPresetName(),
      contextPct,
      estimatedTokens,
      maxTokens: this.maxContextTokens,
      messageCount: this.messages.length,
      agentsRulesChars: this.agentsRules?.length ?? 0,
      summary: this.summary,
      activeFiles: Array.from(this.activeFiles),
      skills: this.skillsManager.getSkills().map(s => ({ name: s.name, description: s.description })),
      mcpServers: Array.from(this.mcpClients.keys()),
    };
  }

  getStatus(): { contextPct: number; mode: string } {
    const totalChars = this.messages.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = Math.ceil(totalChars / 4);
    const contextPct = Math.min(100, Math.round((estimatedTokens / this.maxContextTokens) * 100));
    return { contextPct, mode: this.confirmationPolicy.getPresetName() };
  }

  async getFormattedContextPrompt(): Promise<string> {
    let contextStr = '';
    for (const file of this.activeFiles) {
      try {
        const content = await this.fs.readFile(file);
        contextStr += `\n--- File: ${file} ---\n${content}\n---------------------\n`;
      } catch (e) {
        this.logger.warn(`Failed to read file for context: ${file}`, e);
      }
    }
    return contextStr;
  }

  private async expandFileReferences(input: string): Promise<string> {
    const FILE_SIZE_LIMIT = 100 * 1024; // 100KB
    const pattern = /@([^\s]+)/g;
    let result = input;
    const matches = [...input.matchAll(pattern)];
    for (const match of matches) {
      const token = match[1];
      const resolved = this.resolveWorkspacePath(token);
      if (await this.fs.exists(resolved)) {
        try {
          const content = await this.fs.readFile(resolved);
          if (content.length > FILE_SIZE_LIMIT) {
            result = result.replace(match[0], `[file too large: ${token}]`);
          } else {
            result = result.replace(
              match[0],
              `@${token}\n<file path="${token}">\n${content}\n</file>`
            );
          }
        } catch {
          // leave token untouched on read error
        }
      }
    }
    return result;
  }

  async processMessage(
    userText: string,
    images: string[] = [],
    streamCallback?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<{ text: string; inputTokens: number; outputTokens: number; cost: number; compacted: boolean }> {
    const spanId = this.logger.startSpan('processMessage');
    let compacted = false;

    // 0. Expand @file references before building the prompt
    userText = await this.expandFileReferences(userText);

    // 1. Build context files dump
    const contextFilesDump = await this.getFormattedContextPrompt();

    // 2. Build full prompt
    const fullUserContent = contextFilesDump 
      ? `${contextFilesDump}\nUser Prompt:\n${userText}`
      : userText;

    // Append user message
    this.messages.push({ role: 'user', content: fullUserContent, images });

    // 3. Check and trigger compaction if needed
    const totalChars = this.messages.map(m => m.content.length).reduce((a, b) => a + b, 0);
    const estimatedTokens = Math.ceil(totalChars / 4);

    if (estimatedTokens > this.maxContextTokens) {
      this.onCompactingStart?.();
      await this.compact();
      this.onCompactingEnd?.();
      compacted = true;
    }

    let loopCount = 0;
    const maxLoops = 25;
    let finalResponseText = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (loopCount < maxLoops) {
      // Assemble final messages array for LLM (including system prompt)
      let systemPromptContent = `You are ak-coder, a powerful agentic terminal-based coding assistant.
Your workspace contains files which may be injected above the user prompt.
${this.agentsRules ? `\n[Project-Specific Rules & Build Instructions:\n${this.agentsRules}]\n` : ''}`;

      if (this.skillsManager.getSkills().length > 0) {
        systemPromptContent += '\n\nAvailable Skills:';
        for (const skill of this.skillsManager.getSkills()) {
          systemPromptContent += `\n- Skill Name: ${skill.name}\n  Description: ${skill.description}\n  Instructions:\n${skill.content}\n`;
        }
      }

      if (this.summary) {
        systemPromptContent += `\n[Summary of previous conversation: ${this.summary}]\n`;
      }

      if (this.confirmationPolicy.getPresetName() === 'plan') {
        systemPromptContent += `\n\n**PLAN MODE ACTIVE.** Do not call write_file, patch_file, or bash — those tools are disabled. Use only read-only tools (read_file, list_directory, grep_search, semantic_search) to gather context. Your final response must be a structured implementation plan: goal, files to change, step-by-step approach, and verification steps. The user will review the plan before any execution.`;
      }

      const systemPrompt: ChatMessage = {
        role: 'system',
        content: systemPromptContent
      };

      let payload = [systemPrompt, ...this.messages];

      if (this.hooks.beforeChat) {
        const hookPayload = await this.hooks.beforeChat(payload, {
          sessionId: this.sessionId || 'unknown',
          workspaceRoot: this.workspaceRoot
        });
        if (hookPayload) {
          payload = hookPayload;
        }
      }

      const startTime = Date.now();
      this.logger.info('Calling LLM Service', { messageCount: payload.length, loopCount });

      const combinedTools = await this.getCombinedToolsList();

      if (signal?.aborted) throw new DOMException('Interrupted', 'AbortError');

      const result = await this.llm.chat(payload, {
        stream: streamCallback,
        tools: combinedTools,
        signal
      });

      if (this.hooks.afterChat) {
        const hookResultText = await this.hooks.afterChat(result.text, {
          sessionId: this.sessionId || 'unknown',
          workspaceRoot: this.workspaceRoot
        });
        if (hookResultText !== undefined && hookResultText !== null) {
          result.text = hookResultText;
        }
      }

      const latencyMs = Date.now() - startTime;
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;

      this.logger.info('LLM Service response completed', { outputTokens: result.outputTokens, latencyMs });


      // Record Call in Session Store
      const currentCost = (result.inputTokens * this.costInput + result.outputTokens * this.costOutput) / 1000000;
      try {
        await this.store.recordCall({
          timestamp: new Date().toISOString(),
          sessionId: this.sessionId || 'unknown',
          model: (this.llm as any).defaultModel || 'unknown',
          prompt: payload,
          response: result.text || `[Tool Calls: ${result.tool_calls?.map(tc => tc.function.name).join(', ')}]`,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          cost: currentCost,
          latencyMs
        });
      } catch (e) {
        this.logger.warn(`Failed to record call details: ${(e as Error).message}`);
      }

      if (result.text) {
        finalResponseText = result.text;
      }

      if (!result.tool_calls || result.tool_calls.length === 0) {
        // Append assistant message and finish ReAct loop
        this.messages.push({ role: 'assistant', content: result.text || '' });
        break;
      }

      // Append assistant message containing the tool calls
      this.messages.push({
        role: 'assistant',
        content: result.text || '',
        tool_calls: result.tool_calls
      });

      // Partition tool calls: read-only ones run in parallel, others run sequentially.
      // Within a parallel group, one failure does not stop the others.
      const toolCallsWithArgs = result.tool_calls.map(tc => {
        let args: any;
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
        return { tc, args };
      });

      // Determine which calls in THIS turn are all read-only
      const allReadOnly = toolCallsWithArgs.every(({ tc }) => {
        const coreTool = this.coreTools.get(tc.function.name);
        return coreTool?.annotations?.readOnlyHint === true;
      });

      if (allReadOnly && toolCallsWithArgs.length > 1) {
        // Run in parallel — each failure is isolated
        if (this.terminalIo) {
          const labels = toolCallsWithArgs.map(x => formatToolCall(x.tc.function.name, x.args)).join('  ·  ');
          this.terminalIo.write(`\x1b[36m⠋ ${labels}\x1b[0m\n`);
        }
        const settled = await Promise.allSettled(
          toolCallsWithArgs.map(({ tc, args }) =>
            this.executeSingleTool(tc.id, tc.function.name, args)
          )
        );
        for (let i = 0; i < toolCallsWithArgs.length; i++) {
          const { tc } = toolCallsWithArgs[i];
          const outcome = settled[i];
          const content = outcome.status === 'fulfilled'
            ? outcome.value
            : `Error: ${(outcome.reason as Error).message}`;
          this.messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content });
        }
      } else {
        // Sequential execution — mutating or mixed calls must stay ordered
        for (const { tc, args } of toolCallsWithArgs) {
          if (this.terminalIo) {
            this.terminalIo.write(`\x1b[36m⠋ ${formatToolCall(tc.function.name, args)}\x1b[0m\n`);
          }
          let content: string;
          try {
            content = await this.executeSingleTool(tc.id, tc.function.name, args);
          } catch (e) {
            content = `Error: ${(e as Error).message}`;
          }
          this.messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content });
        }
      }

      loopCount++;
    }

    if (loopCount >= maxLoops) {
      const loopWarning = '\n\x1b[33m[Warning: Consecutive tool execution limit of 25 calls reached. Stopping to protect token budget.]\x1b[0m\n';
      if (this.terminalIo) {
        this.terminalIo.write(loopWarning);
      }
      this.logger.warn('Consecutive tool calling limit reached');
      finalResponseText += loopWarning;
    }

     if (this.hasModifiedFiles && !this.hasExecutedTests) {
      const testWarning = '\x1b[33m[Heuristic Alert: Files modified but no test commands executed. Consider running bun test.]\x1b[0m\n';
      if (this.terminalIo) {
        this.terminalIo.write(testWarning);
      }
      this.logger.info('Heuristics check: changes made but no tests executed');
     }

    // Save final session state
    if (this.sessionId) {
      await this.store.saveSession(this.sessionId, this.messages);
    }

    // Persist plan artifact when plan mode is active
    if (this.confirmationPolicy.getPresetName() === 'plan' && this.onPlanProduced && finalResponseText) {
      try {
        const planPath = await this.onPlanProduced(finalResponseText);
        this.terminalIo?.write(`\x1b[90mPlan saved → ${planPath}\x1b[0m`);
      } catch (e) {
        this.logger.warn(`Failed to persist plan file: ${(e as Error).message}`);
      }
    }

    this.logger.endSpan(spanId);

    const cost = (totalInputTokens * this.costInput + totalOutputTokens * this.costOutput) / 1000000;

    return {
      text: finalResponseText,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cost,
      compacted
    };
  }

  private async executeSingleTool(toolCallId: string, toolName: string, args: any): Promise<string> {
    const isMcp = toolName.includes('__');
    if (isMcp) {
      const idx = toolName.indexOf('__');
      const serverName = toolName.substring(0, idx);
      const mcpToolName = toolName.substring(idx + 2);
      const client = this.mcpClients.get(serverName);
      if (!client) {
        throw new Error(`MCP Server "${serverName}" is not running.`);
      }
      const result = await client.callTool(mcpToolName, args);
      if (result.content && Array.isArray(result.content)) {
        return result.content.map((c: any) => c.text).join('\n');
      }
      return JSON.stringify(result);
    }

    const coreTool = this.coreTools.get(toolName);
    if (!coreTool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    const parsed = coreTool.schema.safeParse(args);
    if (!parsed.success) {
      const formattedErrors = parsed.error.issues
        .map(e => `${e.path.join('.')}: ${e.message}`)
        .join(', ');
      throw new Error(`Invalid params: ${formattedErrors}`);
    }

    const output = await coreTool.handler(parsed.data);

    if (coreTool.outputSchema) {
      const outParsed = coreTool.outputSchema.safeParse(
        typeof output === 'string' ? output : JSON.parse(output as string)
      );
      if (!outParsed.success) {
        const errs = outParsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        this.logger.warn(`Tool "${toolName}" output failed schema validation: ${errs}`);
      }
    }

    return output;
  }

  private resolveWorkspacePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
      return normalized;
    }
    return `${this.workspaceRoot.replace(/\/$/, '')}/${normalized}`;
  }

  async forceCompact(): Promise<{ messagesBefore: number; messagesAfter: number; summaryLength: number }> {
    const messagesBefore = this.messages.length;
    this.onCompactingStart?.();
    await this.compact();
    this.onCompactingEnd?.();
    return { messagesBefore, messagesAfter: this.messages.length, summaryLength: this.summary?.length ?? 0 };
  }

  private async compact(): Promise<void> {
    this.logger.info('Context limit exceeded. Compacting history...');
    
    const preserveCount = Math.min(4, this.messages.length);
    const summaryTarget = this.messages.slice(0, this.messages.length - preserveCount);
    const preserved = this.messages.slice(this.messages.length - preserveCount);

    const compactionPrompt: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are a summarization assistant. Summarize the following dialogue between a developer and a coding agent. Retain all engineering decisions, filenames, edits, and technical details. Keep it concise.'
      },
      ...summaryTarget
    ];

    const summaryResult = await this.llm.chat(compactionPrompt);
    this.summary = summaryResult.text;
    this.messages = preserved;

    if (this.sessionId && this.summary) {
      const summaryFile = `.ak-coder/history/summary_${this.sessionId}.txt`;
      const resolvedPath = this.resolveWorkspacePath(summaryFile);
      try {
        await this.fs.writeFile(resolvedPath, this.summary);
      } catch (e) {
        this.logger.warn(`Failed to save summary file: ${(e as Error).message}`);
      }
      this.indexer.indexSummary(this.summary, this.sessionId);
    }

    this.logger.info('Compaction complete', { summaryLength: this.summary?.length ?? 0 });
  }
}
