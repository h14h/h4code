#!/usr/bin/env node
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

// One-time installer: symlink monorepo launchers into ~/.local/bin so
// `pair` / `h4code` work from any cwd inside this checkout.

const repoRoot = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const binDir = NodePath.join(repoRoot, "scripts", "bin");
const targetDir = process.env.H4CODE_CLI_BIN_DIR
  ? NodePath.resolve(process.env.H4CODE_CLI_BIN_DIR)
  : NodePath.join(NodeOS.homedir(), ".local", "bin");

const tools = ["h4code", "pair"];

NodeFS.mkdirSync(targetDir, { recursive: true });

for (const name of tools) {
  const source = NodePath.join(binDir, name);
  const destination = NodePath.join(targetDir, name);
  if (!NodeFS.existsSync(source)) {
    console.error(`Missing launcher: ${source}`);
    process.exit(1);
  }
  NodeFS.rmSync(destination, { force: true });
  NodeFS.symlinkSync(source, destination);
  NodeFS.chmodSync(source, 0o755);
  console.log(`Linked ${destination} -> ${source}`);
}

console.log(
  [
    "",
    "Done. From any directory inside this monorepo you can run:",
    "  pair --tailscale",
    "  h4code auth --help",
    "",
    `Ensure ${targetDir} is on your PATH (already true for fish config that uses fish_add_path ~/.local/bin).`,
  ].join("\n"),
);
