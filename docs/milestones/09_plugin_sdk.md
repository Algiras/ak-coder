# Milestone 9: JSON-RPC Plugin SDK & Headless Agent Mode

## Objectives
Build the plugin SDK library, support loading plugins as JSON-RPC 2.0 subprocesses, and implement the headless stdio and piping CLI adapters.

## Deliverables
- [ ] Create `packages/sdk` and implement core tool registration decorators and JSON-RPC message serialization.
- [ ] Implement plugin subprocess host in `packages/core` that spawns plugins, reads their stdout/stderr streams, and exchange JSON-RPC calls.
- [ ] Implement headless mode (`ak-coder --stdio`) implementing a `StdioJsonRpcAdapter` for the CLI.
- [ ] Implement Unix piping mode (`PipedStreamAdapter`) running a single turn prompt on non-TTY inputs.

## Verification
- Test plugin subprocess lifecycle (spawn, handshake, error handling).
- Verify piping inputs (`echo "test" | ak-coder "prompt"`) returns correct output on stdout and logs/diagnostics on stderr.
- Test JSON-RPC calls over stdin/stdout using a test harness.
