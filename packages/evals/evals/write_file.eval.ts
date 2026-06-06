import { evalCase, check, judge } from '../src';

evalCase('write_file: writes new file content', {
  setup: (env) => {
    env.confirmAll();
  },
  prompts: ['Write "hello world" to a new file at /ws/output.txt.'],
  criteria: [
    check.toolCalled('write_file'),
    check.fileContains('/ws/output.txt', 'hello world'),
    judge('Response confirms the file was written successfully.'),
  ],
});
