# packages/evals — Eval harness conventions

## Purpose

LLM-as-judge evaluation system for testing agent behavior end-to-end against a real (Ollama-backed) LLM. Evals complement unit tests by verifying that the agent actually uses the right tools and produces correct output on realistic prompts.

## File Map

```
src/
  checks.ts     — Static criterion helpers (check.toolCalled, check.fileContains, etc.)
  judge.ts      — LLMJudge class + judge() criterion builder (LLM-graded criteria)
  harness.ts    — EvalEnv builder: virtual/real FS, agents, MCP, plugins
  runner.ts     — runAll() orchestrator with table output
  index.ts      — re-exports
evals/
  bash.eval.ts
  glob.eval.ts
  session.eval.ts
  str_replace.eval.ts
  web_fetch.eval.ts
  skills.eval.ts
run.ts          — entry point: bun run packages/evals/run.ts [filter]
```

---

## How to Write an Eval

Create `packages/evals/evals/<feature>.eval.ts`:

```ts
import { evalCase } from '../src';
import { check, judge } from '../src';

evalCase('feature: description of what the agent should do', {
  prompt: 'List all TypeScript files in the src directory',
  setup: (env) => {
    env.files({ 'src/foo.ts': 'export {}', 'src/bar.ts': '' });
    env.confirmAll();   // auto-approve writes/commands
  },
  criteria: [
    check.toolCalled('list_directory'),             // static: was the tool used?
    check.responseContains('foo.ts'),               // static: is text in the response?
    judge('The response mentions the TypeScript files found'),  // LLM-graded
  ]
});
```

`run.ts` auto-discovers all `*.eval.ts` files — no registration needed.

---

## How to Add a New Static Check Type

Edit **`packages/evals/src/checks.ts`** — add a new exported function:

```ts
export function myCheck(expectedValue: string): StaticCriterion {
  return {
    type: 'static',
    description: `My check: "${expectedValue}"`,
    check: ({ messages, files, finalResponse }) => {
      // return true if criterion passes, false if it fails
      return finalResponse.includes(expectedValue);
    }
  };
}
```

Then add it to the `check` export object at the bottom of `checks.ts`:
```ts
export const check = { ..., myCheck };
```

`CheckContext` fields available in your check function:

| Field | Type | What it contains |
|-------|------|-----------------|
| `messages` | `ChatMessage[]` | Full conversation including tool calls |
| `files` | `Map<string, string>` | Final state of the virtual filesystem |
| `finalResponse` | `string` | The agent's last text response |

---

## EvalEnv Cheat Sheet

| Method | Purpose |
|--------|---------|
| `env.files(map)` | Seed the virtual MockFileSystem |
| `env.realFiles(map)` | Write real files to a temp dir (for bash evals) |
| `env.confirmAll()` | Set confirmation policy to `yolo` (auto-approve everything) |
| `env.withProcessRunner()` | Enable real bash execution via NodeProcessRunner |
| `env.withMcp(name, cmd, args)` | Attach a real MCP server |
| `env.withPlugin(manifest)` | Attach a plugin by manifest object |
| `env.buildAgent(llm, root)` | Returns `AgentCore` ready to run |
| `env.cleanup()` | Remove real temp dirs after eval |

---

## Running Evals

```bash
# All evals (requires Ollama running locally)
bun run packages/evals/run.ts

# Filter by name
bun run packages/evals/run.ts bash

# Override model
OLLAMA_MODEL=llama3.1 bun run packages/evals/run.ts
```

The runner prints a table: `PASS` / `FAIL` per criterion, with the judge's reasoning for LLM-graded criteria.
