---
sidebar_position: 3
---

# Running Evals

Evals require Ollama running locally (used as the LLM judge).

## Basic usage

```bash
# Run all evals with active provider
bun run packages/evals/run.ts

# Filter by name
bun run packages/evals/run.ts --filter=bash

# Run specific providers
bun run packages/evals/run.ts --providers=ollama,ollama-nemotron

# Generate structured report
bun run packages/evals/run.ts --providers=ollama --report

# Run 3x to detect flaky evals
bun run packages/evals/run.ts --runs=3

# Regenerate golden snapshots (flag is read by check.golden in checks.ts)
bun run packages/evals/run.ts --filter=golden --update-goldens
```

## Output

The runner prints a PASS/FAIL table per eval with token count and latency, then a **binary score matrix** across all providers.

With `--report`, two outputs are written to `packages/evals/`:
- `eval_results.jsonl` — append-only log, one JSON line per case × run × provider
- `reports/<YYYY-MM-DD>/summary.md` + `cases/<slug>.md` — human-readable run reports

## Stability

Use `--runs=N` to detect flaky evals. A case is **stable** only if it passes all N runs. The matrix shows:
- `1` — stable pass
- `0` — failing
- `⚠️ (2/3)` — flaky

## Provider config

Providers used in evals are the same keys as in `~/.ak-coder/config.json`. The `--providers` flag takes comma-separated provider keys.
