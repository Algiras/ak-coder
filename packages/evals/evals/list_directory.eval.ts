import { evalCase, check, judge } from '../src';

evalCase('list_directory: list contents of workspace', {
  setup: (env) => {
    env.files({
      '/ws/main.ts': 'export {}',
      '/ws/helper.ts': 'export {}',
      '/ws/doc.md': '# documentation',
    });
  },
  prompts: ['Use list_directory to see what files are in the workspace, and list the helper file name.'],
  criteria: [
    check.toolCalled('list_directory'),
    check.responseContains('helper.ts'),
    judge('Response lists helper.ts as one of the files in the directory.'),
  ],
});
