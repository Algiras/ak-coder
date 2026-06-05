import React, { useState } from 'react';
import { Text } from 'ink';
import { FuzzyPicker } from '@claude-code-kit/ui';

interface HistorySearchProps {
  history: string[];
  onSelect: (item: string) => void;
  onCancel: () => void;
}

export function HistorySearch({ history, onSelect, onCancel }: HistorySearchProps) {
  const [query, setQuery] = useState('');
  return (
    <FuzzyPicker<string>
      title="History search"
      placeholder="Search previous prompts…"
      initialQuery={query}
      items={history}
      getKey={(s) => s}
      renderItem={(s, focused) => (
        <Text color={focused ? 'cyan' : undefined}>{s.slice(0, 80)}</Text>
      )}
      visibleCount={8}
      direction="up"
      onQueryChange={setQuery}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}
