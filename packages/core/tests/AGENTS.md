# packages/core/tests — Test conventions

## Test Files

| File | Covers |
|------|--------|
| `agent_ignore.test.ts` | File context management and ignore patterns |
| `confirmation.test.ts` | `ConfirmationPolicy` presets, gate logic, write/command prompting |
| `core_logic.test.ts` | Agent message processing logic |
| `diff_rules.test.ts` | Myers-diff engine and AGENTS.md/SKILL.md prompt rules injection |
| `evals.test.ts` | Automated agent flow evaluations (dialogue, safety, compaction, planning) |
| `file_refs.test.ts` | `@file` reference expansion in `processMessage` |
| `hooks.test.ts` | Hook registration and intercept events (write, command execution, chat) |
| `llm.test.ts` | OpenAI compatible LLM service mock and fetch adapter |
| `mcp.test.ts` | `McpClient` tool discovery and execution |
| `ollama_evals.test.ts` | Ollama-backed integration evals (skipped unless `RUN_OLLAMA_EVALS=1`) |
| `patch.test.ts` | Unified diff patching tool validation |
| `registry.test.ts` | `DependencyRegistry` service locator |
| `rewind.test.ts` | User turns fetching, history truncation, and branching |
| `safety.test.ts` | Command safety classification and safety gate |
| `sandbox.test.ts` | Docker-based sandboxed process runner options and translation |
| `semantic.test.ts` | TF-IDF Vector store, workspace indexer, and semantic search tool |
| `subagent.test.ts` | Sub-agent spawning, task delegation, and delegation depth limits |
| `tool_loop.test.ts` | ReAct tool loop and parallel tool executions |
| `winston_logger.test.ts` | Structured logging and log rotating compatibility |

## Mock Usage

All tests that exercise `AgentCore` use the mocks from `../src/mocks/`:

```ts
import { MockFileSystem, MockSessionStore, MockLogger, MockTerminalIo } from '../src/mocks';

const mockFs = new MockFileSystem();
mockFs.files.set('/ws/src/app.ts', 'export const x = 1;');

const agent = new AgentCore(mockFs, mockLlm, new MockSessionStore(), new MockLogger(), undefined, new MockTerminalIo(), '/ws');
```

## LLM Mocking

Implement `LLMService` inline for unit tests — no external dependencies:

```ts
class MockLlm implements LLMService {
  responses: Array<{ text?: string; tool_calls?: ToolCall[] }> = [];
  async chat(messages, opts) {
    return { ...this.responses.shift()!, inputTokens: 5, outputTokens: 5 };
  }
}
```

## Ollama Evals

Tests in `ollama_evals.test.ts` are guarded by:

```ts
const runOllamaEvals = process.env.RUN_OLLAMA_EVALS === '1';
it.skipIf(!runOllamaEvals)('Eval: ...', async () => { ... });
```

Run with: `RUN_OLLAMA_EVALS=1 bun test packages/core/tests/ollama_evals.test.ts`
