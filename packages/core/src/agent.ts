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
import { IgnoreMatcher } from './ignore';
import { McpClient } from './mcp';
import { CommandSafetyGate } from './safety';
import { DiffEngine } from './diff';
import { AgentHooks } from './hooks';
import { z } from 'zod';

export interface CoreToolDefinition<TSchema extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string;
  description: string;
  schema: TSchema;
  handler: (args: z.infer<TSchema>) => Promise<string> | string;
}

function zodToJsonSchema(schema: z.ZodTypeAny): any {
  const description = schema.description;

  if (schema instanceof z.ZodObject) {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    const shape = schema.shape;
    for (const [key, propSchema] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(propSchema as z.ZodTypeAny);
      if (!(propSchema instanceof z.ZodOptional) && !(propSchema instanceof z.ZodNullable)) {
        required.push(key);
      }
    }
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {})
    };
  }

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    const unwrappedSchema = zodToJsonSchema(schema.unwrap());
    if (description && !unwrappedSchema.description) {
      unwrappedSchema.description = description;
    }
    return unwrappedSchema;
  }

  let typeStr = 'string';

  if (schema instanceof z.ZodString) {
    typeStr = 'string';
  } else if (schema instanceof z.ZodNumber) {
    typeStr = 'number';
  } else if (schema instanceof z.ZodBoolean) {
    typeStr = 'boolean';
  } else if (schema instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: schema.options,
      ...(description ? { description } : {})
    };
  } else if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodToJsonSchema(schema.element),
      ...(description ? { description } : {})
    };
  }

  return {
    type: typeStr,
    ...(description ? { description } : {})
  };
}

export class AgentCore {
  private messages: ChatMessage[] = [];
  private activeFiles = new Set<string>();
  private summary: string | null = null;
  private sessionId: string | null = null;
  private maxContextTokens = 16000;
  public agentsRules: string | null = null;
  private loadedSkills: { name: string; description: string; content: string }[] = [];
  private costInput = 5.0;
  private costOutput = 15.0;

  // Session-level tool execution state
  private readFiles = new Set<string>();
  private mcpClients = new Map<string, McpClient>();
  private safetyGate: CommandSafetyGate;
  private hooks: AgentHooks = {};
  public delegationDepth = 0;

  // Heuristics session states
  private consecutiveReadsCount = 0;
  private hasModifiedFiles = false;
  private hasExecutedTests = false;

