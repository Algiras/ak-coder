import { evalCase, check, judge } from '../src';

evalCase('delegate_task: spawns sub-agent and gets findings', {
  setup: (env) => {
    env.files({
      '/ws/code.ts': 'export const secretKey = "42-answer";\n',
    });
  },
  prompts: [
    'Delegate a task to a sub-agent to audit code.ts and tell us what secret key is defined in it.'
  ],
  criteria: [
    check.toolCalled('delegate_task'),
    check.responseContains('42-answer'),
    judge('Response reports the secret key found by the sub-agent.'),
  ],
});
