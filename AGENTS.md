# AGENTS.md

## Task Completion Requirements

- `vp check` and `vp run typecheck` must pass before considering tasks completed.
  - If changing native mobile code, `vp run lint:mobile` must also pass.
- Use `vp test` for the built-in Vite+ test command and `vp run test` when you specifically need the `test` package script.

## H4Code Fork Workflow

- Keep `main` as a clean mirror of upstream `pingdotgg/t3code`. Do not commit personal customizations there.
- Keep `dev` as the personal integration branch for H4Code. It should start with a small foundation commit containing only fork-local infrastructure and account configuration.
- Create feature and bugfix branches from `dev`. Land completed work back into `dev` as small, reviewable commits or a squash commit when the branch is purely local.
- If work may be upstreamable, cleanly split it before contribution: create a branch from `main`, cherry-pick only the relevant upstream-safe commit(s), and open the PR from that branch.
- Prefer upstream's workflow shape even for fork-only work: small focused changes, deterministic tests, no unrelated refactors, and explicit notes for behavior, risk, and verification.
- Keep fork-only commits easy to identify. Use commit subjects like `local: configure h4code mobile eas` for personal infrastructure and regular upstream-style subjects like `fix(mobile): ...` for generally useful fixes.
- Enable `git rerere` locally so recurring rebase conflicts can be replayed: `git config rerere.enabled true`.

### H4Code Mobile/EAS Overlay

- The mobile app is built from `apps/mobile`; do not run EAS from the repository root.
- H4Code Expo configuration belongs in the personal foundation commit: Expo owner/project, EAS project ID, bundle/package ID base, and preview build profiles.
- Keep native build fixes, app feature work, and personal EAS/account wiring in separate commits. Native fixes are the most likely mobile changes to cherry-pick onto an upstream PR branch.
- For preview builds, follow upstream's environment shape: `APP_VARIANT=preview`, `MOBILE_VERSION_POLICY=fingerprint`, and EAS environment `preview`.

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and client applications. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.
- `packages/client-runtime`: Shared runtime package for sharing client code across web and mobile.

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding
agents.

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `bun run sync:repos`; use `bun run sync:repos --repo <id>` to sync one
  configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so
  `.repos/` matches the installed dependency version.
- When writing Effect code, read `.repos/effect-smol/LLMS.md` first and inspect `.repos/effect-smol/` for
  examples of idiomatic usage, tests, module structure, and API design.
- When writing relay infrastructure code with Alchemy, inspect `.repos/alchemy-effect/` for examples of
  idiomatic usage, tests, module structure, and API design.
