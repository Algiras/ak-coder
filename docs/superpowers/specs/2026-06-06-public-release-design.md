# Design: Public Release — ak-coder

Date: 2026-06-06  
Status: Approved

## Goal

Ship ak-coder as a public open-source project targeting developers who want to explore or fork a custom LLM agent harness. Entry point: `bunx @algiras/ak-coder`.

## Scope (Big Bang — all in one branch)

1. **README.md** — root-level, hero + quick start + feature list + provider table + links to docs
2. **Docusaurus site** (`website/`) — GitHub Pages, structured developer docs
3. **npm publish pipeline** — rename CLI package, add `bin`, GitHub Actions release workflow
4. **CI hardening** — update existing CI to use project `.npmrc`, add typecheck step
5. **Make repo public** — after all above is merged to `main`

## Package Identity

- npm name: `@algiras/ak-coder`
- bin: `ak-coder` → `apps/cli/src/index.ts`
- Version: `0.1.0` (already set)
- Remove `"private": true` from `apps/cli/package.json`

## Docusaurus Structure (`website/`)

```
website/
  docs/
    getting-started/
      installation.md       — bunx, clone-and-run, Ollama setup
      configuration.md      — ~/.ak-coder/config.json, providers
      first-run.md          — REPL walkthrough, /help, /plan
    tools/
      index.md              — overview of all 15 built-in tools
      read-write.md         — read_file, write_file, str_replace, patch_file
      bash.md               — bash tool, safety gate, confirmation policy
      search.md             — glob, grep_search, semantic_search
      planning.md           — plan mode, delegate_task, web_fetch
    providers/
      index.md              — how providers work (OpenAI-compatible)
      ollama.md             — local Ollama setup
      openrouter.md         — OpenRouter + free tier
      others.md             — Gemini, Groq, DeepSeek
    plugins/
      index.md              — plugin system overview
      building.md           — plugin.json + PluginSDK walkthrough
      skills.md             — SKILL.md custom slash commands
    evals/
      index.md              — eval harness overview
      writing-evals.md      — evalCase, check.*, judge()
      running.md            — CLI flags, --runs, --report, --providers
    adrs/                   — migrated from docs/adrs/*.md
  blog/                     — optional, leave empty for now
  docusaurus.config.ts
  sidebars.ts
```

## GitHub Actions

### `ci.yml` (update existing)
- Add `--frozen-lockfile` flag to `bun install`
- Add typecheck step: `bunx tsc --noEmit`
- Use project `.npmrc` (already committed)

### `docs.yml` (new)
- Trigger: push to `main` (paths: `website/**`, `README.md`)
- Build Docusaurus → deploy to GitHub Pages (`gh-pages` branch)

### `publish.yml` (new)
- Trigger: push tag `v*` (e.g. `v0.1.0`)
- Steps: bun install → bun publish → uses `NPM_TOKEN` secret

## GitHub Secrets Required

| Secret | Value |
|--------|-------|
| `NPM_TOKEN` | npm publish token from `~/.env` |

## README Sections

1. Hero — name, tagline ("A hackable LLM agent harness"), badges (CI, npm, license)
2. Quick start — `bunx @algiras/ak-coder` + Ollama one-liner
3. Features — hexagonal arch, 15 tools, plugins, skills, evals, multi-provider
4. Provider table — Ollama / OpenRouter / Gemini / Groq / DeepSeek
5. Configuration — minimal `~/.ak-coder/config.json` snippet
6. Documentation link → GitHub Pages URL
7. Contributing — `bun test`, eval harness
8. License

## Out of Scope

- npm org creation (using personal `@algiras` scope)
- Making repo public (manual step after merge)
- Blog posts / announcements
