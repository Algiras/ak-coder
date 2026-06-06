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
import { McpClient } from './features/mcp/mcp';
import { CommandSafetyGate } from './features/safety/safety';
import { AgentHooks } from './features/hooks/hooks';
import { ConfirmationPolicy, ConfirmationPreset } from './features/confirmation/confirmation';
import { VectorStore } from './features/history/vector-store';
import { WorkspaceIndexer } from './features/history/indexer';
import { CoreToolDefinition, ToolContext, registerCoreTools } from './core-tools';
import { SkillsManager } from './features/skills/skills';
import { RulesManager } from './features/rules/rules';
import { zodToJsonSchema } from './features/tools/schema';
import { formatToolCall, showToolActivity, clearToolActivity } from './features/tools/utils';
import { AgentContextManager } from './features/context/context';
import { AgentSessionManager } from './features/history/session';
import { AgentCompactor } from './features/compaction/compactor';
import { HeuristicAuditor } from './features/heuristics/heuristics';

export type { CoreToolDefinition };

export interface AgentCoreOptions {
  maxContextTokens?: number;
  costInput?: number;
  costOutput?: number;
  confirmationPreset?: ConfirmationPreset;
}

export class AgentCore {
  private messages: ChatMessage[] = [];
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

  private coreTools = new Map<string, CoreToolDefinition>();
  private vectorStore = new VectorStore();
  private indexer = new WorkspaceIndexer(this.vectorStore);
  public onPlanProduced?: (planText: string) => Promise<string>;
  public onCompactingStart?: () => void;
  public onCompactingEnd?: () => void;

  private contextManager: AgentContextManager;
  private sessionManager: AgentSessionManager;
  private compactor: AgentCompactor;
  private heuristicAuditor: HeuristicAuditor;

  constructor(
    private fs: FileSystem,
    private llm: LLMService,
    private store: SessionStore,
    private logger: Logger,
    private processRunner?: ProcessRunner,
    private terminalIo?: TerminalIo,
    private workspaceRoot: string = process.cwd(),
    options?: AgentCoreOptions
  ) {
    this.maxContextTokens = options?.maxContextTokens ?? 16000;
    this.costInput = options?.costInput ?? 5.0;
    this.costOutput = options?.costOutput ?? 15.0;
    this.confirmationPolicy = new ConfirmationPolicy(options?.confirmationPreset ?? 'default');

    this.safetyGate = new CommandSafetyGate(this.fs, this.workspaceRoot);
    this.rulesManager = new RulesManager(this.fs, this.logger);
    this.skillsManager = new SkillsManager(this.fs, this.logger);
    this.coreTools = registerCoreTools(this.makeToolContext());
    this.heuristicAuditor = new HeuristicAuditor(this.terminalIo, this.logger);

    this.contextManager = new AgentContextManager(
      this.fs,
      this.logger,
      (p) => this.resolveWorkspacePath(p)
    );

    this.sessionManager = new AgentSessionManager(
      this.store,
      () => this.messages,
      (msgs) => { this.messages = msgs; },
      () => this.sessionId,
      (id) => { this.sessionId = id; },
      (msgs) => {
        this.logger.info(`Session resumed: ${this.sessionId} (messages: ${msgs.length})`);
      },
      () => {
        this.logger.info(`New session started: ${this.sessionId}`);
      }
    );

    this.compactor = new AgentCompactor(
      this.fs,
      this.llm,
      this.logger,
      () => this.indexer,
      () => this.sessionId,
      () => this.messages,
      (msgs) => { this.messages = msgs; },
      () => this.summary,
      (sum) => { this.summary = sum; },
      (p) => this.resolveWorkspacePath(p)
    );
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
        return self.heuristicAuditor.incrementConsecutiveReads();
      },
      resetConsecutiveReads: () => { self.heuristicAuditor.resetConsecutiveReads(); },
      markModified: () => { self.heuristicAuditor.markModified(); },
      markTestsExecuted: () => { self.heuristicAuditor.markTestsExecuted(); },
      resolveWorkspacePath: (p) => self.resolveWorkspacePath(p),
      createChildAgent: (sessionId) => {
        const child = new AgentCore(
          self.fs, self.llm, self.store, self.logger,
          self.processRunner, self.terminalIo, self.workspaceRoot,
          {
            maxContextTokens: self.maxContextTokens,
            costInput: self.costInput,
            costOutput: self.costOutput,
            confirmationPreset: self.confirmationPolicy.getPresetName() ?? 'default'
          }
        );
        child.delegationDepth = self.delegationDepth + 1;
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
    this.readFiles.clear();
    this.heuristicAuditor.resetSession();
    await this.safetyGate.loadPermissions();
    await this.sessionManager.startSession(sessionId);
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
    return this.sessionManager.listSessions();
  }

  spawnChildAgent(): AgentCore {
    const child = new AgentCore(
      this.fs, this.llm, this.store, this.logger,
      this.processRunner, this.terminalIo, this.workspaceRoot,
      {
        maxContextTokens: this.maxContextTokens,
        costInput: this.costInput,
        costOutput: this.costOutput,
        confirmationPreset: this.confirmationPolicy.getPresetName() ?? 'default'
      }
    );
    child.delegationDepth = this.delegationDepth + 1;
    return child;
  }

