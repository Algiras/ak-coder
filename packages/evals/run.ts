// Import all eval files to register their cases
import './evals/bash.eval';
import './evals/glob.eval';
import './evals/str_replace.eval';
import './evals/web_fetch.eval';
import './evals/session.eval';
import './evals/skills.eval';

import { runAll } from './src';

const filter = process.argv[2];
runAll(filter).catch((e) => { console.error(e); process.exit(1); });
