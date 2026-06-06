import React from 'react';
import { Box, Text } from 'ink';
import { Markdown, type Message } from '@claude-code-kit/ui';

interface MessageRendererProps {
  message: Message;
  assistantName: string;
}

export function MessageRenderer({ message, assistantName }: MessageRendererProps) {
  const COLORS: Record<string, string> = { assistant: '#DA7756', user: 'cyan', system: 'gray' };
  const ICONS: Record<string, string> = { assistant: '●', user: '❯', system: '✻' };
  const LABELS: Record<string, string> = { assistant: assistantName, user: 'You', system: 'System' };

  const color = COLORS[message.role] ?? 'white';
  const isSystem = message.role === 'system';
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={color} dimColor={isSystem}>{ICONS[message.role] ?? '·'}</Text>
        <Text color={color} dimColor={isSystem} bold={!isSystem}> {LABELS[message.role] ?? message.role}</Text>
      </Box>
      <Box marginLeft={2} flexDirection="column">
        {message.role === 'assistant' ? (
          <Markdown>{content}</Markdown>
        ) : (
          <Text dimColor={isSystem}>{content}</Text>
        )}
      </Box>
    </Box>
  );
}
