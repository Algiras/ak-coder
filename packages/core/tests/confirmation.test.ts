import { describe, it, expect, beforeEach } from 'bun:test';
import { ConfirmationPolicy } from '../src/confirmation';
import { CommandSafetyGate } from '../src/safety';
import { MockFileSystem, MockTerminalIo } from '../src/mocks';

describe('ConfirmationPolicy', () => {
  let policy: ConfirmationPolicy;
  let nio: MockTerminalIo;

  beforeEach(() => {
    policy = new ConfirmationPolicy('default');
    nio = new MockTerminalIo();
  });

  it('default preset: writes=prompt, commands=prompt', () => {
    expect(policy.getConfig().writes).toBe('prompt');
    expect(policy.getConfig().commands).toBe('prompt');
    expect(policy.getPresetName()).toBe('default');
  });

  it('yolo preset: both auto-approve', async () => {
    policy.setPreset('yolo');
    expect(policy.getConfig().writes).toBe('auto-approve');
    expect(policy.getConfig().commands).toBe('auto-approve');
    expect(policy.getPresetName()).toBe('yolo');

    const r = await policy.check('write_file', { action: 'write_file', description: 'x', detail: '', path: 'f' }, nio);
    expect(r.approved).toBe(true);
    expect(nio.confirmResults).toHaveLength(0); // no interactive prompt
  });

  it('deny mode: write and command both denied without prompting', async () => {
    // Manually set a deny config
    policy.setPreset('default');
    (policy as any).config = { writes: 'deny', commands: 'deny' };

    const wr = await policy.check('write_file', { action: 'write_file', description: 'x', detail: '', path: 'f' }, nio);
    expect(wr.approved).toBe(false);

    const cr = await policy.check('bash', { action: 'bash', description: 'x', detail: '', command: 'rm -rf' }, nio);
    expect(cr.approved).toBe(false);

    expect(nio.confirmResults).toHaveLength(0); // never prompted
  });

  it('non-interactive (no terminalIo) with prompt mode → deny', async () => {
    const r = await policy.check('write_file', { action: 'write_file', description: 'x', detail: '', path: 'f' }, undefined);
    expect(r.approved).toBe(false);
  });

  it('interactive prompt: delegates to terminalIo.confirm', async () => {
    nio.confirmResults = [{ approved: true, applyToAll: false }];
    const r = await policy.check('write_file', { action: 'write_file', description: 'write', detail: '', path: 'f' }, nio);
    expect(r.approved).toBe(true);
  });

  it('approve-all stickiness: subsequent writes skip prompt', async () => {
    nio.confirmResults = [{ approved: true, applyToAll: true }];
    const r1 = await policy.check('write_file', { action: 'write_file', description: 'w1', detail: '', path: 'f' }, nio);
    expect(r1.approved).toBe(true);
    expect(r1.applyToAll).toBe(true);

    // Second write — no confirmResult seeded, but approve-all is latched
    const r2 = await policy.check('write_file', { action: 'write_file', description: 'w2', detail: '', path: 'f' }, nio);
    expect(r2.approved).toBe(true);
    expect(nio.confirmResults).toHaveLength(0); // not consumed
  });

  it('approve-all for commands does not affect writes', async () => {
    nio.confirmResults = [{ approved: true, applyToAll: true }];
    await policy.check('bash', { action: 'bash', description: 'cmd', detail: '', command: 'x' }, nio);

    // Write should still prompt (approve-all only set for commands)
    nio.confirmResults = [{ approved: false, applyToAll: false }];
    const wr = await policy.check('write_file', { action: 'write_file', description: 'w', detail: '', path: 'f' }, nio);
    expect(wr.approved).toBe(false);
  });

  it('resetSessionState clears approve-all latch', async () => {
    nio.confirmResults = [{ approved: true, applyToAll: true }];
    await policy.check('write_file', { action: 'write_file', description: 'w', detail: '', path: 'f' }, nio);

    policy.resetSessionState();

    // After reset, must prompt again
    nio.confirmResults = [{ approved: false, applyToAll: false }];
    const r = await policy.check('write_file', { action: 'write_file', description: 'w2', detail: '', path: 'f' }, nio);
    expect(r.approved).toBe(false);
  });

  it('safe command fast-path bypasses policy without prompting', async () => {
    const fs = new MockFileSystem();
    const gate = new CommandSafetyGate(fs, '/ws');
    await gate.loadPermissions();

    const r = await policy.check(
      'bash',
      { action: 'bash', description: 'list', detail: '', command: 'ls' },
      nio,
      gate
    );
    expect(r.approved).toBe(true);
    expect(nio.confirmResults).toHaveLength(0);
  });

  it('authorized unsafe command bypasses prompt', async () => {
    const fs = new MockFileSystem();
    const gate = new CommandSafetyGate(fs, '/ws');
    await gate.loadPermissions();
    await gate.authorizePattern('npm run build');

    const r = await policy.check(
      'bash',
      { action: 'bash', description: 'build', detail: '', command: 'npm run build' },
      nio,
      gate
    );
    expect(r.approved).toBe(true);
    expect(nio.confirmResults).toHaveLength(0);
  });

  it('confirm-writes preset: writes prompt, commands auto-approve', async () => {
    policy.setPreset('confirm-writes');
    expect(policy.getPresetName()).toBe('confirm-writes');

    const cmdRes = await policy.check('bash', { action: 'bash', description: 'c', detail: '', command: 'x' }, nio);
    expect(cmdRes.approved).toBe(true);

    nio.confirmResults = [{ approved: true, applyToAll: false }];
    const writeRes = await policy.check('write_file', { action: 'write_file', description: 'w', detail: '', path: 'f' }, nio);
    expect(writeRes.approved).toBe(true);
  });

  it('getPresetName returns null for custom config', () => {
    (policy as any).config = { writes: 'auto-approve', commands: 'deny' };
    expect(policy.getPresetName()).toBeNull();
  });

  it('plan preset: writes=deny, commands=deny', () => {
    policy.setPreset('plan');
    expect(policy.getConfig().writes).toBe('deny');
    expect(policy.getConfig().commands).toBe('deny');
    expect(policy.getPresetName()).toBe('plan');
  });

  it('plan preset: write_file denied without prompting terminalIo', async () => {
    policy.setPreset('plan');
    const r = await policy.check('write_file', { action: 'write_file', description: 'x', detail: '', path: 'f' }, nio);
    expect(r.approved).toBe(false);
    expect(nio.confirmResults).toHaveLength(0);
  });

  it('plan preset: execute_command denied without prompting terminalIo', async () => {
    policy.setPreset('plan');
    const r = await policy.check('bash', { action: 'bash', description: 'x', detail: '', command: 'rm -rf /' }, nio);
    expect(r.approved).toBe(false);
    expect(nio.confirmResults).toHaveLength(0);
  });

  it('plan preset: patch_file denied without prompting terminalIo', async () => {
    policy.setPreset('plan');
    const r = await policy.check('patch_file', { action: 'patch_file', description: 'x', detail: '', path: 'f' }, nio);
    expect(r.approved).toBe(false);
    expect(nio.confirmResults).toHaveLength(0);
  });
});
