import { evalCase, check, judge } from '../src';

evalCase('glob: finds TypeScript files matching **/*.ts', {
  setup: (env) => {
    env.files({
      '/ws/src/app.ts': 'export const x = 1;',
      '/ws/src/util.ts': 'export const y = 2;',
      '/ws/README.md': '# docs',
    });
  },
  prompts: ['Use the glob tool with pattern "**/*.ts" to list TypeScript files. Tell me the filenames.'],
  criteria: [
    check.toolCalled('glob'),
    judge('Response mentions app.ts and util.ts but not README.md.'),
  ],
});
