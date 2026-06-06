---
sidebar_position: 1
---

# System Flows

## System Overview

ak-coder splits into a **CLI shell** (Ink UI, slash routing, tab completion) and a **hexagonal core** (agent loop, tools, skills, sessions, MCP). The core never imports Node.js — all I/O goes through ports implemented in `apps/cli/src/adapters`.

```mermaid
graph TB
    subgraph CLI ["apps/cli"]
        Ink["Ink UI · App.tsx"]
        Router["repl.ts · slash router"]
        Slash["slash-commands.ts"]
        Debug["debug.ts · ui.trace.log"]
        Ink --> Router
        Ink --> Slash
        Ink -.->|when --debug| Debug
    end

    subgraph Core ["packages/core · AgentCore"]
        AC[AgentCore]
        SM[SkillsManager]
        TR[Tool Registry]
        SS[SessionStore]
        MC[McpClient]
        AC --> SM & TR & SS & MC
    end

    LLM[(LLM provider)]
    WS[(Workspace · SKILL.md + source)]
    Hist["~/.ak-coder/history/workspaces/"]
    Plugins[Plugin MCP processes]

    Ink -->|processMessage + streamCallback| AC
    Router -->|slash / skill / prompt| AC
    AC -->|chat · stream| LLM
    AC -->|file + bash tools| WS
    SM -->|scan · reload| WS
    SS -->|JSONL persist| Hist
    MC -->|stdio JSON-RPC| Plugins
    TR --> MC
```

| Layer | Responsibility |
|-------|----------------|
| **Ink UI** | Render messages, stream tokens, permission prompts, working status |
| **Slash router** | Dispatch `/commands`, `/skills:<name>`, `!shell`, or agent prompts |
| **AgentCore** | ReAct loop, confirmation policy, compaction, child agents |
| **SkillsManager** | Discover `SKILL.md`, inject into system prompt, support reload |
| **SessionStore** | Workspace-scoped JSONL history, fork/resume |

---

## Agent ReAct Loop

The core agent runs a ReAct (Reason + Act) loop: it sends messages to the LLM, which responds with either a final text answer or tool calls. Tool calls are executed and results fed back until the LLM produces a text response.

Each turn, loaded skills are appended to the **system prompt** under an `Available Skills` section before the first LLM call.

```mermaid
sequenceDiagram
    participant U as User / REPL
    participant A as AgentCore
    participant S as SkillsManager
    participant L as LLM
    participant T as Tool

    U->>A: processMessage(prompt)
    A->>S: getSkills()
    S-->>A: name · description · body
    A->>A: assemble system prompt<br/>+ Available Skills section

    loop ReAct loop
        A->>L: chat(messages)
        alt LLM returns tool calls
            L-->>A: tool_calls[]
            loop for each tool call
                A->>T: handler(args)
                Note over T: confirmation policy<br/>parallel if readOnlyHint
                T-->>A: result
                opt path ends with SKILL.md
                    T->>A: reloadSkills()
                    A->>S: rescan workspace
                end
            end
            A->>A: append tool results to messages
        else LLM returns text
            L-->>A: text response
            A-->>U: response (+ stream chunks)
        end
    end
```

---

## REPL Input Routing

The Ink UI and legacy readline REPL share the same routing rules. Slash commands never reach the LLM unless they inject a skill or forward a prompt.

```mermaid
flowchart TD
    IN[User input] --> BANG{starts with ! ?}
    BANG -->|yes| SHELL[Shell mode<br/>run command locally]
    BANG -->|no| SLASH{starts with / ?}
    SLASH -->|no| AGENT[core.processMessage]
    SLASH -->|yes| CMD{in COMMANDS map?}
    CMD -->|yes| HANDLER[Command handler<br/>/history · /skills reload · /plan …]
    CMD -->|no| NS{namespace /skills:name<br/>or legacy /name ?}
    NS -->|skill found| INJECT["Apply Skill message<br/>→ processMessage"]
    NS -->|not found| ERR[Unknown command error]

    HANDLER --> RELOAD[/skills reload/]
    RELOAD --> SM[core.reloadSkills]
    SM --> COMP[Refresh tab completion list]
```

---

## Tool Execution & Confirmation

Before a write tool or bash command executes, it passes through the confirmation policy and (for bash) the safety gate.

```mermaid
flowchart TD
    TC[Tool call received] --> RO{readOnlyHint?}
    RO -->|yes| PAR[Run in parallel<br/>with other reads]
    RO -->|no| CP{Confirmation<br/>Policy}
    CP -->|auto-approve| EXEC[Execute immediately]
    CP -->|plan| DENY[Reject — no mutations in plan mode]
    CP -->|default| SG{Safety Gate<br/>bash only}
    SG -->|safe command| EXEC
    SG -->|unsafe / write tool| CONFIRM[Ask user to confirm]
    CONFIRM -->|approved| EXEC
    CONFIRM -->|denied| DENY
    EXEC --> RES[Return result to LLM]
    EXEC --> SK{path ends with<br/>SKILL.md ?}
    SK -->|yes| RL[reloadSkills]
    SK -->|no| RES
    RL --> RES
```