  private coreTools = new Map<string, CoreToolDefinition>();

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
    this.registerCoreTools();
  }

  private registerCoreTools() {
    this.coreTools.set('read_file', {
      name: 'read_file',
      description: 'Read the contents of a file from the workspace. You must read a file before modifying it.',
      schema: z.object({
        path: z.string().describe('The relative path of the file to read')
      }),
      handler: async (args) => {
        const filePath = args.path;
        const resolvedPath = this.resolveWorkspacePath(filePath);
        
        this.readFiles.add(resolvedPath);
        
        this.consecutiveReadsCount++;
        if (this.consecutiveReadsCount > 5) {
          const warnMsg = `\x1b[33m[Heuristic Alert: Agent has read ${this.consecutiveReadsCount} files consecutively without taking modifying actions.]\x1b[0m\n`;
          if (this.terminalIo) {
            this.terminalIo.write(warnMsg);
          }
        }

        const exists = await this.fs.exists(resolvedPath);
        if (!exists) {
          return `Error: File not found at path: ${filePath}`;
        }
        const content = await this.fs.readFile(resolvedPath);
        return content;
      }
    });

    this.coreTools.set('write_file', {
      name: 'write_file',
      description: 'Write complete new content to a file. A unified diff will be shown and requires explicit user confirmation. You must read the file first in the current session before writing.',
      schema: z.object({
        path: z.string().describe('The relative path of the file to write'),
        content: z.string().describe('The complete new content to write')
      }),
      handler: async (args) => {
        const filePath = args.path;
        let content = args.content;
        const resolvedPath = this.resolveWorkspacePath(filePath);

        this.consecutiveReadsCount = 0;

        // Write-Only-After-Read Lock check
        if (!this.readFiles.has(resolvedPath)) {
          throw new Error(`Write-Only-After-Read lock violated: You must call 'read_file' on "${filePath}" before you can write to it.`);
        }

        if (this.hooks.beforeWriteFile) {
          const hookResult = await this.hooks.beforeWriteFile({
            sessionId: this.sessionId || 'unknown',
            workspaceRoot: this.workspaceRoot,
            path: filePath,
            content
          });
          if (hookResult?.cancel) {
            throw new Error(`Write operation for file "${filePath}" was cancelled by hook.`);
          }
          if (hookResult?.content !== undefined) {
            content = hookResult.content;
          }
        }

        let oldContent = '';
        if (await this.fs.exists(resolvedPath)) {
          oldContent = await this.fs.readFile(resolvedPath);
        }

        const diffs = DiffEngine.compare(oldContent, content);
        const coloredDiff = DiffEngine.renderColorDiff(diffs);

        if (this.terminalIo) {
          this.terminalIo.write(`\n\x1b[36mProposed changes for ${filePath}:\x1b[0m\n`);
          this.terminalIo.write(coloredDiff);
          
          const confirm = await this.terminalIo.askConfirm(`Approve writing changes to ${filePath}?`, false);
          if (!confirm) {
            throw new Error(`User rejected changes to "${filePath}".`);
          }
        }

        let writeSuccess = true;
        try {
          await this.fs.writeFile(resolvedPath, content);
          this.hasModifiedFiles = true;
        } catch (e) {
          writeSuccess = false;
          throw e;
        } finally {
          if (this.hooks.afterWriteFile) {
            await this.hooks.afterWriteFile({
              sessionId: this.sessionId || 'unknown',
              workspaceRoot: this.workspaceRoot,
              path: filePath,
              content,
              success: writeSuccess
            });
          }
        }

        return `Successfully wrote content to ${filePath}`;
      }
    });

    this.coreTools.set('patch_file', {
      name: 'patch_file',
      description: 'Apply search-and-replace patches to a file. Highly preferred over write_file for editing existing files.',
      schema: z.object({
        path: z.string().describe('The relative path of the file to edit'),
        patches: z.array(z.object({
          find: z.string().describe('The exact block of code to find (including whitespace and indentation)'),
          replace: z.string().describe('The block of code to replace the "find" block with')
        })).describe('List of search-and-replace patches to apply sequentially')
      }),
      handler: async (args) => {
        const filePath = args.path;
        const patches = args.patches;
        const resolvedPath = this.resolveWorkspacePath(filePath);

        this.consecutiveReadsCount = 0;

        // Write-Only-After-Read Lock check
        if (!this.readFiles.has(resolvedPath)) {
          throw new Error(`Write-Only-After-Read lock violated: You must call 'read_file' on "${filePath}" before you can patch it.`);
        }

        const exists = await this.fs.exists(resolvedPath);
        if (!exists) {
          throw new Error(`File not found at path: ${filePath}`);
        }

        let oldContent = await this.fs.readFile(resolvedPath);
        let content = oldContent;

        // Apply search-and-replace patches
        for (let idx = 0; idx < patches.length; idx++) {
          const patch = patches[idx];
          const { find, replace } = patch;

          // Count occurrences
          const occurrences = content.split(find).length - 1;
          if (occurrences === 0) {
            throw new Error(`Patch failed at index ${idx}: The text to find was not found in the file.`);
          }
          if (occurrences > 1) {
            throw new Error(`Patch failed at index ${idx}: The text to find is not unique (found ${occurrences} times).`);
          }

          // Apply replacement
          content = content.replace(find, replace);
        }

        if (this.hooks.beforeWriteFile) {
          const hookResult = await this.hooks.beforeWriteFile({
            sessionId: this.sessionId || 'unknown',
            workspaceRoot: this.workspaceRoot,
            path: filePath,
            content
          });
          if (hookResult?.cancel) {
            throw new Error(`Patch operation for file "${filePath}" was cancelled by hook.`);
          }
          if (hookResult?.content !== undefined) {
            content = hookResult.content;
          }
        }

        const diffs = DiffEngine.compare(oldContent, content);
        const coloredDiff = DiffEngine.renderColorDiff(diffs);

        if (this.terminalIo) {
          this.terminalIo.write(`\n\x1b[36mProposed changes for ${filePath} via patching:\x1b[0m\n`);
          this.terminalIo.write(coloredDiff);
          
          const confirm = await this.terminalIo.askConfirm(`Approve writing changes to ${filePath}?`, false);
          if (!confirm) {
            throw new Error(`User rejected changes to "${filePath}".`);
          }
        }

        let writeSuccess = true;
        try {
          await this.fs.writeFile(resolvedPath, content);
          this.hasModifiedFiles = true;
        } catch (e) {
          writeSuccess = false;
          throw e;
        } finally {
          if (this.hooks.afterWriteFile) {
            await this.hooks.afterWriteFile({
              sessionId: this.sessionId || 'unknown',
              workspaceRoot: this.workspaceRoot,
              path: filePath,
              content,
              success: writeSuccess
            });
          }
        }

        return `Successfully applied ${patches.length} patches to ${filePath}`;
      }
    });

    this.coreTools.set('execute_command', {
      name: 'execute_command',
      description: 'Execute a terminal shell command. Safe commands (ls, git status, git diff) run automatically. Mutating/unsafe commands require explicit user confirmation.',
      schema: z.object({
        command: z.string().describe('The shell command to run')
      }),
      handler: async (args) => {
        let command = args.command;
        this.consecutiveReadsCount = 0;

        if (!this.processRunner) {
          throw new Error('ProcessRunner is not registered in the agent context');
        }

        if (this.hooks.beforeExecuteCommand) {
          const hookResult = await this.hooks.beforeExecuteCommand({
            sessionId: this.sessionId || 'unknown',
            workspaceRoot: this.workspaceRoot,
            command
          });
          if (hookResult?.cancel) {
            throw new Error(`Command execution was cancelled by hook: "${command}"`);
          }
          if (hookResult?.command !== undefined) {
            command = hookResult.command;
          }
        }

        const safety = this.safetyGate.classifyCommand(command);
        if (safety === 'unsafe') {
          const isAuthed = this.safetyGate.isAuthorized(command);
          if (!isAuthed) {
            if (this.terminalIo) {
              this.terminalIo.write(`\n\x1b[33mWarning: Unsafe command detected: "${command}"\x1b[0m\n`);
              const confirm = await this.terminalIo.askConfirm(`Approve running this unsafe command?`, false);
              if (!confirm) {
                throw new Error(`User rejected command execution: "${command}"`);
              }
              const savePattern = await this.terminalIo.askConfirm(`Remember this permission for future calls?`, false);
              if (savePattern) {
                await this.safetyGate.authorizePattern(command);
              }
            } else {
              throw new Error(`Command safety check failed (non-interactive mode): "${command}"`);
            }
          }
        }

        let runResult: any;
        try {
          runResult = await this.processRunner.run(command, { cwd: this.workspaceRoot });
        } catch (e) {
          if (this.hooks.afterExecuteCommand) {
            await this.hooks.afterExecuteCommand({
              sessionId: this.sessionId || 'unknown',
              workspaceRoot: this.workspaceRoot,
              command,
              code: null,
              stdout: '',
              stderr: (e as Error).message
            });
          }
          throw e;
        }

        if (this.hooks.afterExecuteCommand) {
          await this.hooks.afterExecuteCommand({
            sessionId: this.sessionId || 'unknown',
            workspaceRoot: this.workspaceRoot,
            command,
            code: runResult.code,
            stdout: runResult.stdout,
            stderr: runResult.stderr
          });
        }

        if (command.toLowerCase().includes('test')) {
          this.hasExecutedTests = true;
        }

        return `Exit Code: ${runResult.code}\nStdout:\n${runResult.stdout}\nStderr:\n${runResult.stderr}`;
      }
    });

    this.coreTools.set('list_directory', {
      name: 'list_directory',
      description: 'List the contents of a directory in the workspace.',
      schema: z.object({
        path: z.string().describe('The path of the directory to list')
      }),
      handler: async (args) => {
        const dirPath = args.path || '.';
        const resolvedPath = this.resolveWorkspacePath(dirPath);

        this.consecutiveReadsCount++;
        if (this.consecutiveReadsCount > 5) {
          const warnMsg = `\x1b[33m[Heuristic Alert: Agent has read ${this.consecutiveReadsCount} files/directories consecutively without taking modifying actions.]\x1b[0m\n`;
          if (this.terminalIo) {
            this.terminalIo.write(warnMsg);
          }
        }

        const exists = await this.fs.exists(resolvedPath);
        if (!exists) {
          return `Error: Directory not found: ${dirPath}`;
        }
        const files = await this.fs.listFiles(resolvedPath);
        return files.join('\n');
      }
    });

    this.coreTools.set('grep_search', {
      name: 'grep_search',
      description: 'Search for text matches within workspace files.',
      schema: z.object({
        pattern: z.string().describe('The text pattern or regex to search for'),
        path: z.string().describe('The directory path to search')
      }),
      handler: async (args) => {
        const pattern = args.pattern;
        const searchPath = args.path || '.';

        this.consecutiveReadsCount++;
        if (this.consecutiveReadsCount > 5) {
          const warnMsg = `\x1b[33m[Heuristic Alert: Agent has read ${this.consecutiveReadsCount} files/directories consecutively without taking modifying actions.]\x1b[0m\n`;
          if (this.terminalIo) {
            this.terminalIo.write(warnMsg);
          }
        }

        const resolvedPath = this.resolveWorkspacePath(searchPath);
        const exists = await this.fs.exists(resolvedPath);
        if (!exists) {
          return `Error: Path not found: ${searchPath}`;
        }

        const files = await this.fs.listFiles(resolvedPath);
        const matches: string[] = [];
        const regex = new RegExp(pattern, 'i');

        for (const file of files) {
          try {
            if (file.includes('node_modules') || file.includes('.git')) continue;
            const content = await this.fs.readFile(file);
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
              if (regex.test(line)) {
                matches.push(`${file}:${idx + 1}: ${line.trim()}`);
              }
            });
          } catch {
            // Ignore failures
          }
        }

        if (matches.length === 0) {
          return `No matches found for pattern: ${pattern}`;
        }
        return matches.slice(0, 100).join('\n');
      }
    });

    this.coreTools.set('delegate_task', {
      name: 'delegate_task',
      description: 'Deploy a specialized sub-agent to execute a sub-task. Returns the sub-agent\'s findings.',
      schema: z.object({
        role: z.string().describe('The specialized role of the sub-agent (e.g. "Security Auditor", "Test Runner", "Parser Optimizer")'),
        taskPrompt: z.string().describe('The detailed instructions and objective of the task for the sub-agent'),
        filesToInclude: z.array(z.string()).optional().describe('Relative paths of files to load in the sub-agent\'s context')
      }),
      handler: async (args) => {
        const { role, taskPrompt, filesToInclude } = args;

        const maxDepth = 3;
        if (this.delegationDepth >= maxDepth) {
          throw new Error(`Sub-agent delegation depth limit of ${maxDepth} exceeded. Spawning rejected.`);
        }

        const subSessionId = `${this.sessionId || 'sub'}-depth-${this.delegationDepth + 1}-${Date.now()}`;
        const childAgent = new AgentCore(
          this.fs,
          this.llm,
          this.store,
          this.logger,
          this.processRunner,
          this.terminalIo,
          this.workspaceRoot
        );
        childAgent.delegationDepth = this.delegationDepth + 1;
        childAgent.setPricing(this.costInput, this.costOutput);

        childAgent.agentsRules = `You are a specialized sub-agent with the role: "${role}".
Your parent task instruction is:
${taskPrompt}

Provide a direct and detailed technical summary of your findings or implementation when you are done.`;

        if (filesToInclude && Array.isArray(filesToInclude)) {
          for (const file of filesToInclude) {
            try {
              const resolved = this.resolveWorkspacePath(file);
              await childAgent.addFileToContext(resolved);
            } catch (e) {
              this.logger.warn(`Failed to add file to child context: ${file}`, e);
            }
          }
        }

        await childAgent.startSession(subSessionId);

        if (this.terminalIo) {
          this.terminalIo.write(`\n\x1b[35m[Spawning Sub-Agent: "${role}" at depth ${childAgent.delegationDepth}...]\x1b[0m\n`);
        }

        const response = await childAgent.processMessage(
          `Begin task: "${taskPrompt}"`
        );

        if (this.terminalIo) {
          this.terminalIo.write(`\n\x1b[35m[Sub-Agent "${role}" finished execution]\x1b[0m\n`);
        }

        return `[Sub-Agent "${role}" finished execution]
Summary of Findings:
${response.text}`;
      }
    });
  }

  setPricing(costInput: number, costOutput: number): void {
    this.costInput = costInput;
    this.costOutput = costOutput;
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
  }

  async loadAgentsRules(workspaceRoot: string): Promise<void> {
    const agentsPath = `${workspaceRoot.replace(/\/$/, '')}/AGENTS.md`;
    const claudePath = `${workspaceRoot.replace(/\/$/, '')}/CLAUDE.md`;
    if (await this.fs.exists(agentsPath)) {
      this.agentsRules = await this.fs.readFile(agentsPath);
      this.logger.info('Loaded instructions from AGENTS.md');
    } else if (await this.fs.exists(claudePath)) {
      this.agentsRules = await this.fs.readFile(claudePath);
      this.logger.info('Loaded instructions from CLAUDE.md');
    }
  }

  async loadSkills(workspaceRoot: string): Promise<void> {
    this.loadedSkills = [];
    try {
      const allFiles = await this.fs.listFiles(workspaceRoot);
      const skillFiles = allFiles.filter(f => f.endsWith('SKILL.md'));

      for (const file of skillFiles) {
        try {
          const rawContent = await this.fs.readFile(file);
          const parsed = this.parseSkillMarkdown(rawContent);
          
          const parts = file.split('/');
          parts.pop(); // Remove SKILL.md
          const parentFolder = parts.pop() || '';

          this.loadedSkills.push({
            name: parsed.name || parentFolder || 'unknown-skill',
            description: parsed.description || '',
            content: rawContent
          });
          this.logger.info(`Loaded skill: ${parsed.name || parentFolder || file}`);
        } catch (e) {
          this.logger.warn(`Failed to parse skill file ${file}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to list skill files: ${(e as Error).message}`);
    }
  }

  private parseSkillMarkdown(content: string): { name?: string; description?: string } {
    const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
    if (!match) return {};
    
    const yamlStr = match[1];
    const lines = yamlStr.split('\n');
    const result: Record<string, string> = {};
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx !== -1) {
        const key = line.substring(0, idx).trim().toLowerCase();
        const val = line.substring(idx + 1).replace(/^['"]|['"]$/g, '').trim();
        result[key] = val;
      }
    }
    return result;
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
      combined.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: zodToJsonSchema(tool.schema)
        }
      });
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
              parameters: tool.inputSchema as any
            }
          });
        }
      } catch (e) {
        this.logger.warn(`Failed to retrieve tools from MCP server "${serverName}": ${(e as Error).message}`);
      }
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
    return this.loadedSkills;
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  getContextSummary(): string | null {
    return this.summary;
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

  async processMessage(
    userText: string,
    images: string[] = [],
    streamCallback?: (chunk: string) => void
  ): Promise<{ text: string; inputTokens: number; outputTokens: number; cost: number; compacted: boolean }> {
    const spanId = this.logger.startSpan('processMessage');
    let compacted = false;

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
      await this.compact();
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

      if (this.loadedSkills.length > 0) {
        systemPromptContent += '\n\nAvailable Skills:';
        for (const skill of this.loadedSkills) {
          systemPromptContent += `\n- Skill Name: ${skill.name}\n  Description: ${skill.description}\n  Instructions:\n${skill.content}\n`;
        }
      }

      if (this.summary) {
        systemPromptContent += `\n[Summary of previous conversation: ${this.summary}]\n`;
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

      const result = await this.llm.chat(payload, {
        stream: streamCallback,
        tools: combinedTools
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

      for (const toolCall of result.tool_calls) {
        const toolName = toolCall.function.name;
        let args: any;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = {};
        }

        const loaderMsg = `\x1b[36m⠋ Running tool ${toolName}...\x1b[0m`;
        if (this.terminalIo) {
          this.terminalIo.write(`${loaderMsg}\n`);
        }

        let toolOutputText = '';
        try {
          toolOutputText = await this.executeSingleTool(toolCall.id, toolName, args);
        } catch (e) {
          toolOutputText = `Error: ${(e as Error).message}`;
        }

        this.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: toolOutputText
        });
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

    return await coreTool.handler(parsed.data);
  }

  private resolveWorkspacePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
      return normalized;
    }
    return `${this.workspaceRoot.replace(/\/$/, '')}/${normalized}`;
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

    this.logger.info('Compaction complete', { summaryLength: this.summary.length });
  }
}
