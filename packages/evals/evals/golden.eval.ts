import { evalCase, check } from '../src';

evalCase('golden: read and write file matching golden snapshot', {
  setup: (env) => {
    env.confirmAll();
    env.files({ '/ws/source.txt': 'Golden source data' });
  },
  prompts: ['Read /ws/source.txt first, then write its exact content to /ws/destination.txt using the write_file tool.'],
  criteria: [
    check.golden('golden_source_dest', { checkToolCalls: false, checkFiles: true }),
  ],
});
