import React from 'react';
import { Box, Text } from 'ink';

export interface ThinkingPanelProps {
  text: string;
}

/** Distinct styling for model reasoning — separate from the main answer stream. */
export function ThinkingPanel({ text }: ThinkingPanelProps) {
  const trimmed = text.trimEnd();
  if (!trimmed) return null;

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={1}>
      <Box borderStyle="round" borderColor="magenta" flexDirection="column" paddingX={1}>
        <Text color="magenta" bold>◈ Thinking</Text>
        <Box marginTop={0} flexDirection="column">
          <Text dimColor italic wrap="truncate-end">{trimmed}</Text>
        </Box>
      </Box>
    </Box>
  );
}
