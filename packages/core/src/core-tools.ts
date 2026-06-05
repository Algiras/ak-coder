import { CoreToolDefinition, ToolContext, ChildAgent } from './features/tools/types';
import { readFileTool } from './features/tools/read_file';
import { writeFileTool } from './features/tools/write_file';
import { patchFileTool } from './features/tools/patch_file';
import { strReplaceTool } from './features/tools/str_replace';
import { bashTool } from './features/tools/bash';
import { listDirectoryTool } from './features/tools/list_directory';
import { grepSearchTool } from './features/tools/grep_search';
import { globTool } from './features/tools/glob';
import { indexWorkspaceTool } from './features/tools/index_workspace';
import { semanticSearchTool } from './features/tools/semantic_search';
import { webFetchTool } from './features/tools/web_fetch';
import { delegateTaskTool } from './features/tools/delegate_task';

export type { CoreToolDefinition, ToolContext, ChildAgent };

export function registerCoreTools(ctx: ToolContext): Map<string, CoreToolDefinition> {
  const tools = new Map<string, CoreToolDefinition>();

  tools.set('read_file', readFileTool(ctx));
  tools.set('write_file', writeFileTool(ctx));
  tools.set('patch_file', patchFileTool(ctx));
  tools.set('str_replace', strReplaceTool(ctx));
  tools.set('bash', bashTool(ctx));
  tools.set('list_directory', listDirectoryTool(ctx));
  tools.set('grep_search', grepSearchTool(ctx));
  tools.set('glob', globTool(ctx));
  tools.set('index_workspace', indexWorkspaceTool(ctx));
  tools.set('semantic_search', semanticSearchTool(ctx));
  tools.set('web_fetch', webFetchTool(ctx));
  tools.set('delegate_task', delegateTaskTool(ctx));

  return tools;
}
