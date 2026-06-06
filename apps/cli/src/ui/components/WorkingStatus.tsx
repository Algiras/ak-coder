import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface WorkingStatusProps {
  activityLabel?: string | null;
  subAgent?: {
    role: string;
    activityLabel?: string | null;
  } | null;
}

/** Pinned above the prompt so tool/sub-agent waits never look frozen. */
export function WorkingStatus({ activityLabel, subAgent }: WorkingStatusProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(timer);
  }, []);

  const spinner = FRAMES[frame];
  let label = activityLabel ?? 'Working…';
  if (subAgent) {
    const detail = subAgent.activityLabel || activityLabel || 'running';
    label = `Sub-agent · ${subAgent.role} · ${detail}`;
  }

  return (
    <Box marginX={1} marginBottom={1}>
      <Text color="cyan">{spinner} {label}</Text>
      <Text dimColor> · Ctrl+C to interrupt</Text>
    </Box>
  );
}
