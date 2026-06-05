# Milestone 1: Monorepo & Git Setup

## Objectives
Establish a clean workspace repository with TypeScript support, monorepo package configuration using Bun, linting/formatting rules, and npmmirror registry routing.

## Deliverables
- [x] Initialized Git repository on `main` branch.
- [x] Root `package.json` with workspace configuration (`apps/*`, `packages/*`).
- [x] `.npmrc` file mapping dependencies to `https://registry.npmmirror.com`.
- [x] `bunfig.toml` specifying npmmirror registry for Bun commands.
- [x] Root `tsconfig.json` configuring TypeScript.

## Verification
- Run `bun install` at the root and verify that dependencies install successfully using the npmmirror registry.
