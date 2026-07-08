# Syncing H4Code to the Latest Upstream Nightly

This runbook defines what this fork means by requests such as:

- "pull in upstream"
- "sync upstream"
- "rebase on latest upstream"
- "get latest nightly"

Unless the user names another ref, all of these mean: select the newest upstream nightly, rebase the
single H4Code foundation commit onto it, evaluate every `patch/*` branch independently, rebuild the
selected patch composition on `serve`, then build and deploy the verified `serve` branch. Skip
deployment only when the user explicitly asks for a sync-only operation.

This is an integration review and deployment, not just a mechanical rebase. A patch can apply
without conflicts and still be obsolete or incompatible with the new upstream behavior.

## Branch model

Canonical patches remain independent while `serve` composes selected copies linearly:

```text
                         <patch A>              patch/a
                        /
<nightly> -- <foundation> -- <patch B>          patch/b
                        \
                         <copy A> -- <copy B>   serve
                                      (selected composition)
```

The cherry-picked copies can have different commit IDs from their canonical patch commits. The
ordered selection is stored in repeated repository-local `h4code.servePatch` Git config values.

Rules:

- `main` is a clean mirror of `upstream/main`; never add fork commits to it.
- `dev` has exactly one commit over its selected upstream base: the fork-local foundation.
- Each `patch/*` branch is independent and descends directly from `dev` unless it is intentionally
  documented as a stack.
- `serve` descends from `dev` and contains only cherry-picked commits from the selected patch
  branches. Do not develop original changes directly on `serve`.
- Do not merge upstream into `dev`, merge patches into one another, or add compatibility-fix commits
  on top of canonical patch commits.
- Rewriting local `dev`, `serve`, and retained `patch/*` refs is expected. Pushing rewritten refs is a
  separate action. Permanently discarded patches are deleted locally and remotely together with
  their patch-specific backup refs.

## 1. Inspect and establish a rollback point

Require a clean worktree, enable recorded conflict resolution, and record the starting branch:

```bash
git status --short
test -z "$(git status --porcelain)"
git config rerere.enabled true
starting_branch=$(git branch --show-current)
old_dev=$(git rev-parse dev)
old_dev_base=$(git rev-parse dev^)
old_serve=$(git rev-parse serve)
mapfile -t serve_patches < <(git config --local --get-all h4code.servePatch || true)
```

Unless this is explicitly a sync-only operation, record the running server identity and rollback
revision now by completing section 1 of
[Updating `serve` Without Breaking Remote Reconnects](./upstream-dev-server-update.md). Do this before
changing Git state or stopping the existing server.

Verify that `dev` has one foundation commit and that `serve` descends from it:

```bash
test "$(git rev-list --count "$old_dev_base"..dev)" -eq 1
git merge-base --is-ancestor dev serve
```

Discover patch branches deterministically and verify that they descend from the current `dev`:

```bash
mapfile -t patch_branches < <(
  git for-each-ref --format='%(refname:short)' refs/heads/patch/ | sort
)

for patch in "${patch_branches[@]}"; do
  if ! git merge-base --is-ancestor "$old_dev" "$patch"; then
    printf 'Patch is stale or stacked and needs ancestry review: %s\n' "$patch" >&2
    exit 1
  fi
done

expected_serve_commits=0
serve_messages=$(git log --format=%B "$old_dev..serve")
for patch in "${serve_patches[@]}"; do
  git show-ref --verify --quiet "refs/heads/$patch"
  mapfile -t commits < <(git rev-list --reverse "$old_dev..$patch")
  expected_serve_commits=$((expected_serve_commits + ${#commits[@]}))
  for commit in "${commits[@]}"; do
    grep -Fq "(cherry picked from commit $commit)" <<<"$serve_messages"
  done
done
test "$(git rev-list --count "$old_dev..serve")" -eq "$expected_serve_commits"
```

Do not silently flatten a stale or stacked patch. Explain its ancestry and ask the user how it should
relate to the other patches. Likewise, stop if the configured selection and actual `serve` history
disagree; determine which one represents the intended deployed composition before rewriting.

Create local backup refs before rewriting anything:

```bash
sync_id="upstream-sync-$(date -u +%Y%m%dT%H%M%SZ)"
git branch "backup/$sync_id/dev" dev
git branch "backup/$sync_id/serve" serve
for patch in "${patch_branches[@]}"; do
  git branch "backup/$sync_id/${patch#patch/}" "$patch"
done
```

## 2. Fetch and resolve the newest nightly

Fetch the upstream main branch and all release tags:

```bash
git fetch --prune --tags upstream
```

Resolve the newest supported nightly tag by tag creation date:

