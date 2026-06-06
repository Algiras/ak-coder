import { evalCase, check, judge } from '../src';

evalCase('str_replace: targeted edit after read', {
  setup: (env) => {
    env.files({ '/ws/greet.ts': 'export function greet() { return "hello"; }\n' });
    env.confirmAll();
  },
  prompts: ['Read /ws/greet.ts, then use str_replace to change "hello" to "world". Apply the change.'],
  criteria: [
    check.toolCalled('str_replace'),
    check.fileContains('/ws/greet.ts', '"world"'),
    judge('Response confirms the file was updated successfully.'),
  ],
});

evalCase('str_replace: rejected when file not read first', {
  setup: (env) => {
    env.files({ '/ws/app.ts': 'const x = 1;\n' });
  },
  prompts: ['Use str_replace on /ws/app.ts to change "const x = 1" to "const x = 2" without reading it first.'],
  criteria: [
    judge('Response indicates the edit failed or was rejected because the file was not read first.'),
  ],
});
