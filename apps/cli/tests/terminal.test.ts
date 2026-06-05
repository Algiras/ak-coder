import { describe, it, expect } from 'bun:test';
import { NodeFileSystem } from '../src/adapters/filesystem';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('NodeFileSystem Adapter', () => {
  const testDir = path.join(__dirname, 'temp_test_dir');
  const testFile = path.join(testDir, 'hello.txt');

  it('should write, read, check existence, and delete files', async () => {
    const nfs = new NodeFileSystem();

    // Write file
    await nfs.writeFile(testFile, 'hello bun filesystem');
    expect(await nfs.exists(testFile)).toBe(true);

    // Read file
    const content = await nfs.readFile(testFile);
    expect(content).toBe('hello bun filesystem');

    // List files
    const files = await nfs.listFiles(testDir);
    expect(files).toContain(testFile);

    // Delete file
    await nfs.deleteFile(testFile);
    expect(await nfs.exists(testFile)).toBe(false);

    // Cleanup directory
    await fs.rm(testDir, { recursive: true, force: true });
  });
});
