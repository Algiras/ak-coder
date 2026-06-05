import { z } from 'zod';
import { CoreToolDefinition, ToolContext } from './types';

export const webFetchTool = (ctx: ToolContext): CoreToolDefinition => ({
  name: 'web_fetch',
  annotations: { title: 'Web Fetch', readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  description: 'Fetch the text content of a URL. Returns the page body (HTML stripped to text). Use for reading documentation, READMEs, npm package pages, GitHub issues, etc.',
  schema: z.object({
    url: z.string().describe('The URL to fetch'),
    maxLength: z.number().optional().describe('Maximum characters to return (default 8000)')
  }),
  handler: async (args) => {
    try {
      const response = await fetch(args.url, {
        headers: { 'User-Agent': 'ak-coder/0.1.0' },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        return `HTTP ${response.status} ${response.statusText} for ${args.url}`;
      }
      const contentType = response.headers.get('content-type') || '';
      let text = await response.text();
      if (contentType.includes('text/html')) {
        text = text
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }
      const max = args.maxLength ?? 8000;
      return text.length > max ? text.slice(0, max) + `\n\n[truncated — ${text.length} total chars]` : text;
    } catch (e) {
      return `Error fetching ${args.url}: ${(e as Error).message}`;
    }
  }
});
