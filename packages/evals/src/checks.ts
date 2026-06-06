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

export function skillInvoked(name: string): StaticCriterion {
  return {
    type: 'static',
    description: `Skill "${name}" was invoked (Apply Skill message)`,
    check: ({ messages }) =>
      messages.some(m =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes(`Apply Skill "${name}"`)
      ),
  };
}

export interface GoldenOptions {
  checkToolCalls?: boolean;
  checkFiles?: boolean;
  checkResponse?: boolean;
}

export function golden(name: string, options: GoldenOptions = {}): StaticCriterion {
  return {
    type: 'static',
    description: `Golden snapshot matches "${name}"`,
    check: async (ctx) => {
      const fs = await import('fs/promises');
      const path = await import('path');

      const goldensDir = path.join(__dirname, '..', 'goldens');
      const goldenPath = path.join(goldensDir, `${name}.json`);

      // Extract details from current run
      const actualToolCalls = ctx.messages
        .filter(m => m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0)
        .flatMap(m => m.tool_calls!.map(tc => {
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments);
          } catch {}
          return {
            name: tc.function.name,
            arguments: parsedArgs
          };
        }));

      const actualFiles: Record<string, string> = {};
      for (const [filePath, content] of ctx.files.entries()) {
        actualFiles[filePath] = content;
      }

      const actualResponse = ctx.finalResponse;

      const runData = {
        toolCalls: actualToolCalls,
        files: actualFiles,
        finalResponse: actualResponse
      };

      const checkToolCalls = options.checkToolCalls ?? true;
      const checkFiles = options.checkFiles ?? true;
      const checkResponse = options.checkResponse ?? false;

      const updateGoldens = process.argv.includes('--update-goldens');

      let exists = false;
      try {
        await fs.access(goldenPath);
        exists = true;
      } catch {}

      if (!exists || updateGoldens) {
        // Create goldens directory if missing
        await fs.mkdir(goldensDir, { recursive: true });
        await fs.writeFile(goldenPath, JSON.stringify(runData, null, 2), 'utf8');
        console.log(`\n    \x1b[33m[golden] Created/Updated snapshot: packages/evals/goldens/${name}.json\x1b[0m`);
        return true;
      }

      // Read expected golden data
      try {
        const raw = await fs.readFile(goldenPath, 'utf8');
        const expected = JSON.parse(raw);

        // Compare tool calls
        if (checkToolCalls) {
          const expectedCalls = expected.toolCalls || [];
          if (actualToolCalls.length !== expectedCalls.length) {
            console.log(`\n    \x1b[31m[golden mismatch] Tool call count mismatch: expected ${expectedCalls.length}, got ${actualToolCalls.length}\x1b[0m`);
            return false;
          }
          for (let i = 0; i < expectedCalls.length; i++) {
            const exp = expectedCalls[i];
            const act = actualToolCalls[i];
            if (exp.name !== act.name) {
              console.log(`\n    \x1b[31m[golden mismatch] Tool name mismatch at index ${i}: expected "${exp.name}", got "${act.name}"\x1b[0m`);
              return false;
            }
            // Deep compare arguments
            const expJson = JSON.stringify(exp.arguments);
            const actJson = JSON.stringify(act.arguments);
            if (expJson !== actJson) {
              console.log(`\n    \x1b[31m[golden mismatch] Tool arguments mismatch at index ${i} for "${exp.name}":\n      expected: ${expJson}\n      got:      ${actJson}\x1b[0m`);
              return false;
            }
          }
        }

        // Compare files
        if (checkFiles) {
          const expectedFiles = expected.files || {};
          const expectedPaths = Object.keys(expectedFiles);
          
          for (const filePath of expectedPaths) {
            if (actualFiles[filePath] !== expectedFiles[filePath]) {
              console.log(`\n    \x1b[31m[golden mismatch] File content mismatch for "${filePath}"\x1b[0m`);
              return false;
            }
          }
        }

        // Compare final response
        if (checkResponse) {
          const expectedResponse = expected.finalResponse || '';
          if (actualResponse.trim() !== expectedResponse.trim()) {
            console.log(`\n    \x1b[31m[golden mismatch] Final response text mismatch:\n      expected: "${expectedResponse.trim()}"\n      got:      "${actualResponse.trim()}"\x1b[0m`);
            return false;
          }
        }

        return true;
      } catch (err) {
        console.log(`\n    \x1b[31m[golden error] Failed to process golden comparison: ${(err as Error).message}\x1b[0m`);
        return false;
      }
    }
  };
}

export const check = {
  toolCalled,
  toolCalledWith,
  fileContains,
  fileModified,
  responseContains,
  responseMatches,
  skillInvoked,
  golden,
};