  async forkSession(turnIndex: number, newSessionId?: string): Promise<string> {
    return this.sessionManager.forkSession(turnIndex, newSessionId);
  }

  async rewindToTurn(turnIndex: number): Promise<void> {
    return this.sessionManager.rewindToTurn(turnIndex);
  }

  getUserTurns(): { turnIndex: number; messageIndex: number; preview: string }[] {
    return this.sessionManager.getUserTurns();
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
      this.contextManager.addFile(filePath);
      this.logger.info(`File added to context: ${filePath}`);
    } else {
      throw new Error(`File does not exist: ${filePath}`);
    }
  }

  removeFileFromContext(filePath: string): void {
    this.contextManager.removeFile(filePath);
    this.logger.info(`File removed from context: ${filePath}`);
  }

  getActiveFiles(): string[] {
    return this.contextManager.getActiveFiles();
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

  getContextInfo() {
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
      activeFiles: this.contextManager.getActiveFiles(),
      skills: this.skillsManager.getSkills().map(s => ({ name: s.name, description: s.description })),
      mcpServers: Array.from(this.mcpClients.keys()),
    };
  }

  getStatus() {
    const totalChars = this.messages.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = Math.ceil(totalChars / 4);
    const contextPct = Math.min(100, Math.round((estimatedTokens / this.maxContextTokens) * 100));
    return { contextPct, mode: this.confirmationPolicy.getPresetName() };
  }

  async getFormattedContextPrompt(): Promise<string> {
    return this.contextManager.getFormattedContextPrompt();
  }

  private async expandFileReferences(input: string): Promise<string> {
    return this.contextManager.expandFileReferences(input);
  }

  async processMessage(
    userText: string,
    images: string[] = [],
    streamCallback?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<{ text: string; inputTokens: number; outputTokens: number; cost: number; compacted: boolean }> {
    const spanId = this.logger.startSpan('processMessage');
    let compacted = false;

    userText = await this.expandFileReferences(userText);
    const contextFilesDump = await this.getFormattedContextPrompt();
    const fullUserContent = contextFilesDump 
      ? `${contextFilesDump}\nUser Prompt:\n${userText}`
      : userText;

    this.messages.push({ role: 'user', content: fullUserContent, images });

    const totalChars = this.messages.map(m => m.content.length).reduce((a, b) => a + b, 0);
    const estimatedTokens = Math.ceil(totalChars / 4);

    if (estimatedTokens > this.maxContextTokens) {
      await this.compactor.compact();
      compacted = true;
    }

    let loopCount = 0;
    const maxLoops = 25;
    let finalResponseText = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    try {
    while (loopCount < maxLoops) {
      if (signal?.aborted) throw new DOMException('Interrupted', 'AbortError');
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

      showToolActivity(this.terminalIo, 'Waiting for model…');

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
        this.messages.push({ role: 'assistant', content: result.text || '' });
        break;
      }

      this.messages.push({
        role: 'assistant',
        content: result.text || '',
        tool_calls: result.tool_calls
      });

      const toolCallsWithArgs = result.tool_calls.map(tc => {
        let args: any;
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
        return { tc, args };
      });

      const allReadOnly = toolCallsWithArgs.every(({ tc }) => {
        const coreTool = this.coreTools.get(tc.function.name);
        return coreTool?.annotations?.readOnlyHint === true;
      });

      if (allReadOnly && toolCallsWithArgs.length > 1) {
        const labels = toolCallsWithArgs.map(x => formatToolCall(x.tc.function.name, x.args)).join('  ·  ');
        showToolActivity(this.terminalIo, labels);
        const settled = await Promise.allSettled(
          toolCallsWithArgs.map(({ tc, args }) =>
            this.executeSingleTool(tc.id, tc.function.name, args)
          )
        );
        if (signal?.aborted) throw new DOMException('Interrupted', 'AbortError');
        for (let i = 0; i < toolCallsWithArgs.length; i++) {
          const { tc } = toolCallsWithArgs[i];
          const outcome = settled[i];
          const content = outcome.status === 'fulfilled'
            ? outcome.value
            : `Error: ${(outcome.reason as Error).message}`;
          this.messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content });
        }
      } else {
        for (const { tc, args } of toolCallsWithArgs) {
          showToolActivity(this.terminalIo, formatToolCall(tc.function.name, args));
          let content: string;
          try {
            content = await this.executeSingleTool(tc.id, tc.function.name, args);
          } catch (e) {
            content = `Error: ${(e as Error).message}`;
          }
          if (signal?.aborted) throw new DOMException('Interrupted', 'AbortError');
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

    this.heuristicAuditor.auditSessionEnd();

    if (this.sessionId) {
      await this.store.saveSession(this.sessionId, this.messages);
    }

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
    } finally {
      clearToolActivity(this.terminalIo);
    }
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
    return this.compactor.forceCompact(
      this.onCompactingStart,
      this.onCompactingEnd
    );
  }
}
