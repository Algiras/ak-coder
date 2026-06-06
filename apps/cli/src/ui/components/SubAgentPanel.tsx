import React from 'react';
import { Box, Text } from 'ink';

export interface SubAgentPanelProps {
  role: string;
  depth: number;
  content: string;
  thinking: string;
  activityLabel?: string | null;
}

/** Contained panel for nested sub-agent streaming output. */
export function SubAgentPanel({ role, depth, content, thinking, activityLabel }: SubAgentPanelProps) {
  const thinkingText = thinking.trimEnd();
  const contentText = content.trimEnd();

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={1}>
      <Box borderStyle="double" borderColor="magenta" flexDirection="column" paddingX={1}>
        <Text color="magenta" bold>
          ◆ Sub-agent · {role}
          <Text dimColor> · depth {depth}</Text>
        </Text>

        {thinkingText ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="gray" bold>Reasoning</Text>
            <Text dimColor italic wrap="truncate-end">{thinkingText}</Text>
          </Box>
        ) : null}

        {contentText ? (
          <Box flexDirection="column" marginTop={thinkingText ? 1 : 0}>
            <Text color="cyan" bold>Output</Text>
            <Text wrap="truncate-end">{contentText}</Text>
          </Box>
        ) : null}

        {!thinkingText && !contentText && activityLabel ? (
          <Box marginTop={1}>
            <Text color="cyan">⠋ {activityLabel}</Text>
          </Box>
        ) : null}

        {!thinkingText && !contentText && !activityLabel ? (
          <Box marginTop={1}>
            <Text dimColor>Starting…</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
