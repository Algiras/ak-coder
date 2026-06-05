# Milestone 8: Model Context Protocol (MCP)

## Objectives
Connect the `ak-coder` core to third-party MCP servers, dynamically registers their tool schemas, and routes tool calls to MCP subprocesses.

## Deliverables
- [ ] Implement client-side MCP transport wrapper supporting stdio processes.
- [ ] Query registered MCP servers for tools and map their schemas to OpenAI-compatible formats.
- [ ] Connect MCP tool calls to the safety prompt gates.
- [ ] Configure `mcpServers` settings loader in `config.json`.

## Verification
- Spin up a basic mock sqlite MCP server and assert that `ak-coder` successfully initializes connection, registers sqlite tools, and calls them.