```bash
nightly_tag=$(
  git for-each-ref \
    --sort=-creatordate \
    --format='%(refname:short)' \
    'refs/tags/v*-nightly.*' \
    'refs/tags/nightly-v*' |
    head -n 1
)

test -n "$nightly_tag"
nightly_commit=$(git rev-parse "$nightly_tag^{commit}")
printf 'selected nightly: %s (%s)\n' "$nightly_tag" "$nightly_commit"
```

Require the nightly to belong to the fetched upstream history:

```bash
git merge-base --is-ancestor "$nightly_commit" upstream/main
```

If this fails, stop. Do not integrate an unverified tag merely because its date sorts first.

Update local `main` separately, preserving it as a clean upstream mirror:

```bash
git switch main
git merge --ff-only upstream/main
```

A request for the latest nightly does not mean that `dev` should use an untagged `upstream/main`
commit. `main` may therefore be ahead of the immutable nightly selected for `dev`.

## 3. Review the upstream delta

Before rebasing, summarize what changed between the previous `dev` base and the selected nightly:

```bash
git log --oneline --decorate "$old_dev_base..$nightly_commit"
git diff --stat "$old_dev_base..$nightly_commit"
```

If the old base is not an ancestor of the selected nightly, stop and inspect the graph. Do not assume
that a force-pushed or unrelated history is a normal nightly update.

Pay special attention to files and behavior touched by the foundation and by any patch branch. This
upstream-delta review supplies the evidence for later semantic patch assessments.

## 4. Rebase the foundation

Replay only the single foundation commit onto the nightly:

```bash
git rebase --onto "$nightly_commit" "$old_dev_base" dev
```

Resolve conflicts in favor of current upstream behavior while retaining fork-local infrastructure
and account configuration. Complete any paused rebase first:

```bash
git add -- <resolved-paths>
git rebase --continue
```

After the rebase completes, make any additional compatibility edits and amend them into the
foundation rather than adding another commit:

```bash
git add -- <paths>
git commit --amend --no-edit
```

If the upstream delta changes native code, native dependencies, Expo config, config plugins, or
patches used by mobile, refresh the preview runtime pin from `apps/mobile` and amend it into the same
foundation commit:

```bash
cd apps/mobile
vp run runtime:preview:refresh
cd ../..
git add apps/mobile/eas.json
git commit --amend --no-edit
```

Validate the result:

```bash
test "$(git rev-list --count "$nightly_commit"..dev)" -eq 1
test "$(git rev-parse dev^)" = "$nightly_commit"
git diff --check "$nightly_commit..dev"
```

Before evaluating patches, run the smallest relevant formatting, lint, type, and test checks for the
foundation paths changed during integration. Follow the current root `AGENTS.md`; do not substitute
repo-wide verification commands when upstream assigns those to CI.

If the integrated changes affect native mobile code, also run the repository's required focused
native checks.

## 5. Evaluate each patch independently

Process `patch/*` branches one at a time in the order captured before the rebase. Do not treat a
conflict-free rebase as proof that a patch should survive.

For each patch, inspect:

1. **Original intent** — read its commits, diff, tests, and affected user behavior.
2. **Upstream overlap** — inspect upstream commits and current code in the same area between
   `$old_dev_base` and `$nightly_commit`.
3. **Continued relevance** — determine whether the patch still adds useful behavior or whether
   upstream fully or partially supersedes it.
4. **Compatibility** — determine whether APIs, state models, UI structure, invariants, or tests around
   the patch changed even if Git reports no textual conflict.
5. **Verification** — identify the targeted tests or manual behavior check that proves the retained
   patch works on the new base.

Use commands such as:

```bash
git log --reverse --oneline "$old_dev..$patch"
git diff --stat "$old_dev..$patch"
git diff "$old_dev..$patch"
git log --oneline "$old_dev_base..$nightly_commit" -- <patch paths>
git diff "$old_dev_base..$nightly_commit" -- <patch paths>
```

Before changing the patch branch, report a short narrative in this shape:

```text
Patch: patch/example
Intent: ...
Upstream overlap: ...
Relevance: ...
Compatibility: ...
Proposed action: ...
Verification: ...
User decision needed: no | <specific question>
```

This is deliberately not a fixed status enum. The evidence and reasoning matter more than a label.
If the outcome is obvious, describe it and proceed. If upstream only partially replaces the patch or
multiple compatibility behaviors are reasonable, stop and ask the user a concrete question.

### Permanently discarded patch

A fully superseded or intentionally abandoned patch is irrelevant and will never be reused or
contributed. After announcing the finding, remove it from the `serve` selection, then delete its
local branch, its backup from this sync, and its corresponding remote branch if present:

