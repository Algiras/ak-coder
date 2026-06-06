import { evalCase, check, judge } from '../src';

evalCase('write_file: writes new file content', {
  setup: (env) => {
    env.confirmAll();
  },
  prompts: ['Check if /ws/output.txt exists, then write "hello world" to it.'],
  criteria: [
    check.toolCalled('write_file'),
    check.fileContains('/ws/output.txt', 'hello world'),
    judge('Response confirms the file was written successfully.'),
  ],
});
