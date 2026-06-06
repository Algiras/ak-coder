import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from 'ink';
import {
  Spinner,
  ThemeProvider,
  type StatusLineSegment,
  type Message,
  type PermissionRequestProps,
  type PermissionAction,
  useStatusLine,
  FileEditPermissionContent,
  BashPermissionContent,
} from '@claude-code-kit/ui';
import {
  AgentCore,
  ConfirmationRequest,
  type SessionStore,
  type LLMService,
  type ProcessRunner,
  type ChatMessage,
  type StreamChunk,
} from '@ak-coder/core';
import { InkTerminalIo, InteractionEvent } from './InkTerminalIo';
import { COMMANDS, CommandContext } from '../repl';
import { AkCoderREPL } from './AkCoderREPL';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TurnStats { ms: number; outputTokens: number; inputTokens: number; cost: number }

type SelectInteraction = {
  message: string;
  choices: { name: string; value: unknown }[];
  onSelect: (v: unknown) => void;
};

export interface AppProps {
  core: AgentCore;
  nio: InkTerminalIo;
  workspaceRoot: string;
  store: SessionStore;
  llm: LLMService;
  npr: ProcessRunner;
  model?: string;
  assistantName?: string;
  systemName?: string;
}

// ── Permission modes cycle ─────────────────────────────────────────────────────

const MODES = ['default', 'plan'] as const;
type ConfirmationPreset = typeof MODES[number];

// ── Message helpers ───────────────────────────────────────────────────────────

let msgId = 0;
const mkMsg = (role: Message['role'], content: string): Message => ({
  id: String(++msgId),
  role,
  content,
  timestamp: Date.now(),
});

/** Convert core ChatMessages to UI messages, skipping tool call internals. */
function coreMessagesToUi(msgs: ChatMessage[]): Message[] {
  return msgs
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => mkMsg(
      m.role as 'user' | 'assistant',
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    ));
}

// ── Main App ──────────────────────────────────────────────────────────────────

function makeBanner(model: string, workspaceRoot: string): string {
  const wsParts = workspaceRoot.split('/');
  const workspaceName = wsParts[wsParts.length - 1] || workspaceRoot;
  return `\x1b[36m┌────────────────────────────────────────────────────────┐\x1b[0m\n` +
         `\x1b[36m│\x1b[0m  \x1b[1mak-coder\x1b[22m · \x1b[32m${workspaceName}\x1b[0m · \x1b[94m${model}\x1b[0m\n` +
         `\x1b[36m└────────────────────────────────────────────────────────┘\x1b[0m`;
}

