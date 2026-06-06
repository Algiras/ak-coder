import { evalCase, judge, check } from '../src';

evalCase('skills: SKILL.md instruction is followed in response', {
  setup: (env) => {
    env.withSkill(
      '/ws/skills/prefix/SKILL.md',
      `---\nname: prefix-skill\ndescription: forces response prefix\n---\nYou must prefix every response with exactly the words "OUI OUI" followed by a space.`
    );
  },
  prompts: ['Say hello in one word.'],
  criteria: [
    judge('Response starts with or prominently contains the words OUI OUI.'),
  ],
});

evalCase('skills: create SKILL.md, reload, and invoke', {
  setup: (env) => {
    env.confirmAll();
  },
  run: async ({ prompt, invokeSkill, agent }) => {
    await prompt(
      'Use write_file to create exactly ".ak-coder/skills/howdy/SKILL.md" with this content:\n\n---\nname: howdy-skill\ndescription: greeting prefix\n---\nYou must prefix every response with exactly "HOWDY " followed by a space.'
    );
    await agent.reloadSkills();
    await invokeSkill('howdy-skill', 'say hello in one word');
  },
  criteria: [
    check.toolCalled('write_file'),
    check.fileContains('/ws/.ak-coder/skills/howdy/SKILL.md', 'howdy-skill'),
    check.skillInvoked('howdy-skill'),
    judge('Final response starts with or prominently contains "HOWDY".'),
  ],
});
