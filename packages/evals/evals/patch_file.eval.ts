import { evalCase, check, judge } from '../src';

evalCase('patch_file: patches file after reading it', {
  setup: (env) => {
    env.files({ '/ws/greet.ts': 'export function greet() {\n  return "hello";\n}\n' });
    env.confirmAll();
  },
  prompts: ['Read greet.ts, then use the patch_file tool to replace "hello" with "bonjour". Apply the changes.'],
  criteria: [
    check.toolCalled('patch_file'),
    check.fileContains('/ws/greet.ts', 'bonjour'),
    judge('Response reports that patch_file was executed and the greeting was updated.'),
  ],
});
