# Updating `dev` Without Breaking Remote Reconnects

This runbook covers merging upstream T3 Code changes into the H4Code `dev` branch and restarting a
Tailnet-accessible server without making paired clients look like a different environment.

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

Keep `main` as a clean mirror of `pingdotgg/t3code` and do personal integration work on `dev`.

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
git switch dev
git status --short
rollback_revision=$(git rev-parse HEAD)
printf 'rollback revision: %s\n' "$rollback_revision"
```

Do not continue with uncommitted changes. Commit, stash, or move them to a separate worktree first.

## 2. Fast-forward `main`, then merge it into `dev`

```bash
git fetch --prune upstream

git switch main
git merge --ff-only upstream/main
git push origin main

git switch dev
git merge --no-ff main
```

Resolve conflicts on `dev`, not on `main`. Keep the merge focused; do not mix unrelated fork changes
into the upstream merge commit. `git rerere` will remember recurring resolutions.

Inspect the result before building:

```bash
git status --short
git log --oneline --decorate --graph -20
git diff "$rollback_revision"...HEAD --stat
```

## 3. Install, verify, and build before downtime

Use the checked-in lockfile and run the repository-required gates:

```bash
vp install --frozen-lockfile
vp check
vp run typecheck
vp test
vp run build
```

If native mobile code changed, also run:

```bash
vp run lint:mobile
```

Do not restart the running server when install, verification, or build fails. The old process can
continue serving clients while the merge is repaired.

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
ExecStart=/usr/bin/node /home/h14h/code/h4code/apps/server/dist/bin.mjs serve --host 127.0.0.1 --port 3773 --tailscale-serve
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

After verification, push the integrated branch:

```bash
git push origin dev
```

## Rollback

If the new server starts but fails its health or reconnect checks:

1. Stop the service.
2. Return `dev` to the recorded revision without rewriting shared history. Prefer reverting the
   upstream merge, or create a temporary deployment worktree at the recorded revision.
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
unchanged. Once `dev` is repaired and verified, point the service back to the normal checkout.

Never fix an environment mismatch by copying a newly generated ID into client storage. Restore the
correct server state or proxy target instead; that preserves sessions, cached data, and the meaning
of the paired environment.
