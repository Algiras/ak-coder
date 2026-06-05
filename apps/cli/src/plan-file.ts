import * as fs from 'fs/promises';
import * as path from 'path';
import { randomBytes } from 'crypto';

function generatePlanFilename(): string {
  const ts = new Date().toISOString().replace(/[^0-9T]/g, '').replace('T', '').slice(0, 15);
  const hex = randomBytes(2).toString('hex');
  return `plan-${ts}-${hex}.md`;
}

function planDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.ak-coder', 'plans');
}

export async function writePlanFile(workspaceRoot: string, content: string): Promise<string> {
  const dir = planDir(workspaceRoot);
  await fs.mkdir(dir, { recursive: true });
  const filename = generatePlanFilename();
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, content, 'utf8');
  return fullPath;
}

export async function listPlans(workspaceRoot: string): Promise<string[]> {
  const dir = planDir(workspaceRoot);
  try {
    const entries = await fs.readdir(dir);
    return entries.filter(e => e.endsWith('.md')).sort().reverse(); // newest first
  } catch {
    return [];
  }
}

export async function readPlan(workspaceRoot: string, filename: string): Promise<string | null> {
  const fullPath = path.join(planDir(workspaceRoot), filename);
  try {
    return await fs.readFile(fullPath, 'utf8');
  } catch {
    return null;
  }
}