```bash
git config --local --unset-all h4code.servePatch "^${patch}$" || true
git branch -D "$patch"
git branch -D "backup/$sync_id/${patch#patch/}"
if git ls-remote --exit-code --heads origin "refs/heads/$patch" >/dev/null 2>&1; then
  git push origin --delete "$patch"
fi
```

Do not retain historical backup refs for discarded patches. This permanent deletion policy applies
only after the patch assessment has established that discard is the intended outcome; retained
rewritten patches still keep normal rollback refs.

### Relevant and compatible patch

Replay only its patch commits onto the new `dev`:

```bash
git rebase --onto dev "$old_dev" "$patch"
```

Then run its targeted verification and confirm its diff still expresses the original intent.

### Relevant patch needing compatibility changes

Start with the same rebase:

```bash
git rebase --onto dev "$old_dev" "$patch"
```

If the rebase pauses, resolve conflicts and complete it first:

```bash
git add -- <resolved-paths>
git rebase --continue
```

Then make any remaining semantic compatibility edits and amend them into the appropriate existing
patch commit. For a one-commit patch:

```bash
git add -- <paths>
git commit --amend --no-edit
```

For a multi-commit patch, use an interactive rebase or fixup commits followed by autosquash so the
final branch contains only the intended patch commits, not an extra upstream-sync commit.

Run targeted tests after the amendment. Re-read the final diff against `dev`; compatibility work
must not accidentally broaden the patch's scope.

## 6. Rebuild the selected `serve` composition

The ordered selection is the repeated repository-local config value:

```bash
git config --local --get-all h4code.servePatch
```

Add a patch to the end of the composition with `git config --local --add h4code.servePatch
patch/example`. Remove it with `git config --local --unset-all h4code.servePatch '^patch/example$'`.
Reordering means removing and re-adding the values in the desired cherry-pick order.

After `dev` and all canonical patches are final, rebuild `serve` from scratch. The backup created in
section 1 is the rollback point:

```bash
git switch serve
git reset --hard dev
mapfile -t serve_patches < <(git config --local --get-all h4code.servePatch || true)
for patch in "${serve_patches[@]}"; do
  git merge-base --is-ancestor dev "$patch"
  mapfile -t commits < <(git rev-list --reverse "dev..$patch")
  if ((${#commits[@]} > 0)); then
    git cherry-pick -x "${commits[@]}"
  fi
done
```

The `-x` trailers map each deployed copy back to its canonical patch commit. Resolve mechanical
conflicts in the `serve` copy and continue the cherry-pick. If selected patches need durable
interaction logic rather than a mechanical resolution, stop and represent that behavior as an
explicit patch instead of hiding original work on `serve`.

Verify that `serve` descends from `dev`, contains exactly the expected number of selected patch
commits, has a clean diff, and contains no original commits unrelated to the selection. Then run the
smallest combined checks that exercise interactions among the selected patches.

## 7. Final verification, deployment, and report

For every retained patch, verify ancestry, switch to it, and run the smallest checks that cover its
resulting diff:

```bash
git merge-base --is-ancestor dev "$patch"
git switch "$patch"
```

Follow the current root `AGENTS.md` for focused formatting, lint, type, test, and integrated client
verification. Run the required native checks when the patch includes native mobile code. Do not run
repo-wide suites unless the user explicitly requests them.

Verify the combined `serve` result separately after all independently retained patches pass. Unless
the user explicitly requested sync-only, keep `serve` checked out and complete sections 3 through 6
of [Updating `serve` Without Breaking Remote Reconnects](./upstream-dev-server-update.md). This means
a frozen install, production build, persistent-state backup, stable-service restart, and local plus
Tailnet identity verification. Deploy `serve`, never `dev` or an independent `patch/*` branch. If a
server was running before the sync, record its identity and rollback revision using section 1 of
that runbook before integration begins.

Finish with a report containing:

- selected nightly tag and commit
- rewritten `dev` commit and rebuilt/deployed `serve` commit
- one narrative assessment and action for every original `patch/*` branch
- old and new commit IDs for retained patches
- deleted local, remote, and backup refs for discarded patches; backup refs for rewritten patches
- verification, build, restart, and reconnect results
- any unresolved decisions or risks

After a standard deployed sync, leave `serve` checked out so the working tree, built artifacts, and
running deployment describe the same composition. For an explicit sync-only operation, restore the
branch that was checked out at the start if it still exists; otherwise return to `serve`.

Do not push as part of a vague upstream-sync request. If the user asks to publish the rewritten
history, use `git push --force-with-lease` for each rewritten branch and never plain `--force`.
