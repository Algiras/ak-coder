# PRD-02: Plugin SDK & JSON-RPC Host

## Overview
To keep `ak-coder` extensible without bloat, new tools and capabilities are loaded as plugins. The Plugin SDK (`packages/sdk`) provides a TypeScript library for writing plugins, while the CLI core (`packages/core`) hosts these plugins as subprocesses communicating via JSON-RPC 2.0.

## Requirements

### 1. Process-Based Isolation
*   **Subprocess Execution**: The CLI host spawns each registered plugin as a standalone background subprocess.
*   **Language Agnostic**: Because communication is standard I/O (stdin/stdout), plugins can be written in any language (TypeScript/Node, Python, Go, Rust), though we provide a first-class TS SDK.
*   **Crash Safety**: If a plugin crashes or throws an exception, the host intercepts the error, reports the plugin failure, and continues the session without crashing the main CLI.

### 2. JSON-RPC 2.0 Protocol
*   Plugins and the host communicate by exchanging standard JSON-RPC 2.0 messages over stdout (plugin -> host) and stdin (host -> plugin).
*   Logs and debugging info from the plugin write to stderr to prevent corruption of the JSON-RPC stream.
*   Standard methods:
    *   `initialize` - Initial handshake containing plugin capabilities and exported tool schemas.
    *   `callTool` - Host requests plugin to run a specific tool with arguments.
    *   `cancelTool` - Host requests cancellation of an ongoing tool call.

### 3. Plugin SDK API
*   Provides helper classes to define tools and register schemas (using `zod` or JSON Schema).
*   Exposes wrapper functions to read from stdin, handle incoming RPC JSON strings, and print JSON-RPC payloads to stdout.