export function App({ core, nio, workspaceRoot, store, llm, npr, model, assistantName = 'AKCoder', systemName = 'ak-coder' }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>(() => [
    mkMsg('system', makeBanner(model ?? 'unknown', workspaceRoot)),
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [streamingThinking, setStreamingThinking] = useState<string | null>(null);
  const [lastTurn, setLastTurn] = useState<TurnStats | undefined>();
  const [vimMode, setVimMode] = useState(false);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequestProps | undefined>();
  const [selectInteraction, setSelectInteraction] = useState<SelectInteraction | undefined>();
  const [activityLabel, setActivityLabel] = useState<string | null>(null);
  const streamRef = useRef('');
  const thinkingRef = useRef('');
  const historyRef = useRef<string[]>([]);
  const interruptedRef = useRef(false);
  // AbortController is a global in Bun/Node 18+ — type assertion for tsc
  const abortRef = useRef<{ abort(): void } | null>(null);

  const addMsg = useCallback((role: Message['role'], content: string) => {
    setMessages(prev => [...prev, mkMsg(role, content)]);
  }, []);

  // ── Status bar ──────────────────────────────────────────────────────────────

  const [spinnerVerbs, setSpinnerVerbs] = useState(['Thinking', 'Working', 'Processing']);

  const statusSegments = useStatusLine((): StatusLineSegment[] => {
    const { contextPct, mode } = core.getStatus();
    const currentModel = (llm as { defaultModel?: string }).defaultModel ?? model ?? '';
    const segs: StatusLineSegment[] = [];
    if (mode && mode !== 'default') segs.push({ content: mode.toUpperCase(), color: 'yellow' });
    segs.push({ content: `${contextPct}% ctx`, color: 'gray' });
    if (currentModel) segs.push({ content: currentModel, color: 'blue' });
    if (lastTurn) {
      const secs = (lastTurn.ms / 1000).toFixed(0);
      const ktok = lastTurn.outputTokens >= 1000
        ? `${(lastTurn.outputTokens / 1000).toFixed(1)}k`
        : String(lastTurn.outputTokens);
      segs.push({ content: `${secs}s  ↓${ktok}`, color: 'gray' });
      segs.push({ content: `$${lastTurn.cost.toFixed(5)}`, color: 'green' });
    }
    if (vimMode) segs.push({ content: 'VIM', color: 'magenta' });
    segs.push({ content: '', flex: true });
    segs.push({ content: 'Ctrl+C interrupt  Ctrl+R search  Shift+Tab mode', color: 'gray' });
    return segs;
  }, [lastTurn, vimMode, llm, model]);

  // ── Wire nio events ─────────────────────────────────────────────────────────

  useEffect(() => {
    const onLine = ({ text, error, role }: { text: string; error: boolean; role?: Message['role'] }) => {
      addMsg(error ? 'system' : (role ?? 'system'), text);
    };
    const onActivity = ({ label }: { label: string | null }) => {
      setActivityLabel(label);
    };
    nio.on('line', onLine);
    nio.on('activity', onActivity);
    return () => {
      nio.off('line', onLine);
      nio.off('activity', onActivity);
    };
  }, [nio, addMsg]);

  useEffect(() => {
    const onInteraction = (ev: InteractionEvent) => {
      if (ev.type === 'confirm') {
        const isWrite = ev.request.action === 'write_file' || ev.request.action === 'patch_file';
        const isCommand = ev.request.action === 'bash';
        let previewElement: React.ReactNode = undefined;

        if (isWrite && ev.request.path) {
          previewElement = React.createElement(FileEditPermissionContent, {
            filename: ev.request.path,
            diff: ev.request.detail
          });
        } else if (isCommand && ev.request.command) {
          previewElement = React.createElement(BashPermissionContent, {
            command: ev.request.command
          });
        }

        setPermissionRequest({
          toolName: ev.request.action,
          description: ev.request.description,
          details: ev.request.detail,
          preview: previewElement,
          onDecision: (action: PermissionAction) => {
            setPermissionRequest(undefined);
            nio.resolveConfirm({ approved: action === 'allow', applyToAll: false });
          },
        });
      } else if (ev.type === 'select') {
        setSelectInteraction({
          message: ev.message,
          choices: ev.choices,
          onSelect: (v) => {
            setSelectInteraction(undefined);
            nio.resolveSelect(v);
          },
        });
      } else if (ev.type === 'ask') {
        // For plain ask, show as a permission-style prompt
        setPermissionRequest({
          toolName: 'input',
          description: ev.question,
          onDecision: (action: PermissionAction) => {
            setPermissionRequest(undefined);
            nio.resolveAsk(action === 'allow' ? 'yes' : 'no');
          },
        });
      }
    };
    nio.on('interaction', onInteraction);
    return () => nio.off('interaction', onInteraction);
  }, [nio]);

  // ── Compaction spinner verbs ────────────────────────────────────────────────

  useEffect(() => {
    core.onCompactingStart = () => setSpinnerVerbs(['Compacting', 'Summarizing', 'Archiving']);
    core.onCompactingEnd  = () => {
      const { mode } = core.getStatus();
      setSpinnerVerbs(mode === 'plan' ? ['Planning', 'Researching', 'Drafting'] : ['Thinking', 'Working', 'Processing']);
    };
    return () => { core.onCompactingStart = undefined; core.onCompactingEnd = undefined; };
  }, [core]);

  // ── Core message runner ─────────────────────────────────────────────────────

  const runMessage = useCallback(async (text: string) => {
    const t0 = Date.now();
    interruptedRef.current = false;
    // AbortController is a Bun/Node global; cast through unknown for strict tsc
    const controller = new (globalThis as unknown as { AbortController: new () => { signal: unknown; abort(): void } }).AbortController();
    abortRef.current = controller;
    streamRef.current = '';
    thinkingRef.current = '';
    setStreaming('');
    setStreamingThinking(null);
    setActivityLabel(null);
    setIsLoading(true);

    try {
      const response = await core.processMessage(text, [], (chunk: StreamChunk) => {
        if (chunk.type === 'thinking') {
          thinkingRef.current += chunk.text;
          setStreamingThinking(thinkingRef.current);
        } else {
          streamRef.current += chunk.text;
          setStreaming(streamRef.current);
        }
      }, controller.signal as AbortSignal);

      setStreaming(null);
      setStreamingThinking(null);
      if (streamRef.current) addMsg('assistant', streamRef.current);
      streamRef.current = '';

      const stats: TurnStats = {
        ms: Date.now() - t0,
        outputTokens: response.outputTokens,
        inputTokens: response.inputTokens,
        cost: response.cost,
      };
      setLastTurn(stats);
      addMsg('system', `\x1b[90m↑${response.inputTokens}  ↓${response.outputTokens}  $${response.cost.toFixed(5)}  ${(stats.ms / 1000).toFixed(0)}s\x1b[0m`);
    } catch (e: unknown) {
      setStreaming(null);
      setStreamingThinking(null);
      const err = e as Error;
      if (err.name === 'AbortError') {
        if (!interruptedRef.current) {
          addMsg('system', '\x1b[33m⚠ Interrupted\x1b[0m');
        }
      } else {
        addMsg('system', `\x1b[31mError: ${err.message}\x1b[0m`);
      }
    } finally {
      abortRef.current = null;
      setActivityLabel(null);
      setStreamingThinking(null);
      setIsLoading(false);
    }
  }, [core, addMsg]);

  // ── Shell mode (! prefix) ───────────────────────────────────────────────────

  const ctx: CommandContext = { core, nio, workspaceRoot, store, llm, npr };

  const handleShellRun = useCallback(async (cmd: string) => {
    addMsg('user', `! ${cmd}`);
    setIsLoading(true);
    try {
      const result = await npr.run(cmd, { cwd: workspaceRoot });
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      addMsg('assistant', output || `(exit ${result.code})`);
    } catch (e) {
      addMsg('system', `\x1b[31mShell error: ${(e as Error).message}\x1b[0m`);
    } finally {
      setIsLoading(false);
    }
  }, [npr, workspaceRoot, addMsg]);

  // ── Submit handler ──────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text) return;

    historyRef.current = [text, ...historyRef.current.slice(0, 49)];
    addMsg('user', text);

    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ');
      const command = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
      const cmdArgs  = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1);

      // Built-in overrides inside App
      if (command === '/vim') {
        setVimMode(v => !v);
        addMsg('system', vimMode ? 'Vim mode OFF' : 'Vim mode ON');
        return;
      }
      if (command === '/compact') {
        setIsLoading(true);
        try {
          const before = core.getMessages().length;
          const result = await core.forceCompact();
          const saved = result.messagesBefore - result.messagesAfter;
          addMsg('system',
            `\x1b[36mCompacted: ${result.messagesBefore} → ${result.messagesAfter} messages (${saved} removed)\x1b[0m\n` +
            `\x1b[90mSummary: ${result.summaryLength} chars · context preserved\x1b[0m`
          );
          // Reload transcript to reflect the pruned message list
          const loaded = coreMessagesToUi(core.getMessages());
          setMessages([
            mkMsg('system', makeBanner(model ?? 'unknown', systemName)),
            ...loaded,
            mkMsg('system',
              `\x1b[36mCompacted: ${result.messagesBefore} → ${result.messagesAfter} messages (${saved} removed)\x1b[0m`
            ),
          ]);
        } finally {
          setIsLoading(false);
        }
        return;
      }
      if (command === '/btw') {
        if (!cmdArgs.trim()) { addMsg('system', 'Usage: /btw <question>'); return; }
        await runMessage(`(Side question — answer briefly without tools, no history impact): ${cmdArgs}`);
        return;
      }
      if (command === '/clear' || command === '/new') {
        setMessages([mkMsg('system', makeBanner(model ?? 'unknown', systemName))]);
        await core.startSession('session-' + Date.now());
        addMsg('system', 'New conversation started.');
        return;
      }

      const def = COMMANDS[command];
      if (def) {
        setIsLoading(true);
        nio.beginBatch();
        try {
          await def.handler(cmdArgs, ctx);
          // After /resume or /rewind, reload the transcript from what core now holds
          if (command === '/resume' || command === '/rewind') {
            const loaded = coreMessagesToUi(core.getMessages());
            if (loaded.length > 0) {
              setMessages([
                mkMsg('system', makeBanner(model ?? 'unknown', systemName)),
                ...loaded,
              ]);
            }
          }
        } finally { nio.endBatch(); setIsLoading(false); }
        return;
      }

      // /skills:name [args]  — direct skill invocation by namespaced path
      // also handles legacy /skillname [args] for backward compat
      const rawName = command.slice(1); // strip leading /
      const skillName = rawName.startsWith('skills:') ? rawName.slice('skills:'.length) : rawName;
      const skill = core.getSkills().find(s => s.name === skillName);
      if (skill) {
        await runMessage(
          cmdArgs.trim()
            ? `Apply Skill "${skill.name}" with arguments: "${cmdArgs}"\n\nInstructions:\n${skill.content}`
            : `Apply Skill "${skill.name}".\n\nInstructions:\n${skill.content}`
        );
        return;
      }

      // /skills with no name — list available skills
      if (rawName === 'skills') {
        const skills = core.getSkills();
        if (skills.length === 0) {
          addMsg('system', '\x1b[90mNo skills loaded. Add SKILL.md files to .ak-coder/skills/\x1b[0m');
        } else {
          addMsg('system', skills.map(s =>
            `\x1b[36m/skills:${s.name}\x1b[0m  ${s.description || ''}`.trimEnd()
          ).join('\n'));
        }
        return;
      }

      addMsg('system', `Unknown command: ${command}. Type /help.`);
      return;
    }

    await runMessage(text);
  }, [ctx, runMessage, vimMode, addMsg, core]);

  // ── Mode cycling (Shift+Tab) ────────────────────────────────────────────────

  const handleCycleMode = useCallback(() => {
    const { mode } = core.getStatus();
    const idx = MODES.indexOf(mode as ConfirmationPreset);
    const next = MODES[(idx + 1) % MODES.length];
    core.setConfirmationMode(next);
    setSpinnerVerbs(next === 'plan' ? ['Planning', 'Researching', 'Drafting'] : ['Thinking', 'Working', 'Processing']);
    addMsg('system', `Mode → ${next}`);
  }, [core, addMsg]);

  // ── Interrupt ───────────────────────────────────────────────────────────────

  const handleInterrupt = useCallback(() => {
    if (!abortRef.current) return;
    interruptedRef.current = true;
    abortRef.current.abort();
    setStreaming(null);
    setStreamingThinking(null);
    setActivityLabel(null);
    setIsLoading(false);
    addMsg('system', '\x1b[33m⚠ Interrupted\x1b[0m');
  }, [addMsg]);

  useEffect(() => {
    if (!isLoading) return;
    const onSigInt = () => handleInterrupt();
    process.on('SIGINT', onSigInt);
    return () => { process.off('SIGINT', onSigInt); };
  }, [isLoading, handleInterrupt]);

  // ── Exit ────────────────────────────────────────────────────────────────────

  const handleExit = useCallback(() => {
    core.stopMcpServers().finally(() => { exit(); process.exit(0); });
  }, [core, exit]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ThemeProvider initialState="dark">
    <AkCoderREPL
      messages={messages}
      isLoading={isLoading}
      streamingContent={streaming}
      streamingThinking={streamingThinking}
      statusSegments={statusSegments as StatusLineSegment[]}
      permissionRequest={permissionRequest}
      selectInteraction={selectInteraction}
      vimMode={vimMode}
      history={historyRef.current}
      activityLabel={activityLabel}
      spinner={
        <Spinner verbs={spinnerVerbs} color="cyan" showElapsed />
      }
      assistantName={assistantName}
      onSubmit={handleSubmit}
      onShellRun={handleShellRun}
      onInterrupt={handleInterrupt}
      onExit={handleExit}
      onCycleMode={handleCycleMode}
      onVimToggle={() => setVimMode(v => !v)}
    />
    </ThemeProvider>
  );
}
