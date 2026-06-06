import { describe, it, expect } from 'bun:test';
import { AgentCore } from '../src/agent';
import { OpenAICompatibleLLMService } from '../src/adapters/llm';
import { LLMService, ChatMessage } from '../src/ports';
import {
  MockFileSystem,
  MockSessionStore,
  MockLogger
} from '../src/mocks';

// LLM as a Judge Helper
export class LLMJudge {
  constructor(private llm: LLMService) {}

  async evaluate(params: {
    prompt: string;
    response: string;
    criteria: string;
  }): Promise<{ pass: boolean; reasoning: string }> {
    const judgePrompt = `You are a strict quality control judge evaluating an AI agent's response to a developer prompt.
Evaluate the following:
1. User Prompt: "${params.prompt}"
2. Agent Response: "${params.response}"
3. Success Criteria: "${params.criteria}"

Determine if the agent response successfully meets the success criteria.
Respond ONLY with a JSON object:
{
  "pass": true | false,
  "reasoning": "A concise explanation of why it passed or failed."
}
Do not write any markdown blocks or commentary.`;

    const result = await this.llm.chat([{ role: 'user', content: judgePrompt }]);
    try {
      const parsed = JSON.parse(result.text.trim());
      return {
        pass: !!parsed.pass,
        reasoning: parsed.reasoning || 'No reasoning provided.'
      };
    } catch {
      // Fallback regex parser for markdown wrapped json
      const match = result.text.match(/\{[\s\S]*?\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          return { pass: !!parsed.pass, reasoning: parsed.reasoning || '' };
        } catch {}
      }
      return { pass: false, reasoning: `Failed to parse judge JSON. Raw text: ${result.text}` };
    }
  }
}

// Run with: RUN_OLLAMA_EVALS=1 bun test packages/core/tests/ollama_evals.test.ts
const runOllamaEvals = !!process.env.RUN_OLLAMA_EVALS;

