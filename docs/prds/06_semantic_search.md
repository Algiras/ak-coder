# PRD 06: Semantic Search & Workspace Indexer

## Overview
As codebase size grows, LLMs struggle to find relevant files through simple list/search commands. This document specifies the requirements for an in-memory semantic search capability that indexes workspace files and allows the agent to retrieve relevant code snippets using natural language queries.

## Requirements

### 1. Workspace Indexer
- Crawl the workspace recursively, excluding folders defined in ignore files (`.gitignore`, `.akcoderignore`).
- Parse and chunk source code files (supporting extensions like `.ts`, `.tsx`, `.js`, `.json`, `.md`).
- Expose an `index_workspace` tool that triggers full index generation.

### 2. TF-IDF Vector Store
- Compute TF-IDF weights for vocabulary terms across all chunks.
- Store document vectors in memory to avoid external database dependencies.
- Enable cosine similarity calculations to find the top-K matching document chunks for a given query.

### 3. Semantic Search Tool
- Expose a `semantic_search` tool to the LLM agent.
- Allow querying with natural language (e.g. "where is database connection established?").
- Return matching file paths and code snippets above a configurable similarity threshold.

## User Experience (UX)
- CLI prints progress indicators while indexing large workspaces.
- Tool responses are formatted cleanly, showing matching files with line numbers and snippets.
