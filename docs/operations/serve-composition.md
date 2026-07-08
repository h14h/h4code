# Composing the H4Code `serve` Branch

`serve` is the branch built and run by the persistent H4Code server. It provides one linear,
testable composition of any number of optional patches without making those patches depend on one
another.

## Invariants

- `dev` contains exactly one fork-foundation commit over the selected nightly.
- Every canonical `patch/*` branch is independently based on `dev`.
- `serve` is based on `dev` and contains only cherry-picked copies of selected patch commits.
- Original feature work never starts on `serve`.
- The ordered selection is stored as repeated repository-local `h4code.servePatch` Git config values.
- The checked-out branch remains `serve` after deployment so the source tree, built artifacts, and
  running server describe the same composition.

List the selected patches:

```bash
git config --local --get-all h4code.servePatch
```

No output means no patches are selected and `serve` should point directly at `dev`.

## Select or deselect a patch

Append a patch to the composition order:

```bash
git config --local --add h4code.servePatch patch/example
```

Deselect a patch without discarding its canonical branch:

```bash
git config --local --unset-all h4code.servePatch '^patch/example$'
```

To reorder patches, remove and re-add the values in the desired cherry-pick order. Order matters
when patches touch overlapping code.

Deselecting is reversible. Discarding is not: a discarded patch is first removed from this selection
and then its local, remote, and patch-specific backup refs are permanently deleted.

## Rebuild `serve`

Require a clean worktree and validate every selected branch before rewriting `serve`:

```bash
test -z "$(git status --porcelain)"
mapfile -t serve_patches < <(git config --local --get-all h4code.servePatch || true)
for patch in "${serve_patches[@]}"; do
  git show-ref --verify --quiet "refs/heads/$patch"
  git merge-base --is-ancestor dev "$patch"
done
```

Create a composition rollback ref, then rebuild from `dev` in selection order:

```bash
compose_id="serve-compose-$(date -u +%Y%m%dT%H%M%SZ)"
git branch "backup/$compose_id/serve" serve
git switch serve
git reset --hard dev
for patch in "${serve_patches[@]}"; do
  mapfile -t commits < <(git rev-list --reverse "dev..$patch")
  if ((${#commits[@]} > 0)); then
    git cherry-pick -x "${commits[@]}"
  fi
done
```

The `-x` trailer records the canonical source commit for every deployed copy. Resolve mechanical
conflicts in the `serve` copy. If patches require durable interaction logic, create an explicit
canonical patch for that behavior instead of hiding original work on `serve`.

## Verify and deploy

Verify each canonical patch independently first. Then verify the combined `serve` behavior,
including focused interaction tests and integrated client checks for affected surfaces:

```bash
git merge-base --is-ancestor dev serve
git diff --check dev..serve
git status --short
```

Unless the user requests a composition-only operation, install, build, restart, and verify the
persistent server using [Updating `serve` Without Breaking Remote Reconnects](./upstream-dev-server-update.md).
Never deploy `dev` or a standalone `patch/*` branch as the stable server.

During an upstream sync, follow [Syncing H4Code to the Latest Upstream Nightly](./upstream-sync.md),
which rebases the foundation and canonical patches before rebuilding this composition.
