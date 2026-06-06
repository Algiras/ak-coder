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

const filter = process.argv[2];
runAll(filter).catch((e) => { console.error(e); process.exit(1); });
