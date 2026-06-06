import { evalCase, check, judge } from '../src';

evalCase('bash: runs echo and reports output', {
  setup: (env) => { env.withProcessRunner(); env.confirmAll(); },
  prompts: ['Use the bash tool to run "echo hello-from-bash" and tell me what it printed.'],
  criteria: [
    check.toolCalled('bash'),
    check.responseContains('hello-from-bash'),
    judge('Response reports the command output as hello-from-bash.'),
  ],
});

evalCase('bash: safe read-only commands run without confirmation', {
  setup: (env) => {
    env.withProcessRunner();
    env.realFiles({ 'hello.txt': 'world', 'readme.md': '# hi' });
  },
  prompts: ['Run "ls" using the bash tool and report the filenames you see.'],
  criteria: [
    check.toolCalled('bash'),
    judge('Response lists filenames including hello.txt or readme.md.'),
  ],
});
