import { OpenAICompatibleLLMService, ConfigManager } from '@ak-coder/core';
import { LLMJudge } from './judge';
import { EvalEnv, getRegistry } from './harness';
import type { EvalCase, EvalResult, CriterionResult } from './harness';
import type { CheckContext } from './checks';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

class EvalsNodeFileSystem {
  async readFile(p: string): Promise<string> {
    return fs.readFile(p, 'utf8');
  }
  async writeFile(p: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
  }
  async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }
  async deleteFile(p: string): Promise<void> {
    await fs.unlink(p);
  }
  async listFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { recursive: true });
    return entries.map(e => path.join(dir, String(e)));
  }
}

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

export interface RunOptions {
  filter?: string;
  providers?: string[];
  report?: boolean;
}

export async function runAll(options: RunOptions = {}): Promise<void> {
  const nfs = new EvalsNodeFileSystem();
  const configPath = path.join(os.homedir(), '.ak-coder', 'config.json');
  const configManager = new ConfigManager(nfs as any, configPath);
  const config = await configManager.load();

  const activeProvider = config.activeProvider || 'ollama';
  const targetProviders = options.providers || [activeProvider];

  let cases = getRegistry();
  if (options.filter) {
    cases = cases.filter(c => c.name.toLowerCase().includes(options.filter!.toLowerCase()));
  }

  if (cases.length === 0) {
    console.log(`No evals matched filter: "${options.filter}"`);
    return;
  }

  const reports: {
    providerName: string;
    model: string;
    passRate: string;
    avgLatency: string;
    avgTokens: number;
    results: EvalResult[];
  }[] = [];

  let overallPass = true;

  for (const providerName of targetProviders) {
    const providerConfig = config.providers?.[providerName];
    if (!providerConfig) {
      console.warn(`Provider "${providerName}" is not configured in config.json. Skipping.`);
      continue;
    }

    const modelName = providerConfig.model || 'unknown';
    console.log(`\n\x1b[36m=== Running evals for provider: ${providerName} (${modelName}) ===\x1b[0m\n`);

    const llm = new OpenAICompatibleLLMService(
      providerConfig.apiKey || 'mock-key',
      providerConfig.baseUrl || 'https://api.openai.com/v1',
      providerConfig.model
    );

    let judgeLlm = llm;
    try {
      const localModel = await detectModel();
      judgeLlm = new OpenAICompatibleLLMService('mock-key', 'http://127.0.0.1:11434/v1', localModel);
    } catch {}
    const judge = new LLMJudge(judgeLlm);

    const results: EvalResult[] = [];
    for (const c of cases) {
      process.stdout.write(`  running: ${c.name} ... `);
      const result = await runEval(c, llm, judge);
      process.stdout.write(result.pass ? '\x1b[32mPASS\x1b[0m\n' : '\x1b[31mFAIL\x1b[0m\n');
      results.push(result);
    }

    renderTable(results);

    const providerPass = results.every(r => r.pass);
    if (!providerPass) overallPass = false;

    const totalPassed = results.filter(r => r.pass).length;
    const passRate = ((totalPassed / results.length) * 100).toFixed(0) + '%';
    const totalLatency = results.reduce((sum, r) => sum + r.latencyMs, 0);
    const avgLatency = ((totalLatency / results.length) / 1000).toFixed(1) + 's';
    const totalTokens = results.reduce((sum, r) => sum + r.totalTokens, 0);
    const avgTokens = Math.round(totalTokens / results.length);

    reports.push({
      providerName,
      model: modelName,
      passRate,
      avgLatency,
      avgTokens,
      results
    });
  }

  if (options.report) {
    const reportPath = path.join(__dirname, '..', 'eval_report.md');
    console.log(`\nGenerating comparative report at: ${reportPath}`);

    let md = `# LLM Provider Evaluation Report\n\n`;
    md += `Generated on: ${new Date().toISOString()}\n`;
    md += `Total cases run per provider: ${cases.length}\n\n`;
    md += `## Summary Comparison\n\n`;
    md += `| Provider | Model | Pass Rate | Avg Latency | Avg Tokens |\n`;
    md += `| --- | --- | --- | --- | --- |\n`;
    for (const rep of reports) {
      md += `| **${rep.providerName}** | \`${rep.model}\` | ${rep.passRate} | ${rep.avgLatency} | ${rep.avgTokens} |\n`;
    }
    md += `\n## Provider Details\n\n`;
    for (const rep of reports) {
      md += `### ${rep.providerName} (\`${rep.model}\`)\n`;
      md += `- **Pass Rate**: ${rep.passRate}\n`;
      md += `- **Avg Latency**: ${rep.avgLatency}\n`;
      md += `- **Avg Tokens**: ${rep.avgTokens}\n\n`;
      md += `| Case | Status | Latency | Tokens | Details / Failures |\n`;
      md += `| --- | --- | --- | --- | --- |\n`;
      for (const r of rep.results) {
        const status = r.error ? 'ERROR' : r.pass ? 'PASS' : 'FAIL';
        const latency = (r.latencyMs / 1000).toFixed(1) + 's';
        let details = '';
        if (r.error) {
          details = `Error: ${r.error}`;
        } else if (!r.pass) {
          const fails = r.criteria.filter(c => !c.pass).map(c => `✗ ${c.description}${c.reasoning ? ` (${c.reasoning})` : ''}`);
          details = fails.join('<br>');
        }
        md += `| ${r.name} | ${status === 'PASS' ? '✅ PASS' : '❌ ' + status} | ${latency} | ${r.totalTokens} | ${details} |\n`;
      }
      md += `\n`;
    }

    await fs.writeFile(reportPath, md, 'utf8');
    console.log(`Report successfully written!`);
  }

  if (!overallPass) {
    process.exit(1);
  }
}
