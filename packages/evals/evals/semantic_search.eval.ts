import { evalCase, check, judge } from '../src';

evalCase('semantic_search: index workspace and find relevant file', {
  setup: (env) => {
    env.files({
      '/ws/db.ts': '// Database connection, postgres pool setup, schema configuration\nexport const query = () => {};\n',
      '/ws/main.ts': '// entry point\n',
    });
  },
  prompts: [
    'Index the workspace, then use semantic_search to find where the postgres pool setup or database connection is defined.'
  ],
  criteria: [
    check.toolCalled('index_workspace'),
    check.toolCalled('semantic_search'),
    check.responseContains('db.ts'),
    judge('Response correctly points out that database/postgres pool setup is in db.ts.'),
  ],
});
