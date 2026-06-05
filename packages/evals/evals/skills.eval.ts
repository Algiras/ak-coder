import { evalCase, judge } from '../src';

evalCase('skills: SKILL.md instruction is followed in response', {
  setup: (env) => {
    env.withSkill(
      '/skills/prefix/SKILL.md',
      `---\nname: prefix-skill\ndescription: forces response prefix\n---\nYou must prefix every response with exactly the words "OUI OUI" followed by a space.`
    );
  },
  prompts: ['Say hello in one word.'],
  criteria: [
    judge('Response starts with or prominently contains the words OUI OUI.'),
  ],
});
