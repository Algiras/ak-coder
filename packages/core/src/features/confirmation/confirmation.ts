import { ConfirmationAction, ConfirmationRequest, ConfirmationResult, TerminalIo } from '../../ports';
import { CommandSafetyGate } from '../safety/safety';

// ─── Policy Mode Types ──────────────────────────────────────────────────────

export type ConfirmationMode = 'prompt' | 'auto-approve' | 'deny';

export interface ConfirmationConfig {
  writes: ConfirmationMode;    // file writes & patches
  commands: ConfirmationMode;  // command execution
}

export type ConfirmationPreset = 'default' | 'yolo' | 'confirm-writes' | 'confirm-commands' | 'plan';

const PRESETS: Record<ConfirmationPreset, ConfirmationConfig> = {
  'default':          { writes: 'prompt',       commands: 'prompt' },
  'yolo':             { writes: 'auto-approve', commands: 'auto-approve' },
  'confirm-writes':   { writes: 'prompt',       commands: 'auto-approve' },
  'confirm-commands': { writes: 'auto-approve', commands: 'prompt' },
  'plan':             { writes: 'deny',         commands: 'deny' },
};

// ─── ConfirmationPolicy ─────────────────────────────────────────────────────

export class ConfirmationPolicy {
  private config: ConfirmationConfig;

  // Session-level "approve all" state per action category
  private approvedAllWrites = false;
  private approvedAllCommands = false;

  constructor(preset: ConfirmationPreset = 'default') {
    this.config = { ...PRESETS[preset] };
  }

  /**
   * Set the confirmation mode from a preset name.
   */
  setPreset(preset: ConfirmationPreset): void {
    this.config = { ...PRESETS[preset] };
    this.resetSessionState();
  }

  /**
   * Reset the session-level "approve all" state.
   */
  resetSessionState(): void {
    this.approvedAllWrites = false;
    this.approvedAllCommands = false;
  }

  /**
   * Get the current confirmation config.
   */
  getConfig(): Readonly<ConfirmationConfig> {
    return this.config;
  }

  /**
   * Get the current preset name (best-match), or null if custom.
   */
  getPresetName(): ConfirmationPreset | null {
    for (const [name, preset] of Object.entries(PRESETS)) {
      if (preset.writes === this.config.writes && preset.commands === this.config.commands) {
        return name as ConfirmationPreset;
      }
    }
    return null;
  }

  /**
   * Core entry point: check whether an action should proceed.
   *
   * For commands, the safetyGate is consulted first — safe commands bypass
   * the policy entirely. For writes, the policy is always consulted.
   *
   * Returns a ConfirmationResult. Callers should inspect `.approved` and
   * optionally `.edited` for modified content.
   */
  async check(
    action: ConfirmationAction,
    request: ConfirmationRequest,
    terminalIo: TerminalIo | undefined,
    safetyGate?: CommandSafetyGate
  ): Promise<ConfirmationResult> {
    const isWrite = action === 'write_file' || action === 'patch_file';
    const isCommand = action === 'bash';

    // ── Safe command fast-path ──────────────────────────────────────────
    if (isCommand && safetyGate && request.command) {
      const safety = safetyGate.classifyCommand(request.command);
      if (safety === 'safe') {
        return { approved: true, applyToAll: false };
      }
      // Also check if already authorized in safety gate
      if (safetyGate.isAuthorized(request.command)) {
        return { approved: true, applyToAll: false };
      }
    }

    // ── Session-level "approve all" check ───────────────────────────────
    if (isWrite && this.approvedAllWrites) {
      return { approved: true, applyToAll: true };
    }
    if (isCommand && this.approvedAllCommands) {
      return { approved: true, applyToAll: true };
    }

    // ── Policy mode resolution ──────────────────────────────────────────
    const mode = isWrite ? this.config.writes : this.config.commands;

    if (mode === 'auto-approve') {
      return { approved: true, applyToAll: false };
    }

    if (mode === 'deny') {
      return { approved: false, applyToAll: false };
    }

    // ── Interactive prompt ──────────────────────────────────────────────
    if (!terminalIo) {
      // Non-interactive mode with prompt policy → deny
      return { approved: false, applyToAll: false };
    }

    const result = await terminalIo.confirm(request);

    // Track "approve all" selections
    if (result.approved && result.applyToAll) {
      if (isWrite) {
        this.approvedAllWrites = true;
      }
      if (isCommand) {
        this.approvedAllCommands = true;
      }
    }

    return result;
  }
}
