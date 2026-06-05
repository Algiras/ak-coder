import type { ChatMessage } from '@ak-coder/core';

export interface StaticCriterion {
  type: 'static';
  description: string;
  check(ctx: CheckContext): boolean | Promise<boolean>;
}

export interface CheckContext {
  messages: ChatMessage[];
  files: Map<string, string>;
  finalResponse: string;
}

export function toolCalled(name: string): StaticCriterion {
  return {
    type: 'static',
    description: `Tool "${name}" was called`,
    check: ({ messages }) =>
      messages.some(
        m => m.role === 'assistant' && m.tool_calls?.some(tc => tc.function.name === name)
      )
  };
}

export function toolCalledWith(name: string, argsSubset: Record<string, unknown>): StaticCriterion {
  return {
    type: 'static',
    description: `Tool "${name}" was called with ${JSON.stringify(argsSubset)}`,
    check: ({ messages }) =>
      messages.some(m => {
        if (m.role !== 'assistant') return false;
        return m.tool_calls?.some(tc => {
          if (tc.function.name !== name) return false;
          try {
            const args = JSON.parse(tc.function.arguments);
            return Object.entries(argsSubset).every(([k, v]) => args[k] === v);
          } catch {
            return false;
          }
        }) ?? false;
      })
  };
}

export function fileContains(path: string, substring: string): StaticCriterion {
  return {
    type: 'static',
    description: `File "${path}" contains "${substring}"`,
    check: ({ files }) => {
      const content = files.get(path);
      return content !== undefined && content.includes(substring);
    }
  };
}

export function fileModified(path: string): StaticCriterion {
  return {
    type: 'static',
    description: `File "${path}" was written during the run`,
    check: ({ messages }) =>
      messages.some(m => {
        if (m.role !== 'assistant') return false;
        return m.tool_calls?.some(tc =>
          (tc.function.name === 'write_file' || tc.function.name === 'str_replace') &&
          (() => { try { return JSON.parse(tc.function.arguments).path === path; } catch { return false; } })()
        ) ?? false;
      })
  };
}

export function responseContains(substring: string): StaticCriterion {
  return {
    type: 'static',
    description: `Final response contains "${substring}"`,
    check: ({ finalResponse }) => finalResponse.includes(substring)
  };
}

export function responseMatches(pattern: RegExp): StaticCriterion {
  return {
    type: 'static',
    description: `Final response matches ${pattern}`,
    check: ({ finalResponse }) => pattern.test(finalResponse)
  };
}

export const check = {
  toolCalled,
  toolCalledWith,
  fileContains,
  fileModified,
  responseContains,
  responseMatches,
};
