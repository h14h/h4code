# Updating `serve` Without Breaking Remote Reconnects

This runbook covers restarting the deployed H4Code `serve` composition after an upstream integration
without making paired clients look like a different environment. Perform the integration and patch review with
[Syncing H4Code to the Latest Upstream Nightly](./upstream-sync.md); this document covers the
additional deployment safeguards.

## Reconnect invariants

Clients reconnect automatically across an ordinary server restart when all of these remain stable:

- the public HTTP/WebSocket URL
- the persisted environment ID
- the server state directory containing sessions and secrets
- the Tailscale Serve target

For the H4Code server on this machine, the intended values are:

```text
Public URL:    https://henry-pc.tilapia-tawny.ts.net/
Local target:  http://127.0.0.1:3773
T3CODE_HOME:   /home/h14h/.t3
Identity file: /home/h14h/.t3/userdata/environment-id
```

Do not expose a development server as the persistent remote environment. Supplying a Vite dev URL
causes the server to use `$T3CODE_HOME/dev`, which intentionally has a different environment ID from
`$T3CODE_HOME/userdata`. In particular, do not repoint the stable Tailscale URL at the port used by
`vp dev` or `vp run dev:server`.

## One-time Git setup

Keep `main` as a clean mirror of `pingdotgg/t3code`. Keep the H4Code foundation as the single
fork-local commit on `dev`, based on the selected immutable upstream nightly. Build `serve` from
`dev` plus the ordered, selected patch copies. The selected nightly may temporarily be behind the
moving `main` branch:

```text
<selected patch copies>  (serve)
|
<foundation>              (dev)
|  <newer upstream>       (optional; main, upstream/main)
| /
<selected nightly>        (upstream tag)
```

Do not merge `main` into `dev` or develop directly on `serve`. Follow the nightly sync runbook so
upstream history and canonical patches remain intact while the deployed composition stays easy to
identify, audit, and rebuild.

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git
git config rerere.enabled true
git fetch upstream
```

If `upstream` already exists, verify it instead:

```bash
git remote get-url upstream
git config --get rerere.enabled
```

## Fork-specific update boundary

Upstream T3 Code can update published `t3` CLI servers and services from the version-drift UI or
with `npx t3@latest service update`. Those paths install a published upstream package; they do not
build or deploy this H4Code source checkout. Do not use them to update the persistent H4Code server,
because doing so would replace the fork with an upstream release.

The same rule applies to one-shot CLI helpers such as pairing. Do not run `npx t3 pair`: that
installs whatever version is currently published on npm. Use the foundation shim instead.

One-time PATH install (from the monorepo root):

```bash
bun run h4code:install-cli
# or: node scripts/h4code-install-cli.mjs
```

That symlinks `pair` and `h4code` into `~/.local/bin`. Afterwards, from **any directory inside
this monorepo**:

```bash
pair --tailscale
h4code auth --help
```

Without the PATH install, root package scripts still work **from the monorepo root only**
(`bun run pair -- --tailscale`). Nested `package.json` files prevent those scripts from resolving
in app subdirectories.

Both paths run `scripts/h4code-cli.mjs` → `apps/server/dist/bin.mjs` from this checkout (build first
with `bun run build:h4code` if the binary is missing). `pair` still discovers a worktree `.t3`
when the cwd is inside one; otherwise it falls through to `$T3CODE_HOME` / `~/.t3`, which is what
the persistent `h4code-server.service` uses.

A server launched by the custom `h4code-server.service` below is intentionally not recognized as a
T3-managed service. The client may therefore offer a manual upstream relaunch command when its
version differs. Ignore that command for this environment and complete this Git integration, build,
and custom-service restart workflow instead.

## 1. Record the running identity

Run these checks before changing Git state or stopping the server:

```bash
export T3CODE_PUBLIC_URL=https://henry-pc.tilapia-tawny.ts.net
export T3CODE_HOME="$HOME/.t3"
export T3CODE_PORT=3773

expected_environment_id=$(tr -d '\n' < "$T3CODE_HOME/userdata/environment-id")
live_environment_id=$(
  curl --fail --silent --show-error \
    "$T3CODE_PUBLIC_URL/.well-known/t3/environment" |
    jq -r .environmentId
)

test "$live_environment_id" = "$expected_environment_id"
printf 'environment ID: %s\n' "$expected_environment_id"
tailscale serve status
```

Stop if the IDs differ or if Tailscale Serve does not proxy the public URL to
`http://127.0.0.1:3773`. Fix the existing deployment before upgrading it.

Also record the rollback commit and require a clean worktree:

```bash
git switch serve
git status --short
rollback_revision=$(git rev-parse HEAD)
printf 'rollback revision: %s\n' "$rollback_revision"
```

Do not continue with uncommitted changes. Commit, stash, or move them to a separate worktree first.

## 2. Integrate the nightly and evaluate patches

Complete [the upstream sync runbook](./upstream-sync.md) while the old server is still running. It
selects the latest nightly, rewrites the single foundation commit, and reviews every `patch/*`
branch for relevance and compatibility before any deployment downtime. The standard sync workflow
then resumes this runbook at section 3; do not start a second nested sync.

Return to the rebuilt `serve` composition and inspect both it and the integrated foundation before
building:

