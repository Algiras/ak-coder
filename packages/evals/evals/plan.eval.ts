import { evalCase, check, judge } from '../src';

evalCase('plan: planning mode restricts mutations and returns structured plan', {
  setup: (env) => {
    env.files({ '/ws/greet.ts': 'export function greet() { return "hello"; }\n' });
    env.withConfirmationPreset('plan');
  },
  prompts: ['Propose a plan to change greeting value from "hello" to "bonjour" in greet.ts.'],
  criteria: [
    check.responseMatches(/plan|goal|approach|step/i),
    judge('The response describes a step-by-step plan rather than executing the changes directly.'),
  ],
});
