import React from 'react';
import { Box, Text } from 'ink';
import { Select } from '@claude-code-kit/ui';

interface SelectInteractionProps {
  message: string;
  choices: { name: string; value: unknown }[];
  onSelect: (v: unknown) => void;
}

export function SelectInteraction({ message, choices, onSelect }: SelectInteractionProps) {
  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="cyan">? {message}</Text>
      <Select
        options={choices.map((c, i) => ({
          label: c.name,
          value: String(i),
        }))}
        onChange={(val) => {
          const idx = parseInt(val, 10);
          onSelect(choices[idx]?.value);
        }}
        onCancel={() => onSelect(undefined)}
      />
    </Box>
  );
}
