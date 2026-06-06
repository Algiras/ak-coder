# packages/evals — Eval harness conventions

## Purpose

LLM-as-judge evaluation system for testing agent behavior end-to-end against a real (Ollama-backed) LLM. Evals complement unit tests by verifying that the agent actually uses the right tools and produces correct output on realistic prompts.

## File Map

```
src/
  checks.ts     — Static criterion helpers (check.toolCalled, check.fileContains, check.golden, etc.)
  judge.ts      — LLMJudge class + judge() criterion builder (LLM-graded criteria)
  harness.ts    — EvalEnv builder: virtual/real FS, agents, MCP, plugins, skills
  runner.ts     — runAll() orchestrator: runs evals, prints binary matrix, writes reports
  index.ts      — re-exports
evals/
  bash.eval.ts          — bash tool: echo output, read-only commands
  glob.eval.ts          — glob tool: pattern matching
  grep_search.eval.ts   — grep_search tool: pattern in workspace
  list_directory.eval.ts — list_directory tool: workspace listing
  patch_file.eval.ts    — patch_file tool: read-then-patch flow
  plan.eval.ts          — planning mode: structured plan, no mutations
  read_file.eval.ts     — read_file tool: content retrieval
  write_file.eval.ts    — write_file tool: new file creation
  str_replace.eval.ts   — str_replace tool: targeted edit + read-first guard
  session.eval.ts       — multi-turn context + compaction retention
  semantic_search.eval.ts — index_workspace + semantic_search tool
  delegate_task.eval.ts — delegate_task sub-agent spawning
  skills.eval.ts        — SKILL.md load + create/reload/invoke (run + invokeSkill)
  web_fetch.eval.ts     — web_fetch tool: real URL fetch
  golden.eval.ts        — golden snapshot: file-state consistency check
goldens/
  *.json                — Snapshot files written/read by check.golden()
reports/
  <YYYY-MM-DD>/
    summary.md          — Per-run markdown report (binary matrix + per-provider details)
    cases/<slug>.md     — Per-case breakdown across providers
eval_results.jsonl      — Append-only machine-readable log (one JSON line per case × run × provider)
run.ts                  — entry point: bun run packages/evals/run.ts [options]
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

For multi-step flows (create file → reload skills → invoke), use `run` instead of `prompts`:

```ts
evalCase('skills: create SKILL.md, reload, and invoke', {
  setup: (env) => env.confirmAll(),
  run: async ({ prompt, invokeSkill, agent }) => {
    await prompt('Use write_file to create .ak-coder/skills/howdy/SKILL.md …');
    await agent.reloadSkills();
    await invokeSkill('howdy-skill', 'say hello in one word');
  },
  criteria: [check.skillInvoked('howdy-skill'), /* … */],
});
```

`invokeSkill(name, args)` mirrors the REPL `/skills:<name>` message format. `check.skillInvoked(name)` asserts the conversation contains `Apply Skill "<name>"`.

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
# Active provider (from ~/.ak-coder/config.json activeProvider)
bun run packages/evals/run.ts

# Filter by eval name substring
bun run packages/evals/run.ts --filter=bash

# Run specific providers (comma-separated keys from config.json providers)
bun run packages/evals/run.ts --providers=ollama,ollama-nemotron

# Generate markdown + JSON report files
bun run packages/evals/run.ts --providers=ollama,ollama-nemotron --report

# Run each eval N times to detect flaky evals (only all-N-pass counts as stable)
bun run packages/evals/run.ts --filter=bash --runs=3

# Regenerate golden snapshots (overwrites goldens/*.json)
bun run packages/evals/run.ts --filter=golden --update-goldens
```

The runner prints a per-criterion `PASS`/`FAIL` table and a **binary score matrix** across all providers.

---

## Reports & Output

When `--report` is passed, the runner writes structured output under `packages/evals/`:

### `eval_results.jsonl`
Append-only log — one JSON line per case × provider (× run when `--runs=N`). Schema:
```json
{
  "runId": "2026-06-06",
  "provider": "ollama",
  "model": "gemma4:31b-cloud",
  "totalRuns": 1,
  "case": "bash: runs echo and reports output",
  "pass": true,
  "score": 1,
  "stability": { "passes": 1, "runs": 1, "flaky": false },
  "latencySeconds": 3.4,
  "totalTokens": 39,
  "error": null,
  "criteria": [
    { "type": "static", "description": "...", "pass": true, "reasoning": null }
  ]
}
```

### `reports/<YYYY-MM-DD>/summary.md`
Human-readable run report containing:
- **Summary table** — provider, model, stable pass rate, avg latency, avg tokens
- **Binary score matrix** — `1` = stable pass · `0` = failing · `⚠️` = flaky

### `reports/<YYYY-MM-DD>/cases/<slug>.md`
Per-case detail files with per-provider stability and per-criterion breakdown.

`eval_results.jsonl`, `eval_report.json`, and `reports/` are gitignored — they are local run artifacts. `eval_report.md` is **committed** as the human-readable versioned snapshot.

---

## Goldens (`goldens/` directory)

Golden snapshots capture the **expected file-system state** after an eval run. They are used exclusively by `check.golden(name, options)`.

| Option | Default | What it checks |
|---|---|---|
| `checkFiles` | `true` | Final virtual FS contents match the snapshot |
| `checkToolCalls` | `true` | Tool call sequence matches exactly |
| `checkResponse` | `false` | Final response text matches exactly |

**When to use `checkToolCalls: false`**: Tool call sequences are non-deterministic across model versions. Prefer checking only `checkFiles` unless you are specifically testing tool-call discipline.

**Updating snapshots**: Run with `--update-goldens` to regenerate all `goldens/*.json` files:
```bash
bun run packages/evals/run.ts --filter=golden --update-goldens
```

The `goldens/` directory is **required** as long as any eval uses `check.golden()`. Do not delete it.
