import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

// Builds the deployable apps with APP_VERSION pinned to the upstream nightly tag
// the current history descends from. Both apps/web/vite.config.ts and
// apps/server/vite.config.ts read APP_VERSION, so the client and server stamp the
// same string and resolveVersionMismatch stays quiet.
//
// Without this, a fork build reports the in-repo package version (for example
// 0.0.31), which only changes on upstream release commits and so cannot tell one
// nightly from another.

const repoRoot = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

function resolveNightlyVersion() {
  const result = NodeChildProcess.spawnSync(
    "git",
    ["describe", "--tags", "--abbrev=0", "--match", "v*-nightly.*", "HEAD"],
    { cwd: repoRoot, encoding: "utf8" },
  );

  if (result.status !== 0) {
    return null;
  }

  const tag = result.stdout.trim();
  if (tag.length === 0) {
    return null;
  }

  // Tags are `v<version>`; APP_VERSION wants the bare version.
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

const nightlyVersion = resolveNightlyVersion();
if (nightlyVersion === null) {
  console.warn(
    "No upstream nightly tag found in this history; building with the in-repo package version.",
  );
} else {
  console.log(`Stamping build as ${nightlyVersion}.`);
}

// Use the workspace-pinned CLI. A globally installed vp can be a different
// version than the one this lockfile expects.
const localVp = NodePath.join(repoRoot, "node_modules", ".bin", "vp");
const vpExecutable = NodeFS.existsSync(localVp) ? localVp : "vp";

const build = NodeChildProcess.spawnSync(vpExecutable, ["run", "build"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ...(nightlyVersion === null ? {} : { APP_VERSION: nightlyVersion }),
  },
});

if (build.error) {
  throw build.error;
}

process.exit(build.status ?? 1);
