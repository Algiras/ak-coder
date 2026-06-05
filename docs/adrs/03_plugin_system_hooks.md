# ADR 03: Plugin System & Lifecycle Hooks

## Context
Developers want to extend the capabilities of the agent harness with custom tools, specific prompt modifications, or custom safety guards. We need an extensible plugin system that works for both local JavaScript/TypeScript plugins and external, language-agnostic plugins running as subprocesses.

## Decision
We designed a Plugin SDK and Host system supporting lifecycle hooks:
1. **Lifecycle Hooks**: We expose four key hooks during agent execution:
   - `beforeLlmChat`: Intercepts and modifies the list of messages before querying the LLM.
   - `afterLlmChat`: Intercepts and inspects the LLM response before running tools.
   - `beforeToolCall`: Intercepts tool parameters before execution. Can block the tool or rewrite parameters.
   - `afterToolCall`: Intercepts tool execution outputs before they are fed back to the LLM.
2. **Local TS Plugins**: Loaded dynamically from `.ak-coder/plugins/*.ts` using Bun's import mechanism. They run in-process for maximum speed and simplicity.
3. **Subprocess Plugins**: Spawned as background processes communicating over stdio. They receive JSON-RPC 2.0 messages for hook notifications and requests.

## Consequences
* **Extensible Architecture**: Third-party developers can create integrations, prompt-injection filters, and custom validations.
* **Low Latency for Local Extensions**: Local TypeScript plugins run directly in the same JS thread, avoiding serialization overhead.
* **Language Agnosticism**: Subprocess JSON-RPC hooks allow writing plugins in Python, Go, or Rust while retaining hooks support.
