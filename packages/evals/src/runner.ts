import { OpenAICompatibleLLMService } from '@ak-coder/core';
import { LLMJudge } from './judge';
import { EvalEnv, getRegistry } from './harness';
import type { EvalCase, EvalResult, CriterionResult } from './harness';
import type { CheckContext } from './checks';

async function detectModel(): Promise<string> {
  const preferred = ['gemma4:31b-cloud', 'gemma4:12b-mlx', 'gemma4:latest'];
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags');
    if (res.ok) {
      const data = await res.json() as { models: { name: string }[] };
      const names = data.models.map(m => m.name);
      for (const m of preferred) if (names.includes(m)) return m;
    }
  } catch {}
  return 'gemma4:latest';
}

async function runEval(
  evalCase: EvalCase,
  llm: OpenAICompatibleLLMService,
  judge: LLMJudge
): Promise<EvalResult> {
  const start = Date.now();

  try {
    const env = new EvalEnv();
    if (evalCase.setup) await evalCase.setup(env);

    const agent = await env.buildAgent(llm);
    const sessionId = `eval-${Date.now()}`;

    await agent.startSession(sessionId);

    const prompts = Array.isArray(evalCase.prompts) ? evalCase.prompts : [evalCase.prompts];
    let lastResult = { text: '', inputTokens: 0, outputTokens: 0 };

    for (const prompt of prompts) {
      lastResult = await agent.processMessage(prompt);
    }

    const messages = agent.getMessages();
    const ctx: CheckContext = {
      messages,
      files: env.fs.files,
      finalResponse: lastResult.text,
    };

    const totalTokens = messages.reduce((sum, m) => {
      // rough estimate from stored messages
      return sum + Math.ceil((m.content?.length ?? 0) / 4);
    }, 0);

    const criteriaResults: CriterionResult[] = [];

    for (const criterion of evalCase.criteria) {
      if (criterion.type === 'static') {
        const pass = await criterion.check(ctx);
        criteriaResults.push({ type: 'static', description: criterion.description, pass });
      } else {
        const result = await judge.evaluate(prompts[prompts.length - 1], lastResult.text, criterion.description);
        criteriaResults.push({ type: 'judge', description: criterion.description, pass: result.pass, reasoning: result.reasoning });
      }
    }

    await agent.stopMcpServers();
    env.cleanup();

    const pass = criteriaResults.every(c => c.pass);
    return { name: evalCase.name, pass, criteria: criteriaResults, totalTokens, latencyMs: Date.now() - start };
  } catch (e) {
    return {
      name: evalCase.name,
      pass: false,
      criteria: [],
      totalTokens: 0,
      latencyMs: Date.now() - start,
      error: (e as Error).message,
    };
  }
}

function renderTable(results: EvalResult[]): void {
  const passed = results.filter(r => r.pass).length;
  const col = (s: string, w: number) => s.slice(0, w).padEnd(w);

  console.log('\n' + '─'.repeat(82));
  console.log(
    `  ${col('eval', 38)} ${col('result', 7)} ${col('tokens', 7)} ${col('latency', 8)} criteria`
  );
  console.log('─'.repeat(82));

  for (const r of results) {
    const result = r.error ? 'ERROR ' : r.pass ? '\x1b[32mPASS\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m  ';
    const passed = r.criteria.filter(c => c.pass).length;
    const total = r.criteria.length;
    const latency = (r.latencyMs / 1000).toFixed(1) + 's';
    console.log(
      `  ${col(r.name, 38)} ${result} ${col(String(r.totalTokens), 7)} ${col(latency, 8)} ${passed}/${total}`
    );
    // Print failing criteria details
    for (const c of r.criteria) {
      if (!c.pass) {
        const tag = c.type === 'judge' ? '[judge]' : '[check]';
        console.log(`    \x1b[31m✗ ${tag} ${c.description}\x1b[0m`);
        if (c.reasoning) console.log(`      ${c.reasoning}`);
      }
    }
    if (r.error) console.log(`    \x1b[31m✗ Error: ${r.error}\x1b[0m`);
  }

  console.log('─'.repeat(82));
  console.log(`  ${passed}/${results.length} evals passed\n`);
}

export async function runAll(filter?: string): Promise<void> {
  const model = await detectModel();
  console.log(`\nRunning evals against: ${model}\n`);

  const llm = new OpenAICompatibleLLMService('mock-key', 'http://127.0.0.1:11434/v1', model);
  const judge = new LLMJudge(llm);

  let cases = getRegistry();
  if (filter) cases = cases.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()));

  if (cases.length === 0) {
    console.log(`No evals matched filter: "${filter}"`);
    return;
  }

  const results: EvalResult[] = [];
  for (const c of cases) {
    process.stdout.write(`  running: ${c.name} ... `);
    const result = await runEval(c, llm, judge);
    process.stdout.write(result.pass ? '\x1b[32mPASS\x1b[0m\n' : '\x1b[31mFAIL\x1b[0m\n');
    results.push(result);
  }

  renderTable(results);

  const anyFailed = results.some(r => !r.pass);
  if (anyFailed) process.exit(1);
}
