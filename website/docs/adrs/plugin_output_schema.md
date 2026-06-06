# ADR 07: Plugin Output Schema — Validation as Warning, Not Error

## Context
Plugin tools (both core and MCP-based) declare what structure their output takes via an optional `outputSchema`. This schema could theoretically be used to gate the LLM from receiving malformed tool results, but strict rejection would break workflows whenever a tool returns slightly different output than its schema declared — a common situation during plugin development or when wrapping third-party APIs.

## Decision
Output schema validation is **advisory only**:
1. **Declaration**: `CoreToolDefinition.outputSchema?: z.ZodTypeAny` (core tools) and `McpToolSchema.outputSchema?` (MCP/plugin tools) carry the schema. The `PluginSDK` serialises it to JSON Schema in `tools/list` and `initialize` responses so LLMs can reason about expected output shape.
2. **Runtime check**: After `executeSingleTool` returns, if `outputSchema` is present we run `schema.safeParse(output)`. On failure we call `logger.warn(...)` — the result is still passed to the LLM unchanged.
3. **No error thrown**: Validation failures never abort the tool call or return an error to the LLM. The warning lands in the logger for developer visibility without disrupting the running conversation.

## Consequences
* **Permissive by default**: Plugin authors can declare schemas incrementally; mismatches surface as log warnings rather than hard failures, reducing friction during development.
* **LLM-side benefit**: When the LLM receives tool schemas it can generate more accurate downstream calls or format its summaries to match the expected structure.
* **Auditability**: Warning logs let operators detect schema drift between plugin versions without requiring schema enforcement in production.
