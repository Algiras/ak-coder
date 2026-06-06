# PRD 07: Sub-agents Task Delegation

## Overview
Complex coding tasks (e.g. security audits, dependency checks, or rewriting large file trees) can exhaust an LLM's single-context window and execution budget. This document outlines requirements for spawning nested sub-agents with specialized roles to complete isolated tasks and report their findings back to the main agent loop.

## Requirements

### 1. Specialized Roles
- Allow configuring a sub-agent with a specialized system prompt role (e.g., "Security Auditor", "Test Runner").
- Pass a detailed prompt stating the sub-task objectives.

### 2. Context Scoping
- Allow passing a select list of files to pre-seed the sub-agent's context (`filesToInclude`), keeping context size minimal and relevant.

### 3. Execution & Safety Gates
- Recursively instantiate `AgentCore` with forwarding of adapters (filesystem, terminal IO, process runner).
- Limit the maximum recursion delegation depth (default: 3) to prevent infinite loops of agents calling agents.
- Expose a `delegate_task` tool to the parent agent.

## User Experience (UX)
- CLI outputs visual markers when spawning a sub-agent (e.g. `[Spawning Sub-Agent: "Auditor" at depth 1...]`) and when the sub-agent terminates.
