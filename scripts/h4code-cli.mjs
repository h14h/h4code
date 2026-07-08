#!/usr/bin/env node
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

// Fork-local shim for the built server CLI (`apps/server/dist/bin.mjs`).
// Prefer this over `npx t3`, which installs the published upstream package and
// can drift from the H4Code checkout that actually runs h4code-server.
//
// Repo root is derived from this file's location, so package scripts work from
// any cwd inside the monorepo. process.cwd() is preserved so `t3 pair` still
// discovers a worktree `.t3` when you are inside one.

const repoRoot = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const binPath = NodePath.join(repoRoot, "apps", "server", "dist", "bin.mjs");

if (!NodeFS.existsSync(binPath)) {
  console.error(
    [
      `H4Code CLI binary not found at ${binPath}.`,
      "Build the server first from the monorepo root:",
      "  bun run build:h4code",
      "  # or: pnpm run build:h4code",
    ].join("\n"),
  );
  process.exit(1);
}

const result = NodeChildProcess.spawnSync(process.execPath, [binPath, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