---

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
        P1[plugin-a<br/>bun run index.ts]
        P2[plugin-b<br/>bun run index.ts]
    end

    MC -->|stdio JSON-RPC<br/>tools/list| P1
    MC -->|stdio JSON-RPC<br/>tools/call| P1
    MC -->|stdio JSON-RPC| P2
    TR -->|registered at startup| MC
```

Lifecycle hooks (`beforeWriteFile`, `afterToolCall`, …) run inside the core tool handlers — see [ADR 03](/docs/adrs/plugin_system_hooks).

---

## Session & Compaction

Sessions are stored to disk as JSONL files under `~/.ak-coder/history/workspaces/<folder>-<hash>/`, scoped to the **current working directory** at startup. `/history` and `/resume` only show sessions for the folder you launched ak-coder from — not a global list across all projects.

When the context window nears its limit, AgentCore compacts older messages into a summary to preserve working memory.

Read-only tools with `readOnlyHint: true` run in parallel when batched — see [Tool Annotations](/docs/tools/annotations).

```mermaid
flowchart TB
    CWD[cwd at CLI startup] --> KEY["workspaceHistoryKey()<br/>basename + sha256 slice"]
    KEY --> DIR["~/.ak-coder/history/workspaces/<br/>my-project-a1b2c3d4e5f6/"]
    DIR --> S1[session-123.jsonl]
    DIR --> S2[session-456.jsonl]

    subgraph AgentCore
        M[messages in memory]
        C{Context near limit?}
        K[Compaction: summarize old turns]
    end

    M -->|persist each turn| DIR
    DIR -->|/resume restores| M
    M --> C
    C -->|yes| K
    K --> M
    C -->|no| CONT[Continue]
```

Legacy flat sessions in `~/.ak-coder/history/*.jsonl` (pre-0.1.8) are not listed when using workspace-scoped storage. Forking creates a new JSONL branch — see [ADR 06](/docs/adrs/session_forking).

---

## Skills: Discovery, Reload & Invocation

Skills are `SKILL.md` files discovered under the workspace root. They are injected into the system prompt each turn and invoked via `/skills:<name>`.

```mermaid
flowchart TD
    START[CLI startup · /new · /skills reload] --> SCAN[SkillsManager.loadSkills cwd]
    SCAN --> WALK[Recursive walk workspace]
    WALK --> PARSE[Parse YAML frontmatter<br/>name · description · body]
    PARSE --> PROMPT[Inject into system prompt<br/>Available Skills section]
    PARSE --> COMPLETE[Tab completion entries<br/>/skills:name]

    WRITE[write_file · patch_file · str_replace<br/>on path ending SKILL.md] --> RELOAD[ToolContext.reloadSkills]
    RELOAD --> SCAN

    USER["/skills:review args"] --> INJECT[Apply Skill user message<br/>body + args]
    INJECT --> PM[processMessage]
```

```mermaid
sequenceDiagram
    participant R as REPL
    participant A as AgentCore
    participant FS as FileSystem
    participant S as SkillsManager

    Note over R,S: Startup or /skills reload
    R->>A: reloadSkills()
    A->>S: loadSkills(workspaceRoot)
    S->>FS: glob **/SKILL.md
    FS-->>S: file contents
    S-->>A: parsed skills
    A-->>R: refresh completion list

    Note over R,S: User invokes skill
    R->>A: Apply Skill "review" …
    A->>A: append user message
    A->>A: processMessage (skills in system prompt)
```

| Trigger | Effect |
|---------|--------|
| Startup, `/new`, `/skills reload` | Rescan workspace for `SKILL.md` files |
| Edit any `SKILL.md` via write tools | Auto-reload after successful save |
| `/skills:<name>` | Inject skill instructions as a user message |

See [Skills](/docs/plugins/skills) and [ADR 04](/docs/adrs/skills_system).

---

## Slash Command Completion

The Ink REPL builds tab-completion from a **slash-command registry** (`apps/cli/src/slash-commands.ts`):

1. **Static commands** — derived from the `COMMANDS` map in `repl.ts` (`/help`, `/history`, …)
2. **Extensions** — dynamic entries registered via `registerSlashCommandExtension()`

The built-in **skills extension** adds `/skills reload` and one entry per loaded skill (`/skills:my-skill`). Typing `/skills` narrows to reload + all skill names; typing `/skills:` shows skill names only.

```mermaid
flowchart LR
    TAB[Tab on /partial] --> BUILD[buildSlashCommands ctx]

    subgraph Static
        CMD[COMMANDS map in repl.ts]
        BASE[buildBaseSlashCommands]
        CMD --> BASE
    end

    subgraph Extensions
        REG[registerSlashCommandExtension]
        SK[skills extension]
        REG --> SK
        SK --> DYN["/skills reload<br/>/skills:my-skill …"]
    end

    BUILD --> BASE
    BUILD --> DYN
    BASE & DYN --> MERGE[dedupe by name]
    MERGE --> FILTER[filterReplCompletions<br/>prefix match on line]
    FILTER --> OUT[PromptInput or readline list]