```bash
git switch serve
git status --short
git log --oneline --decorate --graph -20
integration_base=$(git rev-parse dev^)
test "$(git rev-list --count "$integration_base"..dev)" -eq 1
git merge-base --is-ancestor dev serve
git tag --points-at "$integration_base" | grep -E '^(v.*-nightly\.|nightly-v)'
git diff "$rollback_revision" HEAD --stat
```

Do not push rewritten refs yet. Build and reconnect verification come first.

## 3. Install, verify, and build before downtime

Use the checked-in lockfile, run the focused verification required by the current root `AGENTS.md`,
and build the deployable applications:

```bash
vp install --frozen-lockfile
# Run the smallest relevant formatting, lint, type, and test checks for the integrated changes.
vp run build:h4code
```

Use `build:h4code` rather than the bare `build`. It resolves the upstream nightly tag this
history descends from and exports it as `APP_VERSION`, which both `apps/web/vite.config.ts` and
`apps/server/vite.config.ts` read. Without it, client and server both report the in-repo package
version, which only changes on upstream release commits and therefore cannot distinguish one
nightly from another. Both surfaces must stamp the same string: `resolveVersionMismatch` in
`apps/web/src/versionSkew.ts` compares them verbatim and shows a version-skew banner on any
difference.

If native mobile code changed, also run the repository's required focused native checks.

Do not restart the running server when install, verification, or build fails. The old process can
continue serving clients while the rebase is repaired.

## 4. Back up persistent state

The environment ID must never be regenerated during an update. Before the first restart of a new
revision, take a state backup during a maintenance window:

```bash
backup_dir="$T3CODE_HOME/backups/userdata-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$T3CODE_HOME/backups"
cp -a "$T3CODE_HOME/userdata" "$backup_dir"
printf 'backup: %s\n' "$backup_dir"
```

Treat this directory as sensitive: it can contain authentication material. Never add it to Git.

For a busy server, stop the service before copying so SQLite and the filesystem snapshot are
consistent, then start the old revision again if more preparation is needed.

## 5. Restart one stable server instance

Prefer a user service over an ad hoc terminal or `node --watch` process. A service gives the server a
single owner, a fixed port, automatic crash recovery, and repeatable restarts.

Example `~/.config/systemd/user/h4code-server.service`:

```ini
[Unit]
Description=H4Code remote server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/h14h/code/h4code
Environment=T3CODE_HOME=/home/h14h/.t3
ExecStart=/home/h14h/.local/share/mise/installs/node/24.13.1/bin/node /home/h14h/code/h4code/apps/server/dist/bin.mjs serve --host 127.0.0.1 --port 3773 --tailscale-serve
Restart=on-failure
RestartSec=3
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

Enable it once:

```bash
systemctl --user daemon-reload
systemctl --user enable --now h4code-server.service
```

For each subsequent update, restart only after the new build passes:

```bash
systemctl --user restart h4code-server.service
systemctl --user --no-pager --full status h4code-server.service
```

The `--tailscale-serve` flag makes the stable server own the HTTPS mapping. Do not also run a second
manual server or a second service on port 3773. Development servers must use other ports and must not
replace the stable Tailscale mapping.

## 6. Prove reconnect compatibility

Wait for the local descriptor, then assert that local and public identities still match the ID
recorded before the restart:

```bash
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error \
    "http://127.0.0.1:$T3CODE_PORT/.well-known/t3/environment" \
    > /tmp/h4code-environment.json; then
    break
  fi
  sleep 1
done

local_environment_id=$(jq -r .environmentId /tmp/h4code-environment.json)
public_environment_id=$(
  curl --fail --silent --show-error \
    "$T3CODE_PUBLIC_URL/.well-known/t3/environment" |
    jq -r .environmentId
)

test "$local_environment_id" = "$expected_environment_id"
test "$public_environment_id" = "$expected_environment_id"
curl --fail --silent --show-error --output /dev/null "$T3CODE_PUBLIC_URL/"
tailscale serve status
```

Leave one already-paired client open during the restart. It should move through reconnecting and
return to connected without pairing again. The retrying client may briefly show the server as
unavailable; that is expected. An environment-ID mismatch is not expected and means the public URL
is reaching the wrong state directory or server instance.

Deployment does not imply publication. Do not push the rewritten branch unless the user explicitly
requests it. When publication is requested, fetch first and use:

```bash
git push --force-with-lease origin dev serve
```

Rebasing intentionally changes the foundation commit ID, so a normal push will be rejected. Always
use `--force-with-lease`, never plain `--force`; the lease prevents overwriting remote work that was
not present at the last fetch.

## Rollback

If the new server starts but fails its health or reconnect checks:

1. Stop the service.
2. Create a temporary deployment worktree at the recorded revision. Do not rewrite `serve` during
   the incident merely to deploy the previous build.
3. Reinstall and rebuild that revision.
4. Restore the state backup only if the new revision changed persistent data incompatibly.
5. Start the service and repeat the identity checks.

For a temporary rollback worktree:

```bash
git worktree add --detach /tmp/h4code-rollback "$rollback_revision"
cd /tmp/h4code-rollback
vp install --frozen-lockfile
vp run build
```

Point the service's `WorkingDirectory` and `ExecStart` at that worktree, run
`systemctl --user daemon-reload`, and restart it. Keep `T3CODE_HOME`, port 3773, and the public URL
unchanged. Once `serve` is repaired and verified, point the service back to the normal checkout.

Never fix an environment mismatch by copying a newly generated ID into client storage. Restore the
correct server state or proxy target instead; that preserves sessions, cached data, and the meaning
of the paired environment.
