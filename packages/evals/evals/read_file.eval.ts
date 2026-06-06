import { evalCase, check, judge } from '../src';

evalCase('read_file: reads file and reports content', {
  setup: (env) => {
    env.files({ '/ws/config.json': '{"theme": "dark"}\n' });
  },
  prompts: ['Read the file at /ws/config.json and tell me what theme is configured.'],
  criteria: [
    check.toolCalled('read_file'),
    check.responseContains('dark'),
    judge('Response correctly states that the theme is configured as dark.'),
  ],
});
