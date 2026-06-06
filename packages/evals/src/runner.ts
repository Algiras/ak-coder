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
  runs?: number;
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

  const numRuns = options.runs ?? 1;

  const reports: {
    providerName: string;
    model: string;
    passRate: string;
    avgLatency: string;
    avgTokens: number;
    results: EvalResult[];
    stability: Map<string, { passes: number; runs: number }>;
  }[] = [];

  let overallPass = true;

  for (const providerName of targetProviders) {
    const providerConfig = config.providers?.[providerName];
    if (!providerConfig) {
      console.warn(`Provider "${providerName}" is not configured in config.json. Skipping.`);
      continue;
    }

    const modelName = providerConfig.model || 'unknown';
    const runsLabel = numRuns > 1 ? ` x${numRuns} runs` : '';
    console.log(`\n\x1b[36m=== Running evals for provider: ${providerName} (${modelName})${runsLabel} ===\x1b[0m\n`);

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

    // stability[caseName] = { passes, runs }
    const stability = new Map<string, { passes: number; runs: number }>();
    const lastResults = new Map<string, EvalResult>();

    for (let run = 1; run <= numRuns; run++) {
      if (numRuns > 1) console.log(`  \x1b[90m[run ${run}/${numRuns}]\x1b[0m`);
      for (const c of cases) {
        process.stdout.write(`  running: ${c.name} ... `);
        const result = await runEval(c, llm, judge);
        process.stdout.write(result.pass ? '\x1b[32mPASS\x1b[0m\n' : '\x1b[31mFAIL\x1b[0m\n');
        // track stability
        const prev = stability.get(c.name) ?? { passes: 0, runs: 0 };
        stability.set(c.name, { passes: prev.passes + (result.pass ? 1 : 0), runs: prev.runs + 1 });
        lastResults.set(c.name, result);
      }
    }

    const results = cases.map(c => lastResults.get(c.name)!);
    renderTable(results);

    if (numRuns > 1) {
      console.log('\n\x1b[33mStability (passes/runs):\x1b[0m');
      for (const c of cases) {
        const s = stability.get(c.name)!;
        const stable = s.passes === s.runs;
        const label = stable ? '\x1b[32mstable\x1b[0m' : s.passes === 0 ? '\x1b[31mfailing\x1b[0m' : '\x1b[33mFLAKY\x1b[0m';
        console.log(`  ${s.passes}/${s.runs}  ${label}  ${c.name}`);
      }
    }

    const providerPass = results.every(r => r.pass) && [...stability.values()].every(s => s.passes === s.runs);
    if (!providerPass) overallPass = false;

    const totalPassed = [...stability.values()].filter(s => s.passes === s.runs).length;
    const passRate = ((totalPassed / cases.length) * 100).toFixed(0) + '%';
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
      results,
      stability,
    });
  }

  // Print binary score matrix to terminal
  console.log('\n\x1b[36m=== Evaluation Binary Score Matrix ===\x1b[0m\n');
  const providerNames = reports.map(r => r.providerName);
  const colWidth = 20;
  const nameWidth = 50;
  const header = `  ${'Case Name'.padEnd(nameWidth)} | ` + providerNames.map(name => name.padEnd(colWidth)).join(' | ');
  console.log(header);
  console.log('─'.repeat(header.length));
  for (const c of cases) {
    const cols = providerNames.map(name => {
      const rep = reports.find(r => r.providerName === name);
      const s = rep?.stability.get(c.name);
      let score: string;
      if (!s) { score = '?'; }
      else if (s.passes === s.runs) { score = numRuns > 1 ? `1 (${s.passes}/${s.runs})` : '1'; }
      else if (s.passes === 0) { score = numRuns > 1 ? `0 (${s.passes}/${s.runs})` : '0'; }
      else { score = `~ (${s.passes}/${s.runs})`; }
      return score.padEnd(colWidth);
    });
    console.log(`  ${c.name.slice(0, nameWidth).padEnd(nameWidth)} | ` + cols.join(' | '));
  }
  console.log('─'.repeat(header.length) + '\n');

  if (options.report) {
    const evalsRoot = path.join(__dirname, '..');
    const runId = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const reportsDir = path.join(evalsRoot, 'reports', runId);
    const jsonlPath = path.join(evalsRoot, 'eval_results.jsonl');

    // ── 1. Append JSONL records (one line per case × run × provider) ──────────
    const jsonlLines: string[] = [];
    for (const rep of reports) {
      for (const r of rep.results) {
        const s = rep.stability.get(r.name);
        for (let runIdx = 0; runIdx < numRuns; runIdx++) {
          // We only have the last-run result in r; write stability metadata
          jsonlLines.push(JSON.stringify({
            runId,
            provider: rep.providerName,
            model: rep.model,
            totalRuns: numRuns,
            case: r.name,
            // pass/score reflect stability across all runs
            pass: s ? s.passes === s.runs : r.pass,
            score: s && s.passes === s.runs ? 1 : s && s.passes > 0 ? 0.5 : 0,
            stability: s ? { passes: s.passes, runs: s.runs, flaky: s.passes > 0 && s.passes < s.runs } : null,
            latencySeconds: parseFloat((r.latencyMs / 1000).toFixed(1)),
            totalTokens: r.totalTokens,
            error: r.error ?? null,
            criteria: r.criteria.map(c => ({
              type: c.type,
              description: c.description,
              pass: c.pass,
              reasoning: c.reasoning ?? null,
            })),
          }));
        }
      }
    }
    await fs.appendFile(jsonlPath, jsonlLines.join('\n') + '\n', 'utf8');
    console.log(`\nAppended ${jsonlLines.length} JSONL records to: ${jsonlPath}`);

    // ── 2. Write reports/<runId>/summary.md ───────────────────────────────────
    await fs.mkdir(reportsDir, { recursive: true });
    const casesDir = path.join(reportsDir, 'cases');
    await fs.mkdir(casesDir, { recursive: true });

    let summary = `# Eval Report — ${runId}\n\n`;
    summary += `Providers: ${reports.map(r => `\`${r.providerName}\` (${r.model})`).join(', ')}  \n`;
    summary += `Cases: ${cases.length}  |  Runs per case: ${numRuns}\n\n`;
    summary += `## Summary\n\n`;
    summary += `| Provider | Model | Stable Pass Rate | Avg Latency | Avg Tokens |\n`;
    summary += `| --- | --- | --- | --- | --- |\n`;
    for (const rep of reports) {
      summary += `| **${rep.providerName}** | \`${rep.model}\` | ${rep.passRate} | ${rep.avgLatency} | ${rep.avgTokens} |\n`;
    }
    summary += `\n## Binary Score Matrix\n\n`;
    summary += `> \`1\` = stable pass · \`0\` = failing · \`⚠️\` = flaky (passes/runs)\n\n`;
    summary += `| Case | ` + reports.map(rep => `${rep.providerName}`).join(' | ') + ` |\n`;
    summary += `| --- | ` + reports.map(() => `---`).join(' | ') + ` |\n`;
    for (const c of cases) {
      const slug = c.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      const rowScores = reports.map(rep => {
        const s = rep.stability.get(c.name);
        if (!s) return '?';
        if (s.passes === s.runs) return numRuns > 1 ? `**1** (${s.passes}/${s.runs})` : '**1**';
        if (s.passes === 0) return numRuns > 1 ? `0 (${s.passes}/${s.runs})` : '0';
        return `⚠️ (${s.passes}/${s.runs})`;
      });
      summary += `| [${c.name}](cases/${slug}.md) | ` + rowScores.join(' | ') + ` |\n`;
    }
    await fs.writeFile(path.join(reportsDir, 'summary.md'), summary, 'utf8');

    // ── 3. Write reports/<runId>/cases/<slug>.md per eval case ────────────────
    for (const c of cases) {
      const slug = c.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      let md = `# ${c.name}\n\n`;
      md += `Run ID: \`${runId}\`  |  Runs: ${numRuns}\n\n`;
      for (const rep of reports) {
        const s = rep.stability.get(c.name);
        const r = rep.results.find(r => r.name === c.name);
        const stableLabel = !s ? '?' : s.passes === s.runs ? '✅ stable' : s.passes === 0 ? '❌ failing' : '⚠️ flaky';
        md += `## ${rep.providerName} (\`${rep.model}\`)\n\n`;
        md += `**Stability**: ${stableLabel}  |  **${s?.passes ?? 0}/${s?.runs ?? 0}** runs passed\n\n`;
        if (r) {
          md += `| Criterion | Type | Pass | Reasoning |\n`;
          md += `| --- | --- | --- | --- |\n`;
          for (const cr of r.criteria) {
            md += `| ${cr.description} | ${cr.type} | ${cr.pass ? '✅' : '❌'} | ${cr.reasoning ?? ''} |\n`;
          }
        }
        md += '\n';
      }
      await fs.writeFile(path.join(casesDir, `${slug}.md`), md, 'utf8');
    }

    console.log(`Reports written to: ${reportsDir}/`);
    console.log(`  summary.md + ${cases.length} case files in cases/`);
  }

  if (!overallPass) {
    process.exit(1);
  }
}