describe.skipIf(!runOllamaEvals)('Local Ollama E2E Evals', () => {
  async function detectModel(): Promise<string> {
    const preferred = ['gemma4:31b-cloud', 'gemma4:12b-mlx', 'gemma4:latest'];
    try {
      const response = await fetch('http://127.0.0.1:11434/api/tags');
      if (response.ok) {
        const data = await response.json() as { models: { name: string }[] };
        const modelNames = data.models.map(m => m.name);
        for (const model of preferred) {
          if (modelNames.includes(model)) return model;
        }
      }
    } catch {}
    return 'gemma4:latest';
  }

  it('should run dialogue through local Ollama instance', async () => {
    const mockFs = new MockFileSystem();
    const mockStore = new MockSessionStore();
    const mockLogger = new MockLogger();
    const model = await detectModel();

    console.log(`[Evals] Running basic dialogue check with: ${model}`);

    const llm = new OpenAICompatibleLLMService('mock-key', 'http://127.0.0.1:11434/v1', model);
    const agent = new AgentCore(mockFs, llm, mockStore, mockLogger);

    await agent.startSession('ollama-dialogue-sess');
    const result = await agent.processMessage('What is 3 + 3? Answer in one word.');
    
    expect(result.text).toBeDefined();
    const cleanText = result.text.toLowerCase().trim();
    expect(cleanText.includes('six') || cleanText.includes('6')).toBe(true);
  }, 30000);

  it('Eval: LLM as a Judge Flow', async () => {
    const mockFs = new MockFileSystem();
    const mockStore = new MockSessionStore();
    const mockLogger = new MockLogger();
    const model = await detectModel();

    console.log(`[Evals] Running LLM-as-a-Judge test with: ${model}`);

    const llm = new OpenAICompatibleLLMService('mock-key', 'http://127.0.0.1:11434/v1', model);
    const agent = new AgentCore(mockFs, llm, mockStore, mockLogger);
    const judge = new LLMJudge(llm);

    await agent.startSession('ollama-judge-sess');

    const prompt = 'Write a short Python function named fib that recursively computes Fibonacci numbers.';
    const result = await agent.processMessage(prompt);

    console.log(`[Evals] Agent code response: \n${result.text}`);

    const evaluation = await judge.evaluate({
      prompt,
      response: result.text,
      criteria: 'The response contains a valid Python function named fib that recursively computes Fibonacci numbers.'
    });

    console.log(`[Evals] Judge verdict: ${evaluation.pass ? 'PASS' : 'FAIL'} | Reasoning: ${evaluation.reasoning}`);

    expect(evaluation.pass).toBe(true);
  }, 150000); // 150s timeout for two model calls (generation + evaluation)

  it('Eval: E2E Long Dialogue Compaction with local Ollama', async () => {
    const mockFs = new MockFileSystem();
    const mockStore = new MockSessionStore();
    const mockLogger = new MockLogger();
    const model = await detectModel();

    console.log(`[Evals] Running E2E Long Dialogue Compaction with: ${model}`);

    const llm = new OpenAICompatibleLLMService('mock-key', 'http://127.0.0.1:11434/v1', model);
    const agent = new AgentCore(mockFs, llm, mockStore, mockLogger);

    // Set threshold low to force compaction
    (agent as any).maxContextTokens = 25; 

    await agent.startSession('ollama-compaction-sess');

    // Turn 1
    await agent.processMessage('My name is Alice and I am building a website.');
    // Turn 2
    await agent.processMessage('I am using HTML and CSS for my website.');
    
    // Turn 3: Triggers compaction due to low limit
    const res3 = await agent.processMessage('I live in Vilnius.');
    expect(res3.compacted).toBe(true);
    expect(agent.getContextSummary()).not.toBeNull();

    // Turn 4: Verify the agent remembers the context stored in the summary
    const res4 = await agent.processMessage('What is my name and what technology am I using? Answer in one short sentence.');
    console.log(`[Evals] Compaction retention check response: ${res4.text}`);

    expect(res4.text.toLowerCase()).toContain('alice');
    expect(res4.text.toLowerCase()).toContain('html');
    expect(res4.text.toLowerCase()).toContain('css');
  }, 180000); // 180s timeout for 4 model steps + summarization

  it('Eval: SKILL.md Prompt Ingestion and usage with local Ollama', async () => {
    const mockFs = new MockFileSystem();
    const mockStore = new MockSessionStore();
    const mockLogger = new MockLogger();
    const model = await detectModel();

    console.log(`[Evals] Running E2E Skill Ingestion usage check with: ${model}`);

    const llm = new OpenAICompatibleLLMService('mock-key', 'http://127.0.0.1:11434/v1', model);
    const agent = new AgentCore(mockFs, llm, mockStore, mockLogger);

    const skillContent = `---
name: french-french
description: "forces response prefix"
---
You must prefix every response with exactly the words 'OUI OUI' followed by a space.`;

    await mockFs.writeFile('/skills/french/SKILL.md', skillContent);
    await agent.loadSkills('/');

    await agent.startSession('ollama-skill-sess');
    const res = await agent.processMessage('Say hello in one word.');
    console.log(`[Evals] Skill usage check response: ${res.text}`);

    expect(res.text.toUpperCase()).toContain('OUI OUI');
  }, 120000);

  it('Eval: web_fetch — agent fetches a real URL and extracts meaningful text', async () => {
    const mockFs = new MockFileSystem();
    const mockStore = new MockSessionStore();
    const mockLogger = new MockLogger();
    const model = await detectModel();
    const llm = new OpenAICompatibleLLMService('mock-key', 'http://127.0.0.1:11434/v1', model);
    const agent = new AgentCore(mockFs, llm, mockStore, mockLogger);
    const judge = new LLMJudge(llm);

    console.log(`[Evals] web_fetch eval with: ${model}`);
    await agent.startSession('ollama-webfetch-sess');

    const result = await agent.processMessage(
      'Use web_fetch to fetch https://example.com and tell me the title or main heading of the page. One sentence.'
    );
    console.log(`[Evals] web_fetch response: ${result.text}`);

    const evaluation = await judge.evaluate({
      prompt: 'Fetch https://example.com and state the title or main heading.',
      response: result.text,
      criteria: 'The response mentions "Example Domain" or similar content from example.com.'
    });
    console.log(`[Evals] Judge: ${evaluation.pass ? 'PASS' : 'FAIL'} | ${evaluation.reasoning}`);
    expect(evaluation.pass).toBe(true);
  }, 90000);

  it('Eval: glob — agent uses glob to find TypeScript files in a workspace', async () => {
    const mockFs = new MockFileSystem();
    mockFs.files.set('/ws/src/app.ts', 'export const x = 1;');
    mockFs.files.set('/ws/src/util.ts', 'export const y = 2;');
    mockFs.files.set('/ws/README.md', '# docs');
    const mockStore = new MockSessionStore();
    const mockLogger = new MockLogger();
    const model = await detectModel();
    const llm = new OpenAICompatibleLLMService('mock-key', 'http://127.0.0.1:11434/v1', model);
    // No real processRunner — uses in-process glob fallback
    const agent = new AgentCore(mockFs, llm, mockStore, mockLogger, undefined, undefined, '/ws');
    const judge = new LLMJudge(llm);

    console.log(`[Evals] glob eval with: ${model}`);
    await agent.startSession('ollama-glob-sess');

    const result = await agent.processMessage(
      'Use the glob tool with pattern "**/*.ts" to list all TypeScript files in the workspace. Tell me the filenames you found.'
    );
    console.log(`[Evals] glob response: ${result.text}`);

    const evaluation = await judge.evaluate({
      prompt: 'List TypeScript files using glob **/*.ts',
      response: result.text,
      criteria: 'The response mentions app.ts and util.ts (the TypeScript files in the workspace).'
    });
    console.log(`[Evals] Judge: ${evaluation.pass ? 'PASS' : 'FAIL'} | ${evaluation.reasoning}`);
    expect(evaluation.pass).toBe(true);
  }, 90000);

  it('Eval: str_replace — agent uses str_replace to make a targeted edit', async () => {
    const mockFs = new MockFileSystem();
    mockFs.files.set('/ws/greet.ts', 'export function greet() { return "hello"; }\n');
    const mockStore = new MockSessionStore();
    const mockLogger = new MockLogger();
    const model = await detectModel();
    const llm = new OpenAICompatibleLLMService('mock-key', 'http://127.0.0.1:11434/v1', model);
    const { MockTerminalIo } = await import('../src/mocks');
    const nio = new MockTerminalIo();
    nio.confirmResults = [{ approved: true, applyToAll: true }];
    const agent = new AgentCore(mockFs, llm, mockStore, mockLogger, undefined, nio, '/ws');

    console.log(`[Evals] str_replace eval with: ${model}`);
    await agent.startSession('ollama-str-replace-sess');

    const result = await agent.processMessage(
      'Read /ws/greet.ts, then use str_replace to change the return value from "hello" to "world". Apply the change.'
    );
    console.log(`[Evals] str_replace response: ${result.text}`);

    const fileContent = mockFs.files.get('/ws/greet.ts') ?? '';
    console.log(`[Evals] File after edit: ${fileContent}`);
    expect(fileContent).toContain('"world"');
  }, 90000);

  it('Eval: /resume — agent session persists and resumes correctly', async () => {
    const mockFs = new MockFileSystem();
    const mockStore = new MockSessionStore();
    const mockLogger = new MockLogger();
    const model = await detectModel();
    const llm = new OpenAICompatibleLLMService('mock-key', 'http://127.0.0.1:11434/v1', model);
    const agent = new AgentCore(mockFs, llm, mockStore, mockLogger);

    console.log(`[Evals] resume eval with: ${model}`);
    await agent.startSession('resume-test-session');

    await agent.processMessage('Remember: the magic number is 42.');
    await mockStore.saveSession('resume-test-session', agent.getMessages());

    // Start fresh, then resume
    const agent2 = new AgentCore(mockFs, llm, mockStore, mockLogger);
    await agent2.startSession('resume-test-session');

    const result = await agent2.processMessage('What is the magic number I told you about?');
    console.log(`[Evals] Resume response: ${result.text}`);
    expect(result.text).toContain('42');
  }, 90000);

  it('Eval: bash — agent runs a real shell command and reports output', async () => {
    const mockFs = new MockFileSystem();
    const mockStore = new MockSessionStore();
    const mockLogger = new MockLogger();
    const model = await detectModel();
    const llm = new OpenAICompatibleLLMService('mock-key', 'http://127.0.0.1:11434/v1', model);

    const { NodeProcessRunner } = await import('../../../apps/cli/src/adapters/process');
    const { MockTerminalIo } = await import('../src/mocks');
    const nio = new MockTerminalIo();
    nio.confirmResults = [{ approved: true, applyToAll: true }]; // approve any prompts

    const agent = new AgentCore(mockFs, llm, mockStore, mockLogger, new NodeProcessRunner(), nio);
    const judge = new LLMJudge(llm);

    console.log(`[Evals] bash eval with: ${model}`);
    await agent.startSession('ollama-bash-sess');

    const result = await agent.processMessage(
      'Use the bash tool to run "echo hello-from-bash" and tell me what it printed.'
    );
    console.log(`[Evals] bash response: ${result.text}`);

    const evaluation = await judge.evaluate({
      prompt: 'Run echo hello-from-bash and report the output.',
      response: result.text,
      criteria: 'The response mentions "hello-from-bash" as the output of the command.'
    });
    console.log(`[Evals] Judge: ${evaluation.pass ? 'PASS' : 'FAIL'} | ${evaluation.reasoning}`);
    expect(evaluation.pass).toBe(true);
  }, 90000);
});
