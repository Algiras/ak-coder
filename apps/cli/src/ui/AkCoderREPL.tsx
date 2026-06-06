/**
 * AkCoderREPL — full-featured REPL built from @claude-code-kit/ui primitives.
 *
 * Features over bare REPL:
 *  - vimMode (toggle with /vim)
 *  - multiline input (Shift+Enter / Ctrl+J / backslash+Enter)
 *  - ! shell-mode prefix
 *  - Ctrl+C interrupt (AbortController)
 *  - Ctrl+R fuzzy history search (FuzzyPicker)
 *  - Ctrl+L full redraw
 *  - Shift+Tab to cycle permission modes
 *  - /btw side-question overlay
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useApp } from 'ink';
import { useInput } from '@claude-code-kit/ink-renderer';
import {
  MessageList,
  PromptInput,
  StatusLine,
  Divider,
  PermissionRequest,
  KeybindingSetup,
  StreamingMarkdown,
  type Message,
  type StatusLineSegment,
  type PermissionRequestProps,
} from '@claude-code-kit/ui';
import { HistorySearch } from './components/HistorySearch';
import { MessageRenderer } from './components/MessageRenderer';
import { SelectInteraction } from './components/SelectInteraction';
import { ThinkingPanel } from './components/ThinkingPanel';
import { SubAgentPanel } from './components/SubAgentPanel';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AkCoderREPLProps {
  messages: Message[];
  isLoading: boolean;
  streamingContent: string | null;
  streamingThinking?: string | null;
  subAgent?: {
    role: string;
    depth: number;
    content: string;
    thinking: string;
    activityLabel?: string | null;
  } | null;
  statusSegments: StatusLineSegment[];
  permissionRequest?: PermissionRequestProps;
  selectInteraction?: {
    message: string;
    choices: { name: string; value: unknown }[];
    onSelect: (v: unknown) => void;
  };
  vimMode: boolean;
  history: string[];
  activityLabel?: string | null;
  spinner?: React.ReactNode;
  assistantName?: string;
  onSubmit: (text: string) => Promise<void>;
  onShellRun: (cmd: string) => Promise<void>;
  onInterrupt: () => void;
  onExit: () => void;
  onCycleMode: () => void;
  onVimToggle: () => void;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AkCoderREPL({
  messages,
  isLoading,
  streamingContent,
  streamingThinking,
  subAgent,
  statusSegments,
  permissionRequest,
  selectInteraction,
  vimMode,
  history,
  activityLabel,
  spinner,
  assistantName = 'AKCoder',
  onSubmit,
  onShellRun,
  onInterrupt,
  onExit,
  onCycleMode,
  onVimToggle,
}: AkCoderREPLProps) {
  const { exit } = useApp();
  const [inputValue, setInputValue] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);

  // ── Message renderer ─────────────────────────────────────────────────────────

  const renderMessage = useCallback((message: Message): React.ReactNode => {
    return <MessageRenderer message={message} assistantName={assistantName} />;
  }, [assistantName]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c' && isLoading) {
        onInterrupt();
      }
    },
    { isActive: isLoading }
  );

  useInput(
    (input, key) => {
      // Ctrl+C: interrupt if loading, otherwise clear → exit
      if (key.ctrl && input === 'c') {
        if (isLoading) { onInterrupt(); return; }
        if (inputValue) { setInputValue(''); return; }
        onExit(); return;
      }

      // Ctrl+D: exit
      if (key.ctrl && input === 'd') { onExit(); return; }

      // Ctrl+L: full redraw — Ink re-renders on next tick
      if (key.ctrl && input === 'l') {
        process.stdout.write('\x1bc');
        return;
      }

      // Ctrl+R: history search
      if (key.ctrl && input === 'r') {
        if (history.length > 0) setHistoryOpen(true);
        return;
      }

      // Shift+Tab: cycle permission modes
      if (key.shift && key.tab) {
        onCycleMode();
        return;
      }
    },
    { isActive: !historyOpen && !permissionRequest && !selectInteraction }
  );

  // ── Submit handler ───────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;

      // Clear input immediately so the field feels responsive
      setInputValue('');
      setInputKey(k => k + 1);

      // ! shell mode
      if (text.startsWith('!')) {
        await onShellRun(text.slice(1).trim());
        return;
      }

      await onSubmit(text);
    },
    [onSubmit, onShellRun]
  );

  // Build command list for PromptInput autocomplete (slash commands)
  // The parent provides these via onSubmit; just surface names for typeahead
  const promptCommands = [
    { name: 'new', description: 'Start a new conversation' },
    { name: 'exit', description: 'Exit the REPL' },
    { name: 'help', description: 'Show available commands' },
    { name: 'context', description: 'View context info' },
    { name: 'history', description: 'List saved sessions' },
    { name: 'resume', description: 'Resume a session' },
    { name: 'rewind', description: 'Rewind conversation to a previous turn' },
    { name: 'fork', description: 'Fork current session' },
    { name: 'plan', description: 'Plan mode: /plan [on|off|list|<text>]' },
    { name: 'stats', description: 'Token and latency stats' },
    { name: 'budget', description: 'Cost summary' },
    { name: 'diff', description: 'Show git diff' },
    { name: 'ping', description: 'Check LLM latency' },
    { name: 'vim', description: 'Toggle vim input mode' },
    { name: 'compact', description: 'Compact conversation context' },
    { name: 'btw', description: 'Ask a side question (no history impact)' },
    { name: 'clear', description: 'Clear conversation history' },
    { name: 'model', description: 'Switch LLM model (lists Ollama models if no arg)' },
    { name: 'agent', description: 'Spawn a sub-agent: /agent <role> | <task>' },
    { name: 'settings', description: 'View or change settings: /settings [key] [value]' },
    { name: 'skills', description: 'List loaded skills or invoke: /skills:name [args]' },
    { name: 'providers', description: 'Manage LLM providers: /providers [select <name> | set <name> <key> <value>]' },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────

  const isBlocked = !!permissionRequest || !!selectInteraction || historyOpen;

  return (
    <KeybindingSetup>
      <Box flexDirection="column" flexGrow={1}>
        {/* Transcript */}
        <Box flexDirection="column" flexGrow={1}>
          <MessageList
            messages={messages}
            streamingContent={null}
            renderMessage={renderMessage}
          />
          {subAgent && (
            <SubAgentPanel
              role={subAgent.role}
              depth={subAgent.depth}
              content={subAgent.content}
              thinking={subAgent.thinking}
              activityLabel={subAgent.activityLabel}
            />
          )}
          {streamingThinking && !subAgent && (
            <ThinkingPanel text={streamingThinking} />
          )}
          {streamingContent && (
            <Box flexDirection="column" marginTop={messages.length > 0 || streamingThinking || subAgent ? 1 : 0}>
              <Box>
                <Text color="#DA7756">●</Text>
                <Text color="#DA7756" bold> {assistantName}</Text>
              </Box>
              <Box marginLeft={2} flexDirection="column">
                <StreamingMarkdown>{streamingContent}</StreamingMarkdown>
              </Box>
            </Box>
          )}
          {isLoading && !streamingContent && !streamingThinking && !subAgent && (
            <Box marginTop={messages.length > 0 ? 1 : 0} flexDirection="column">
              {activityLabel && (
                <Text color="cyan">  ⠋ {activityLabel}</Text>
              )}
              {spinner ?? <Text color="cyan">  thinking…</Text>}
            </Box>
          )}
        </Box>

        {/* Ctrl+R history search */}
        {historyOpen && (
          <HistorySearch
            history={history}
            onSelect={(item) => {
              setInputValue(item);
              setHistoryOpen(false);
            }}
            onCancel={() => setHistoryOpen(false)}
          />
        )}

        {/* Select interaction (from nio.selectMenu) */}
        {selectInteraction && (
          <SelectInteraction
            message={selectInteraction.message}
            choices={selectInteraction.choices}
            onSelect={selectInteraction.onSelect}
          />
        )}

        <Divider />

        {/* Permission request or prompt input */}
        {permissionRequest ? (
          <PermissionRequest
            toolName={permissionRequest.toolName}
            description={permissionRequest.description}
            details={permissionRequest.details}
            preview={permissionRequest.preview}
            onDecision={permissionRequest.onDecision}
          />
        ) : !historyOpen && !selectInteraction ? (
          <Box flexDirection="column">
            {vimMode && (
              <Text dimColor>  -- {isLoading ? 'WAIT' : 'INSERT'} --</Text>
            )}
            <PromptInput
              key={inputKey}
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              disabled={isLoading || isBlocked}
              commands={promptCommands}
              history={history}
              vimMode={vimMode}
              multiline={true}
            />
          </Box>
        ) : null}

        <Divider />
        <StatusLine segments={statusSegments} />
      </Box>
    </KeybindingSetup>
  );
}
