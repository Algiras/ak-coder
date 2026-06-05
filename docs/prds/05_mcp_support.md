# PRD-05: Model Context Protocol (MCP) Integration

## Overview
The Model Context Protocol (MCP) is an open standard allowing LLM clients to consume context and tools from modular, remote or local servers. `ak-coder` implements a client proxy that connects to third-party MCP servers, exposing their tools directly to the core agent loop.

## Requirements

### 1. MCP Client Host
*   **Standard Transport**: Supports Stdout/Stdin transport for local MCP servers (spawning them as child processes) and SSE (Server-Sent Events) for remote servers.
*   **Dynamic Tool Loading**: Queries the MCP server for available tools via `tools/list` on connection, and parses their JSON schemas.

### 2. Integration with Core Loop
*   **Seamless Binding**: Tools returned from the MCP server are registered into the `ak-coder` Dependency Registry and presented to the LLM agent model as standard available tools.
*   **Safe Execution**: Tool calls from the LLM that map to MCP commands are routed through the MCP client, and the results are returned directly to the agent context.
*   **Safety Confirmations**: Tool execution requests from MCP servers follow the same safety gate confirmation prompts as built-in tools.

### 3. Server Configuration
*   **Settings File**: Local MCP servers are configured in `.ak-coder/config.json` under the `mcpServers` object (similar to Cursor or Claude Desktop settings):
    ```json
    {
      "mcpServers": {
        "sqlite": {
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-sqlite", "--dbPath", "my.db"]
        }
      }
    }
    ```
