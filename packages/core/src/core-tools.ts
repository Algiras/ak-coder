import { FileSystem, TerminalIo, ProcessRunner, Logger, ToolAnnotations } from './ports';
import { ConfirmationPolicy } from './confirmation';
import { CommandSafetyGate } from './safety';
import { DiffEngine } from './diff';
import { AgentHooks } from './features/hooks/hooks';
import { VectorStore } from './features/history/vector-store';
import { WorkspaceIndexer } from './features/history/indexer';
import { z } from 'zod';

// ── Tool type definitions ─────────────────────────────────────────────────────

export interface CoreToolDefinition<TSchema extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string;
  description: string;
  schema: TSchema;
  outputSchema?: z.ZodTypeAny;
  annotations?: ToolAnnotations;
  handler: (args: z.infer<TSchema>) => Promise<string> | string;
}

// Minimal interface for a child agent spawned by delegate_task.
// Avoids a circular import back into agent.ts.
export interface ChildAgent {
  delegationDepth: number;
  agentsRules: string | null;
  addFileToContext(path: string): Promise<void>;
  startSession(id: string): Promise<void>;
  processMessage(text: string): Promise<{ text: string }>;
}

// ── Context interface ─────────────────────────────────────────────────────────
// All the mutable state and dependencies that tool handlers require.

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

  // Mutable counters / flags — exposed via callbacks so core-tools.ts never
  // reaches back into the agent's private fields directly.
  incrementConsecutiveReads(): number;  // returns new count
  resetConsecutiveReads(): void;
  markModified(): void;
  markTestsExecuted(): void;

  // Path utilities
  resolveWorkspacePath(path: string): string;

  // Sub-agent factory for delegate_task
  createChildAgent(sessionId: string): ChildAgent;
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerCoreTools(ctx: ToolContext): Map<string, CoreToolDefinition> {
  const tools = new Map<string, CoreToolDefinition>();

  // ── read_file ───────────────────────────────────────────────────────────────

  tools.set('read_file', {
    name: 'read_file',
    annotations: { title: 'Read File', readOnlyHint: true, idempotentHint: true },
    description: 'Read the contents of a file from the workspace. You must read a file before modifying it.',
    schema: z.object({
      path: z.string().describe('The relative path of the file to read')
    }),
    handler: async (args) => {
      const resolvedPath = ctx.resolveWorkspacePath(args.path);
      ctx.readFiles.add(resolvedPath);

      ctx.incrementConsecutiveReads();

      if (!(await ctx.fs.exists(resolvedPath))) {
        return `Error: File not found at path: ${args.path}`;
      }
      return ctx.fs.readFile(resolvedPath);
    }
  });

  // ── write_file ──────────────────────────────────────────────────────────────

  tools.set('write_file', {
    name: 'write_file',
    annotations: { title: 'Write File', destructiveHint: true },
    description: 'Write complete new content to a file. A unified diff will be shown and requires explicit user confirmation. You must read the file first in the current session before writing.',
    schema: z.object({
      path: z.string().describe('The relative path of the file to write'),
      content: z.string().describe('The complete new content to write')
    }),
    handler: async (args) => {
      const resolvedPath = ctx.resolveWorkspacePath(args.path);
      let { content } = args;
      ctx.resetConsecutiveReads();

      if (!ctx.readFiles.has(resolvedPath)) {
        throw new Error(`Write-Only-After-Read lock violated: You must call 'read_file' on "${args.path}" before you can write to it.`);
      }

      if (ctx.hooks.beforeWriteFile) {
        const hookResult = await ctx.hooks.beforeWriteFile({
          sessionId: ctx.getSessionId() || 'unknown',
          workspaceRoot: ctx.workspaceRoot,
          path: args.path,
          content
        });
        if (hookResult?.cancel) {
          throw new Error(`Write operation for file "${args.path}" was cancelled by hook.`);
        }
        if (hookResult?.content !== undefined) {
          content = hookResult.content;
        }
      }

      const oldContent = (await ctx.fs.exists(resolvedPath)) ? await ctx.fs.readFile(resolvedPath) : '';
      const diffs = DiffEngine.compare(oldContent, content);
      const coloredDiff = DiffEngine.renderColorDiff(diffs);

      const confirmResult = await ctx.confirmationPolicy.check(
        'write_file',
        { action: 'write_file', description: `Write changes to ${args.path}`, detail: coloredDiff, path: args.path },
        ctx.terminalIo
      );
      if (!confirmResult.approved) {
        throw new Error(`User rejected changes to "${args.path}".`);
      }

      let writeSuccess = true;
      try {
        await ctx.fs.writeFile(resolvedPath, content);
        ctx.markModified();
      } catch (e) {
        writeSuccess = false;
        throw e;
      } finally {
        if (ctx.hooks.afterWriteFile) {
          await ctx.hooks.afterWriteFile({
            sessionId: ctx.getSessionId() || 'unknown',
            workspaceRoot: ctx.workspaceRoot,
            path: args.path,
            content,
            success: writeSuccess
          });
        }
      }

      return `Successfully wrote content to ${args.path}`;
    }
  });

  // ── patch_file ──────────────────────────────────────────────────────────────

  tools.set('patch_file', {
    name: 'patch_file',
    annotations: { title: 'Patch File', destructiveHint: true },
    description: 'Apply search-and-replace patches to a file. Highly preferred over write_file for editing existing files.',
    schema: z.object({
      path: z.string().describe('The relative path of the file to edit'),
      patches: z.array(z.object({
        find: z.string().describe('The exact block of code to find (including whitespace and indentation)'),
        replace: z.string().describe('The block of code to replace the "find" block with')
      })).describe('List of search-and-replace patches to apply sequentially')
    }),
    handler: async (args) => {
      const resolvedPath = ctx.resolveWorkspacePath(args.path);
      ctx.resetConsecutiveReads();

      if (!ctx.readFiles.has(resolvedPath)) {
        throw new Error(`Write-Only-After-Read lock violated: You must call 'read_file' on "${args.path}" before you can patch it.`);
      }
      if (!(await ctx.fs.exists(resolvedPath))) {
        throw new Error(`File not found at path: ${args.path}`);
      }

      const oldContent = await ctx.fs.readFile(resolvedPath);
      let content = oldContent;

      for (let idx = 0; idx < args.patches.length; idx++) {
        const { find, replace } = args.patches[idx];
        const occurrences = content.split(find).length - 1;
        if (occurrences === 0) {
          throw new Error(`Patch failed at index ${idx}: The text to find was not found in the file.`);
        }
        if (occurrences > 1) {
          throw new Error(`Patch failed at index ${idx}: The text to find is not unique (found ${occurrences} times).`);
        }
        content = content.replace(find, replace);
      }

      if (ctx.hooks.beforeWriteFile) {
        const hookResult = await ctx.hooks.beforeWriteFile({
          sessionId: ctx.getSessionId() || 'unknown',
          workspaceRoot: ctx.workspaceRoot,
          path: args.path,
          content
        });
        if (hookResult?.cancel) {
          throw new Error(`Patch operation for file "${args.path}" was cancelled by hook.`);
        }
        if (hookResult?.content !== undefined) {
          content = hookResult.content;
        }
      }

      const diffs = DiffEngine.compare(oldContent, content);
      const coloredDiff = DiffEngine.renderColorDiff(diffs);

      const confirmResult = await ctx.confirmationPolicy.check(
        'patch_file',
        { action: 'patch_file', description: `Apply ${args.patches.length} patch(es) to ${args.path}`, detail: coloredDiff, path: args.path },
        ctx.terminalIo
      );
      if (!confirmResult.approved) {
        throw new Error(`User rejected changes to "${args.path}".`);
      }

      let writeSuccess = true;
      try {
        await ctx.fs.writeFile(resolvedPath, content);
        ctx.markModified();
      } catch (e) {
        writeSuccess = false;
        throw e;
      } finally {
        if (ctx.hooks.afterWriteFile) {
          await ctx.hooks.afterWriteFile({
            sessionId: ctx.getSessionId() || 'unknown',
            workspaceRoot: ctx.workspaceRoot,
            path: args.path,
            content,
            success: writeSuccess
          });
        }
      }

      return `Successfully applied ${args.patches.length} patches to ${args.path}`;
    }
  });

  // ── str_replace ─────────────────────────────────────────────────────────────

  tools.set('str_replace', {
    name: 'str_replace',
    annotations: { title: 'String Replace', destructiveHint: true },
    description: 'Replace an exact string in a file. Simpler than patch_file for targeted single-location edits. The file must have been read first.',
    schema: z.object({
      path: z.string().describe('Path to the file to edit'),
      old_string: z.string().describe('The exact string to find and replace (must be unique in the file)'),
      new_string: z.string().describe('The replacement string')
    }),
    handler: async (args) => {
      const resolvedPath = ctx.resolveWorkspacePath(args.path);
      if (!ctx.readFiles.has(resolvedPath)) {
        return `Error: You must read "${args.path}" with read_file before editing it.`;
      }
      const content = await ctx.fs.readFile(resolvedPath);
      const occurrences = content.split(args.old_string).length - 1;
      if (occurrences === 0) return `Error: old_string not found in ${args.path}`;
      if (occurrences > 1) {
        return `Error: old_string found ${occurrences} times in ${args.path} — provide more surrounding context to make it unique.`;
      }

      const updated = content.replace(args.old_string, args.new_string);
      const approval = await ctx.confirmationPolicy.check(
        'patch_file',
        {
          action: 'patch_file',
          description: `Edit ${args.path}`,
          detail: `- ${args.old_string.slice(0, 120)}\n+ ${args.new_string.slice(0, 120)}`,
          path: resolvedPath
        },
        ctx.terminalIo
      );
      if (!approval.approved) return `Edit to ${args.path} was rejected.`;

      if (ctx.hooks.beforeWriteFile) {
        const hookResult = await ctx.hooks.beforeWriteFile({ path: resolvedPath, content: updated, sessionId: ctx.getSessionId() || '' });
        if (hookResult?.cancel) return `Edit to ${args.path} cancelled by before-write hook.`;
      }
      await ctx.fs.writeFile(resolvedPath, updated);
      ctx.readFiles.add(resolvedPath);
      ctx.markModified();
      if (ctx.hooks.afterWriteFile) {
        await ctx.hooks.afterWriteFile({ path: resolvedPath, content: updated, sessionId: ctx.getSessionId() || '', success: true });
      }
      return `Edited ${args.path} successfully.`;
    }
  });

  // ── bash ────────────────────────────────────────────────────────────────────

  tools.set('bash', {
    name: 'bash',
    annotations: { title: 'Bash', destructiveHint: true, openWorldHint: true },
    description: 'Run a bash command. Read-only commands (ls, git status, cat, etc.) run automatically. Commands that mutate state require explicit user confirmation.',
    schema: z.object({
      command: z.string().describe('The shell command to run')
    }),
    handler: async (args) => {
      let { command } = args;
      ctx.resetConsecutiveReads();

      if (!ctx.processRunner) {
        throw new Error('ProcessRunner is not registered in the agent context');
      }

      if (ctx.hooks.beforeExecuteCommand) {
        const hookResult = await ctx.hooks.beforeExecuteCommand({
          sessionId: ctx.getSessionId() || 'unknown',
          workspaceRoot: ctx.workspaceRoot,
          command
        });
        if (hookResult?.cancel) {
          throw new Error(`Command execution was cancelled by hook: "${command}"`);
        }
        if (hookResult?.command !== undefined) {
          command = hookResult.command;
        }
      }

      const confirmResult = await ctx.confirmationPolicy.check(
        'bash',
        { action: 'bash', description: 'Run bash command', detail: command, command },
        ctx.terminalIo,
        ctx.safetyGate
      );
      if (!confirmResult.approved) {
        throw new Error(`User rejected command execution: "${command}"`);
      }
      if (confirmResult.edited) {
        command = confirmResult.edited;
      }
      if (confirmResult.applyToAll && confirmResult.approved) {
        await ctx.safetyGate.authorizePattern(command);
      }

      let runResult: any;
      try {
        runResult = await ctx.processRunner.run(command, { cwd: ctx.workspaceRoot });
      } catch (e) {
        if (ctx.hooks.afterExecuteCommand) {
          await ctx.hooks.afterExecuteCommand({
            sessionId: ctx.getSessionId() || 'unknown',
            workspaceRoot: ctx.workspaceRoot,
            command,
            code: null,
            stdout: '',
            stderr: (e as Error).message
          });
        }
        throw e;
      }

      if (ctx.hooks.afterExecuteCommand) {
        await ctx.hooks.afterExecuteCommand({
          sessionId: ctx.getSessionId() || 'unknown',
          workspaceRoot: ctx.workspaceRoot,
          command,
          code: runResult.code,
          stdout: runResult.stdout,
          stderr: runResult.stderr
        });
      }

      if (command.toLowerCase().includes('test')) {
        ctx.markTestsExecuted();
      }

      return `Exit Code: ${runResult.code}\nStdout:\n${runResult.stdout}\nStderr:\n${runResult.stderr}`;
    }
  });

  // ── list_directory ──────────────────────────────────────────────────────────

  tools.set('list_directory', {
    name: 'list_directory',
    annotations: { title: 'List Directory', readOnlyHint: true, idempotentHint: true },
    description: 'List the contents of a directory in the workspace.',
    schema: z.object({
      path: z.string().describe('The path of the directory to list')
    }),
    handler: async (args) => {
      const resolvedPath = ctx.resolveWorkspacePath(args.path || '.');
      ctx.incrementConsecutiveReads();

      if (!(await ctx.fs.exists(resolvedPath))) {
        return `Error: Directory not found: ${args.path}`;
      }
      const files = await ctx.fs.listFiles(resolvedPath);
      return files.join('\n');
    }
  });

  // ── grep_search ─────────────────────────────────────────────────────────────

  tools.set('grep_search', {
    name: 'grep_search',
    annotations: { title: 'Grep Search', readOnlyHint: true, idempotentHint: true },
    description: 'Search for text matches within workspace files.',
    schema: z.object({
      pattern: z.string().describe('The text pattern or regex to search for'),
      path: z.string().describe('The directory path to search')
    }),
    handler: async (args) => {
      const searchPath = args.path || '.';
      const resolvedPath = ctx.resolveWorkspacePath(searchPath);
      ctx.incrementConsecutiveReads();

      if (!(await ctx.fs.exists(resolvedPath))) {
        return `Error: Path not found: ${searchPath}`;
      }

      // Use ripgrep via ProcessRunner when available
      if (ctx.processRunner) {
        try {
          const result = await ctx.processRunner.run(
            `rg -n --no-heading -i -e ${JSON.stringify(args.pattern)} ${JSON.stringify(resolvedPath)}`,
            { cwd: ctx.workspaceRoot }
          );
          const output = result.stdout.trim();
          if (!output) return `No matches found for pattern: ${args.pattern}`;
          return result.stdout.trim().split('\n').slice(0, 100).join('\n');
        } catch {
          // rg not installed — fall through to in-process scan
        }
      }

      // In-process fallback (used in tests with MockFileSystem)
      const files = await ctx.fs.listFiles(resolvedPath);
      const matches: string[] = [];
      const regex = new RegExp(args.pattern, 'i');
      for (const file of files) {
        try {
          if (file.includes('node_modules') || file.includes('.git')) continue;
          const content = await ctx.fs.readFile(file);
          content.split('\n').forEach((line, idx) => {
            if (regex.test(line)) matches.push(`${file}:${idx + 1}: ${line.trim()}`);
          });
        } catch {
          // ignore unreadable files
        }
      }
      if (matches.length === 0) return `No matches found for pattern: ${args.pattern}`;
      return matches.slice(0, 100).join('\n');
    }
  });

  // ── glob ────────────────────────────────────────────────────────────────────

  tools.set('glob', {
    name: 'glob',
    annotations: { title: 'Glob', readOnlyHint: true, idempotentHint: true },
    description: 'Find files matching a glob pattern within the workspace (e.g. "**/*.ts", "src/**/*.test.ts").',
    schema: z.object({
      pattern: z.string().describe('Glob pattern, e.g. "**/*.ts" or "src/**/*.test.ts"'),
      path: z.string().optional().describe('Root directory to search (default: workspace root)')
    }),
    handler: async (args) => {
      ctx.incrementConsecutiveReads();
      const root = args.path && args.path !== '.'
        ? ctx.resolveWorkspacePath(args.path)
        : ctx.workspaceRoot;

      if (ctx.processRunner) {
        try {
          const result = await ctx.processRunner.run(
            `rg --files -g ${JSON.stringify(args.pattern)} ${JSON.stringify(root)}`,
            { cwd: ctx.workspaceRoot }
          );
          const lines = result.stdout.trim().split('\n').filter(Boolean);
          if (lines.length === 0) return `No files found matching: ${args.pattern}`;
          return lines.slice(0, 200).join('\n');
        } catch {
          // fall through to in-process scan
        }
      }

      // In-process fallback: convert glob to regex
      const allFiles = await ctx.fs.listFiles(root);
      const parts = args.pattern.split('**');
      const regexStr = parts
        .map(p => p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
        .join('.*');
      const regex = new RegExp(`(^|/)${regexStr}$`);
      const matched = allFiles.filter(f => regex.test(f));
      if (matched.length === 0) return `No files found matching: ${args.pattern}`;
      return matched.slice(0, 200).join('\n');
    }
  });

  // ── index_workspace ─────────────────────────────────────────────────────────

  tools.set('index_workspace', {
    name: 'index_workspace',
    description: 'Index the workspace files for semantic search. Call this once before using semantic_search. Respects .gitignore patterns.',
    schema: z.object({
      extensions: z.array(z.string()).optional().describe('File extensions to include (e.g. [".ts", ".md"]). Defaults to common code/text extensions.')
    }),
    handler: async (args) => {
      const opts = args.extensions ? { extensions: args.extensions } : {};
      const indexer = new WorkspaceIndexer(ctx.vectorStore, opts);
      ctx.setIndexer(indexer);
      await indexer.indexWorkspace(ctx.fs, ctx.workspaceRoot);
      const fileCount = ctx.vectorStore.indexedFiles().length;
      const chunkCount = ctx.vectorStore.size();
      return `Indexed ${fileCount} files into ${chunkCount} chunks. Semantic search is now ready.`;
    }
  });

  // ── semantic_search ─────────────────────────────────────────────────────────

  tools.set('semantic_search', {
    name: 'semantic_search',
    annotations: { title: 'Semantic Search', readOnlyHint: true, idempotentHint: true },
    description: 'Search the indexed workspace for files or code chunks semantically relevant to a query. Call index_workspace first.',
    schema: z.object({
      query: z.string().describe('Natural language query, e.g. "where do we handle JSON-RPC messages"'),
      topK: z.number().optional().describe('Maximum number of results to return (default 5)'),
      minScore: z.number().optional().describe('Minimum cosine similarity threshold 0–1 (default 0.1)')
    }),
    handler: async (args) => {
      if (ctx.vectorStore.size() === 0) {
        return 'The workspace index is empty. Please run the index_workspace tool first.';
      }
      const queryVec = ctx.getIndexer().embedQuery(args.query);
      const results = ctx.vectorStore.search(queryVec, args.topK ?? 5, args.minScore ?? 0.1);
      if (results.length === 0) {
        return `No results found for query: "${args.query}" (try lowering minScore or re-indexing).`;
      }
      return results
        .map((r, i) =>
          `[${i + 1}] ${r.filePath} (lines ${r.startLine + 1}–${r.endLine + 1}) | score: ${r.score.toFixed(4)}\n${r.text.slice(0, 300)}${r.text.length > 300 ? '…' : ''}`
        )
        .join('\n\n---\n\n');
    }
  });

  // ── web_fetch ───────────────────────────────────────────────────────────────

  tools.set('web_fetch', {
    name: 'web_fetch',
    annotations: { title: 'Web Fetch', readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    description: 'Fetch the text content of a URL. Returns the page body (HTML stripped to text). Use for reading documentation, READMEs, npm package pages, GitHub issues, etc.',
    schema: z.object({
      url: z.string().describe('The URL to fetch'),
      maxLength: z.number().optional().describe('Maximum characters to return (default 8000)')
    }),
    handler: async (args) => {
      try {
        const response = await fetch(args.url, {
          headers: { 'User-Agent': 'ak-coder/0.1.0' },
          signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) {
          return `HTTP ${response.status} ${response.statusText} for ${args.url}`;
        }
        const contentType = response.headers.get('content-type') || '';
        let text = await response.text();
        if (contentType.includes('text/html')) {
          text = text
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        }
        const max = args.maxLength ?? 8000;
        return text.length > max ? text.slice(0, max) + `\n\n[truncated — ${text.length} total chars]` : text;
      } catch (e) {
        return `Error fetching ${args.url}: ${(e as Error).message}`;
      }
    }
  });

  // ── delegate_task ───────────────────────────────────────────────────────────

  tools.set('delegate_task', {
    name: 'delegate_task',
    annotations: { title: 'Delegate Task', openWorldHint: true },
    description: "Deploy a specialized sub-agent to execute a sub-task. Returns the sub-agent's findings.",
    schema: z.object({
      role: z.string().describe('The specialized role of the sub-agent (e.g. "Security Auditor", "Test Runner")'),
      taskPrompt: z.string().describe('The detailed instructions and objective of the task for the sub-agent'),
      filesToInclude: z.array(z.string()).optional().describe("Relative paths of files to load in the sub-agent's context")
    }),
    handler: async (args) => {
      const { role, taskPrompt, filesToInclude } = args;
      const maxDepth = 3;
      if (ctx.delegationDepth >= maxDepth) {
        throw new Error(`Sub-agent delegation depth limit of ${maxDepth} exceeded. Spawning rejected.`);
      }

      const subSessionId = `${ctx.getSessionId() || 'sub'}-depth-${ctx.delegationDepth + 1}-${Date.now()}`;
      const child = ctx.createChildAgent(subSessionId);
      child.agentsRules = `You are a specialized sub-agent with the role: "${role}".\nYour parent task instruction is:\n${taskPrompt}\n\nProvide a direct and detailed technical summary of your findings or implementation when you are done.`;

      if (filesToInclude) {
        for (const file of filesToInclude) {
          try {
            await child.addFileToContext(ctx.resolveWorkspacePath(file));
          } catch (e) {
            ctx.logger.warn(`Failed to add file to child context: ${file}`, e);
          }
        }
      }

      await child.startSession(subSessionId);

      if (ctx.terminalIo) {
        ctx.terminalIo.write(`\n\x1b[35m[Spawning Sub-Agent: "${role}" at depth ${ctx.delegationDepth + 1}...]\x1b[0m\n`);
      }

      const response = await child.processMessage(`Begin task: "${taskPrompt}"`);

      if (ctx.terminalIo) {
        ctx.terminalIo.write(`\n\x1b[35m[Sub-Agent "${role}" finished execution]\x1b[0m\n`);
      }

      return `[Sub-Agent "${role}" finished execution]\nSummary of Findings:\n${response.text}`;
    }
  });

  return tools;
}
