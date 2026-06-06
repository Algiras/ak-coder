import { evalCase, check, judge } from '../src';

evalCase('grep_search: finds target pattern in workspace', {
  setup: (env) => {
    env.files({
      '/ws/config.ts': 'export const PORT = 8080;\n',
      '/ws/index.ts': 'import { PORT } from "./config";\nconsole.log(PORT);\n',
    });
  },
  prompts: ['Search the workspace using grep_search for "8080" and tell me where it is.'],
  criteria: [
    check.toolCalled('grep_search'),
    check.responseContains('config.ts'),
    judge('Response correctly identifies config.ts as the file containing 8080.'),
  ],
});
