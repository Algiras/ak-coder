---
sidebar_position: 2
---

# Writing Evals

Create `packages/evals/evals/<feature>.eval.ts`:

```typescript
import { evalCase, check, judge } from '../src';

evalCase('feature: what the agent should do', {
  prompts: ['Ask the agent to do something specific'],
  setup: (env) => {
    env.files({ '/ws/src/app.ts': 'export const x = 1;' });
    env.confirmAll();   // auto-approve writes/commands
  },
  criteria: [
    check.toolCalled('read_file'),           // was the tool used?
    check.fileContains('/ws/out.ts', 'foo'), // is text in the file?
    check.responseContains('success'),       // is text in the response?
    judge('Response confirms the task completed successfully'),
  ],
});
```

`run.ts` auto-discovers all `*.eval.ts` files — no registration needed.

## Available checks

| Check | Description |
|-------|-------------|
| `check.toolCalled(name)` | Tool was invoked at least once |
| `check.toolCalledWith(name, args)` | Tool was invoked with specific args |
| `check.fileContains(path, substring)` | File exists and contains text |
| `check.fileModified(path)` | File was written during the run |
| `check.responseContains(substring)` | Final response contains text |
| `check.responseMatches(regex)` | Final response matches pattern |
| `check.golden(name, opts)` | File state matches a saved snapshot |

## Multi-turn evals

Pass multiple prompts to simulate a conversation:

```typescript
evalCase('session: context retained', {
  prompts: [
    'My favorite color is blue.',
    'What is my favorite color?',
  ],
  criteria: [
    check.responseContains('blue'),
  ],
});
```

## Golden snapshots

Capture the expected filesystem state after a run:

```typescript
evalCase('golden: write then read', {
  setup: (env) => {
    env.confirmAll();
    env.files({ '/ws/input.txt': 'hello' });
  },
  prompts: ['Copy /ws/input.txt to /ws/output.txt'],
  criteria: [
    check.golden('copy_input_to_output', { checkToolCalls: false, checkFiles: true }),
  ],
});
```

On first run the snapshot is created. Subsequent runs compare against it. Regenerate with `--update-goldens`.
