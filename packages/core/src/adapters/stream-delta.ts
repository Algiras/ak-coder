/** Merge streaming deltas that may be incremental or cumulative (full prefix so far). */
export function appendStreamDelta(accumulated: string, incoming: string): { value: string; delta: string } {
  if (!incoming) return { value: accumulated, delta: '' };
  if (!accumulated) return { value: incoming, delta: incoming };
  if (incoming.startsWith(accumulated)) {
    return { value: incoming, delta: incoming.slice(accumulated.length) };
  }
  if (accumulated.startsWith(incoming)) {
    return { value: accumulated, delta: '' };
  }
  return { value: accumulated + incoming, delta: incoming };
}
