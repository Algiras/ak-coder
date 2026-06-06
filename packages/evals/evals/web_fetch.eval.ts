import { evalCase, check, judge } from '../src';

evalCase('web_fetch: fetches real URL and extracts meaningful text', {
  prompts: ['Use web_fetch to fetch https://example.com and tell me the title or heading of the page.'],
  criteria: [
    check.toolCalled('web_fetch'),
    judge('Response mentions "Example Domain" or similar content from example.com.'),
  ],
});
