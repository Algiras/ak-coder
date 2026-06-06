---
sidebar_position: 1
---

# System Flows

## Agent ReAct Loop

The core agent runs a ReAct (Reason + Act) loop: it sends messages to the LLM, which responds with either a final text answer or tool calls. Tool calls are executed and results fed back until the LLM produces a text response.

```mermaid
sequenceDiagram
    participant U as User
    participant A as AgentCore
    participant L as LLM
    participant T as Tool

    U->>A: processMessage(prompt)
    loop ReAct loop
        A->>L: chat(messages)
        alt LLM returns tool calls
            L-->>A: tool_calls[]
            loop for each tool call
                A->>T: handler(args)
                T-->>A: result
            end
            A->>A: append tool results to messages
        else LLM returns text
            L-->>A: text response
            A-->>U: response
        end
    end
```

## Tool Execution & Confirmation

Before a write tool or bash command executes, it passes through the confirmation policy and (for bash) the safety gate.

```mermaid
flowchart TD
    TC[Tool call received] --> RO{readOnlyHint?}
    RO -->|yes| PAR[Run in parallel\nwith other reads]
    RO -->|no| CP{Confirmation\nPolicy}
    CP -->|yolo| EXEC[Execute immediately]
    CP -->|plan| DENY[Reject — no mutations in plan mode]
    CP -->|default| SG{Safety Gate\nbash only}
    SG -->|safe command| EXEC
    SG -->|unsafe / write tool| CONFIRM[Ask user to confirm]
    CONFIRM -->|approved| EXEC
    CONFIRM -->|denied| DENY
    EXEC --> RES[Return result to LLM]
```

## Plugin & MCP Architecture

Plugins are local MCP servers. AgentCore spawns them as child processes and communicates over stdio JSON-RPC.

```mermaid
graph LR
    subgraph ak-coder process
        AC[AgentCore]
        MC[McpClient]
        TR[Tool Registry]
        AC --> TR
        AC --> MC
    end

    subgraph Plugin processes
        P1[plugin-a\nbun run index.ts]
        P2[plugin-b\nbun run index.ts]
    end

    MC -->|stdio JSON-RPC\ntools/list| P1
    MC -->|stdio JSON-RPC\ntools/call| P1
    MC -->|stdio JSON-RPC| P2
    TR -->|registered at startup| MC
```

## Session & Compaction

Sessions are stored to disk as JSON. When the context window nears its limit, AgentCore compacts older messages into a summary to preserve working memory.

```mermaid
flowchart LR
    subgraph Session Store
        H[history.json\non disk]
    end

    subgraph AgentCore
        M[messages\nin memory]
        C{Context\nnear limit?}
        K[Compaction:\nsummarize old turns]
    end

    M -->|persist| H
    H -->|restore on startup| M
    M --> C
    C -->|yes| K
    K --> M
    C -->|no| CONT[Continue]
```

## Hexagonal Architecture: Ports & Adapters

```mermaid
graph TB
    subgraph Core [packages/core — no Node.js imports]
        AG[AgentCore]
        FS_P[FileSystem port]
        LLM_P[LLMService port]
        PR_P[ProcessRunner port]
        TIO_P[TerminalIo port]
        AG --> FS_P & LLM_P & PR_P & TIO_P
    end

    subgraph CLI Adapters [apps/cli/src/adapters]
        NFS[NodeFileSystem]
        NTI[NodeTerminalIo]
        NPR[NodeProcessRunner]
        DPR[DockerProcessRunner]
    end

    subgraph Test Mocks [packages/core/src/mocks]
        MFS[MockFileSystem]
        MTI[MockTerminalIo]
        MLG[MockLogger]
    end

    NFS -.->|implements| FS_P
    NTI -.->|implements| TIO_P
    NPR & DPR -.->|implements| PR_P
    MFS -.->|implements| FS_P
    MTI -.->|implements| TIO_P
```
