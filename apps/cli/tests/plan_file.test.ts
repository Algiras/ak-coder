import { describe, it, expect, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { writePlanFile, listPlans, readPlan } from '../src/plan-file';

describe('plan-file utilities', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writePlanFile creates .ak-coder/plans/ dir and returns path', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ak-plan-test-'));
    const planPath = await writePlanFile(tmpDir, '# My Plan\nStep 1\nStep 2');
    expect(planPath).toInclude('.ak-coder/plans/');
    expect(planPath).toMatch(/plan-\d{15}-[0-9a-f]{4}\.md$/);
    const content = await fs.readFile(planPath, 'utf8');
    expect(content).toBe('# My Plan\nStep 1\nStep 2');
  });

  it('generates unique filenames across rapid successive calls', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ak-plan-unique-'));
    const paths = await Promise.all(
      Array.from({ length: 20 }, () => writePlanFile(tmpDir, 'x'))
    );
    const names = paths.map(p => path.basename(p));
    const unique = new Set(names);
    expect(unique.size).toBe(20);
  });

  it('listPlans returns files newest-first', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ak-plan-list-'));
    await writePlanFile(tmpDir, 'plan A');
    await new Promise(r => setTimeout(r, 10));
    await writePlanFile(tmpDir, 'plan B');
    const list = await listPlans(tmpDir);
    expect(list.length).toBe(2);
    expect(list[0] > list[1]).toBe(true); // newest first (lexicographic on timestamp)
  });

  it('listPlans returns empty array when plans dir absent', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ak-plan-empty-'));
    const list = await listPlans(tmpDir);
    expect(list).toEqual([]);
  });

  it('readPlan returns content of existing file', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ak-plan-read-'));
    const planPath = await writePlanFile(tmpDir, '# hello');
    const filename = path.basename(planPath);
    const content = await readPlan(tmpDir, filename);
    expect(content).toBe('# hello');
  });

  it('readPlan returns null for missing file', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ak-plan-miss-'));
    const content = await readPlan(tmpDir, 'plan-doesnotexist.md');
    expect(content).toBeNull();
  });
});
