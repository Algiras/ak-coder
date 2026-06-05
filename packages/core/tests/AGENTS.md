# packages/core/tests — Test conventions

## Test Files

| File | Covers |
|------|--------|
| `agent.test.ts` | `AgentCore` — session lifecycle, tool execution loop, compaction |
| `file_refs.test.ts` | `@file` reference expansion in `processMessage` |
| `confirmation.test.ts` | `ConfirmationPolicy` presets and gate logic |
| `diff.test.ts` | Myers-diff engine correctness |
| `ignore.test.ts` | `.akcoderignore` pattern matching |
| `mcp.test.ts` | `McpClient` tool listing and calling |
| `ollama_evals.test.ts` | Ollama-backed integration evals (skipped unless `RUN_OLLAMA_EVALS=1`) |

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
