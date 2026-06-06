// Import all eval files to register their cases
import './evals/bash.eval';
import './evals/glob.eval';
import './evals/str_replace.eval';
import './evals/web_fetch.eval';
import './evals/session.eval';
import './evals/skills.eval';
import './evals/read_file.eval';
import './evals/write_file.eval';
import './evals/patch_file.eval';
import './evals/list_directory.eval';
import './evals/grep_search.eval';
import './evals/semantic_search.eval';
import './evals/delegate_task.eval';
import './evals/plan.eval';

import { runAll } from './src';

const args = process.argv.slice(2);
let filter: string | undefined = undefined;
let providers: string[] | undefined = undefined;
let report = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--filter=')) {
    filter = arg.slice('--filter='.length);
  } else if (arg === '--filter') {
    filter = args[++i];
  } else if (arg.startsWith('--providers=')) {
    providers = arg.slice('--providers='.length).split(',').map(s => s.trim());
  } else if (arg === '--providers') {
    providers = args[++i].split(',').map(s => s.trim());
  } else if (arg === '--report' || arg === '--report=true') {
    report = true;
  } else if (!arg.startsWith('-') && !filter) {
    filter = arg;
  }
}

runAll({ filter, providers, report }).catch((e) => {
  console.error(e);
  process.exit(1);
});
