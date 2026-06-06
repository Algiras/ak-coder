import { evalCase, check, judge } from '../src';

evalCase('session: context retained across multi-turn dialogue', {
  prompts: [
    'My name is Alice and I am building a website with React.',
    'What is my name and what technology am I using? One sentence.',
  ],
  criteria: [
    check.responseContains('Alice'),
    judge('Response correctly recalls the name Alice and the technology React.'),
  ],
});

evalCase('session: compaction preserves context', {
  setup: (env) => {
    // Will be forced via low token limit set on agent directly
  },
  prompts: [
    'My name is Alice and I am building a website.',
    'I am using HTML and CSS.',
    'I live in Vilnius.',
    'What is my name and what technology am I using? One sentence.',
  ],
  criteria: [
    judge('Response mentions Alice and HTML or CSS.'),
  ],
  timeout: 180000,
});