```

Extensions can be added for other namespaced commands (e.g. future MCP or plugin slash commands) without editing the base command map.

---

## Sub-agent Delegation

Complex tasks can spawn a **child AgentCore** via `delegate_task` or `/agent <role> | <task>`. The child shares ports (filesystem, LLM, process runner) but gets an isolated message history and optional file context.

```mermaid
flowchart TD
    P[Parent AgentCore] --> CALL[delegate_task or /agent]
    CALL --> D{delegationDepth ≤ 3 ?}
    D -->|no| REJ[Reject — max depth exceeded]
    D -->|yes| CA[createChildAgent sessionId]
    CA --> C[Child AgentCore<br/>custom system prompt]
    C --> FILES[Optional filesToInclude<br/>pre-loaded into context]
    FILES --> LOOP[Child ReAct loop]
    LOOP --> SUM[Summary returned to parent]
    SUM --> P

    subgraph Ink UI
        WS[WorkingStatus line]
    end
    LOOP -.->|activityLabel| WS
```

See [ADR 10](/docs/adrs/subagent_task_delegation).

---

## Streaming & Debug

The Ink UI streams assistant text and optional **thinking/reasoning** blocks (models that emit channel tags or reasoning deltas). A pinned **working status** line above the prompt shows active tool or sub-agent activity while tools run.

```mermaid
sequenceDiagram
    participant UI as Ink App.tsx
    participant AC as AgentCore
    participant LLM as LLM
    participant T as Tool

    UI->>AC: processMessage(text, streamCallback, signal)
    AC->>LLM: chat (streaming)

    loop StreamChunk deltas
        LLM-->>AC: thinking or text chunk
        AC-->>UI: streamCallback(chunk)
        UI->>UI: streamingThinking / streamingContent
    end

    opt tool calls in this turn
        AC->>T: execute tool
        AC-->>UI: activityLabel updated
        UI->>UI: WorkingStatus spinner
        T-->>AC: result
    end

    AC-->>UI: final tokens + cost stats
```

Enable trace logging with `--debug` or `AK_CODER_DEBUG=1`:

| Output | Contents |
|--------|----------|
| `~/.ak-coder/logs/ui.trace.log` | UI events (activity, sub-agents, stream phases) |
| `~/.ak-coder/logs/agent.log` | Core agent log (tool start/finish at debug level) |

```mermaid
flowchart LR
    FLAG["--debug or AK_CODER_DEBUG=1"] --> INIT[initDebug]
    INIT --> TRACE[trace event JSON]
    TRACE --> STDERR[stderr ak-coder:debug]
    TRACE --> FILE[ui.trace.log]
    AC[AgentCore logger] --> AGENT[agent.log]
```

```bash
ak-coder --debug
tail -f ~/.ak-coder/logs/ui.trace.log
```

---

## Hexagonal Architecture: Ports & Adapters

```mermaid
graph TB
    subgraph Core ["packages/core — no Node.js imports"]
        AG[AgentCore]
        SM[SkillsManager]
        subgraph Ports
            FS_P[FileSystem]
            LLM_P[LLMService]
            PR_P[ProcessRunner]
            TIO_P[TerminalIo]
            SS_P[SessionStore]
            LOG_P[Logger]
        end
        AG --> SM
        AG --> FS_P & LLM_P & PR_P & TIO_P & SS_P & LOG_P
    end

    subgraph CLI ["apps/cli/src/adapters"]
        NFS[NodeFileSystem]
        NTI[NodeTerminalIo]
        NPR[NodeProcessRunner]
        DPR[DockerProcessRunner]
        FSS[FileSessionStore]
    end

    subgraph Test ["packages/core/src/mocks"]
        MFS[MockFileSystem]
        MTI[MockTerminalIo]
        MLG[MockLogger]
    end

    NFS -.->|implements| FS_P
    NTI -.->|implements| TIO_P
    NPR & DPR -.->|implements| PR_P
    FSS -.->|implements| SS_P
    MFS -.->|implements| FS_P
    MTI -.->|implements| TIO_P
```

The CLI wires adapters in `apps/cli/src/index.ts`: workspace root → history dir, LLM provider, process runner (host or Docker sandbox), and optional debug logging.

See [ADR 01](/docs/adrs/hexagonal_architecture).
