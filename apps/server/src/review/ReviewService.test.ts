import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/unstable/process";
import type { ReviewDiffPreviewResult, ReviewDiffPreviewSource } from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriver from "../vcs/VcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as ReviewService from "./ReviewService.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";

function makeDiffPreview(cwd: string, source: ReviewDiffPreviewSource): ReviewDiffPreviewResult {
  return {
    cwd,
    generatedAt: DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"),
    sources: [source],
  };
}

function makeLayer(input: {
  readonly workspaceRoot: string;
  readonly baseDir: string;
  readonly detectCalls?: Array<{ readonly cwd: string }>;
  readonly detectedRepositoryRoot?: string;
  readonly executeGit?: GitVcsDriver.GitVcsDriver["Service"]["execute"];
  readonly getReviewDiffPreview?: GitVcsDriver.GitVcsDriver["Service"]["getReviewDiffPreview"];
  readonly readFileAtRevision?: GitVcsDriver.GitVcsDriver["Service"]["readFileAtRevision"];
  readonly readWorkspaceFile?: WorkspaceFileSystem.WorkspaceFileSystem["Service"]["readFile"];
}) {
  return ReviewService.layer.pipe(
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        get: () => Effect.die("unexpected VCS registry get"),
        resolve: () => Effect.die("unexpected VCS registry resolve"),
        detect: (request) =>
          Effect.sync(() => {
            input.detectCalls?.push({ cwd: request.cwd });
            if (input.detectedRepositoryRoot) {
              return {
                kind: "git" as const,
                repository: {
                  kind: "git" as const,
                  rootPath: input.detectedRepositoryRoot,
                  metadataPath: null,
                  freshness: {
                    source: "live-local" as const,
                    observedAt: DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"),
                    expiresAt: Option.none(),
                  },
                },
                driver: {} as VcsDriver.VcsDriver["Service"],
              };
            }
            return null;
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(GitVcsDriver.GitVcsDriver)({
        ...(input.executeGit ? { execute: input.executeGit } : {}),
        ...(input.getReviewDiffPreview ? { getReviewDiffPreview: input.getReviewDiffPreview } : {}),
        ...(input.readFileAtRevision ? { readFileAtRevision: input.readFileAtRevision } : {}),
      }),
    ),
    Layer.provide(
      Layer.mock(WorkspaceFileSystem.WorkspaceFileSystem)(
        input.readWorkspaceFile ? { readFile: input.readWorkspaceFile } : {},
      ),
    ),
    Layer.provide(ServerConfig.layerTest(input.workspaceRoot, input.baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );
}

describe("ReviewService", () => {
  it.effect("rejects diff preview cwd outside the configured workspace roots", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const outsideRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-outside-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });
      const detectCalls: Array<{ readonly cwd: string }> = [];

      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffPreview({ cwd: outsideRoot }).pipe(Effect.flip);
      }).pipe(Effect.provide(makeLayer({ workspaceRoot, baseDir, detectCalls })));

      assert.strictEqual(error._tag, "VcsRepositoryDetectionError");
      assert.strictEqual(error.operation, "ReviewService.getDiffPreview");
      assert.match(
        "detail" in error ? error.detail : "",
        /must stay within the configured workspace root/,
      );
      assert.deepStrictEqual(detectCalls, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("allows diff preview cwd inside the configured workspace root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });
      const detectCalls: Array<{ readonly cwd: string }> = [];

      const result = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffPreview({ cwd: workspaceRoot });
      }).pipe(Effect.provide(makeLayer({ workspaceRoot, baseDir, detectCalls })));

      assert.strictEqual(result.cwd, workspaceRoot);
      assert.deepStrictEqual(result.sources, []);
      assert.deepStrictEqual(detectCalls, [{ cwd: workspaceRoot }]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("loads Git diff previews from the repository root when cwd is nested", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });
      const nestedCwd = `${workspaceRoot}/apps/server`;
      const previewCwds: string[] = [];

      const result = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffPreview({ cwd: nestedCwd });
      }).pipe(
        Effect.provide(
          makeLayer({
            workspaceRoot,
            baseDir,
            detectedRepositoryRoot: workspaceRoot,
            getReviewDiffPreview: (input) =>
              Effect.sync(() => {
                previewCwds.push(input.cwd);
                return {
                  cwd: input.cwd,
                  generatedAt: DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"),
                  sources: [],
                };
              }),
          }),
        ),
      );

      assert.strictEqual(result.cwd, workspaceRoot);
      assert.deepStrictEqual(previewCwds, [workspaceRoot]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects a detected Git root that does not contain the requested cwd", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const unrelatedRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-unrelated-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });

      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffPreview({ cwd: workspaceRoot }).pipe(Effect.flip);
      }).pipe(
        Effect.provide(
          makeLayer({
            workspaceRoot,
            baseDir,
            detectedRepositoryRoot: unrelatedRoot,
          }),
        ),
      );

      assert.strictEqual(error._tag, "VcsRepositoryDetectionError");
      if (error._tag !== "VcsRepositoryDetectionError") return;
      assert.strictEqual(error.operation, "ReviewService.canonicalizeRepositoryRoot");
      assert.match(error.detail, /does not contain the review workspace/);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("preserves unexpected path-resolution failures", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });
      const invalidCwd = `${workspaceRoot}\0invalid`;
      const detectCalls: Array<{ readonly cwd: string }> = [];

      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffPreview({ cwd: invalidCwd }).pipe(Effect.flip);
      }).pipe(Effect.provide(makeLayer({ workspaceRoot, baseDir, detectCalls })));

      assert.strictEqual(error._tag, "VcsRepositoryDetectionError");
      if (error._tag !== "VcsRepositoryDetectionError") return;
      assert.strictEqual(error.operation, "ReviewService.assertWorkspaceBoundCwd.canonicalizePath");
      assert.strictEqual(error.cwd, invalidCwd);
      assert.match(error.detail, /Failed to resolve a path/);
      assert.instanceOf(error.cause, PlatformError.PlatformError);
      assert.deepStrictEqual(detectCalls, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("loads HEAD and workspace versions for a working-tree Markdown preview", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });
      const revisions: string[] = [];
      const readCwds: string[] = [];
      const nestedCwd = `${workspaceRoot}/apps/server`;

      const result = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffFileVersions({
          kind: "working-tree",
          cwd: nestedCwd,
          diffHash: "working-tree-hash",
          previousPath: "README.md",
          currentPath: "README.md",
        });
      }).pipe(
        Effect.provide(
          makeLayer({
            workspaceRoot,
            baseDir,
            executeGit: (_input) =>
              Effect.succeed({
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdout: `${workspaceRoot}\n`,
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              }),
            readFileAtRevision: (input) =>
              Effect.sync(() => {
                revisions.push(input.revision);
                readCwds.push(input.cwd);
                return {
                  path: input.relativePath,
                  contents: "# Original\n",
                  byteLength: 11,
                  truncated: false,
                };
              }),
            getReviewDiffPreview: (input) =>
              Effect.succeed(
                makeDiffPreview(input.cwd, {
                  id: "working-tree",
                  kind: "working-tree",
                  title: "Dirty worktree",
                  baseRef: "HEAD",
                  headRef: null,
                  diff: "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-# Original\n+# Updated\n",
                  diffHash: "working-tree-hash",
                  truncated: false,
                }),
              ),
            readWorkspaceFile: ({ cwd, relativePath }) =>
              Effect.sync(() => {
                readCwds.push(cwd);
                return {
                  relativePath,
                  contents: "# Updated\n",
                  byteLength: 10,
                  truncated: false,
                };
              }),
          }),
        ),
      );

      assert.deepStrictEqual(revisions, ["HEAD"]);
      assert.deepStrictEqual(readCwds, [workspaceRoot, workspaceRoot]);
      assert.strictEqual(result.original?.contents, "# Original\n");
      assert.strictEqual(result.updated?.contents, "# Updated\n");
      assert.strictEqual(result.updated?.path, "README.md");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("accepts the exact Git root above a nested configured workspace cwd", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const repositoryRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const configuredCwd = `${repositoryRoot}/apps/server`;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });

      const result = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffFileVersions({
          kind: "working-tree",
          cwd: repositoryRoot,
          diffHash: "working-tree-hash",
          previousPath: null,
          currentPath: "README.md",
        });
      }).pipe(
        Effect.provide(
          makeLayer({
            workspaceRoot: configuredCwd,
            baseDir,
            executeGit: (_input) =>
              Effect.succeed({
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdout: `${repositoryRoot}\n`,
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              }),
            getReviewDiffPreview: (input) =>
              Effect.succeed(
                makeDiffPreview(input.cwd, {
                  id: "working-tree",
                  kind: "working-tree",
                  title: "Dirty worktree",
                  baseRef: "HEAD",
                  headRef: null,
                  diff: "diff --git a/README.md b/README.md\nnew file mode 100644\n--- /dev/null\n+++ b/README.md\n@@ -0,0 +1 @@\n+# Test\n",
                  diffHash: "working-tree-hash",
                  truncated: false,
                }),
              ),
            readWorkspaceFile: ({ relativePath }) =>
              Effect.succeed({
                relativePath,
                contents: "# Test\n",
                byteLength: 7,
                truncated: false,
              }),
          }),
        ),
      );

      assert.strictEqual(result.original, null);
      assert.strictEqual(result.updated?.contents, "# Test\n");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("loads branch previews from the merge base and HEAD instead of the worktree", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });
      const revisions: string[] = [];

      const result = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffFileVersions({
          kind: "branch-range",
          cwd: workspaceRoot,
          baseRef: "origin/main",
          diffHash: "branch-hash",
          previousPath: "docs/old.md",
          currentPath: "docs/new.md",
        });
      }).pipe(
        Effect.provide(
          makeLayer({
            workspaceRoot,
            baseDir,
            executeGit: (input) =>
              Effect.succeed({
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdout: input.operation.endsWith("resolveGitRepositoryRoot")
                  ? `${workspaceRoot}\n`
                  : input.operation.endsWith("mergeBase")
                    ? "merge-base-sha\n"
                    : "head-sha\n",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              }),
            getReviewDiffPreview: (input) =>
              Effect.succeed(
                makeDiffPreview(input.cwd, {
                  id: "branch-range",
                  kind: "branch-range",
                  title: "Against origin/main",
                  baseRef: "origin/main",
                  headRef: "feature",
                  diff: "diff --git a/docs/old.md b/docs/new.md\nsimilarity index 100%\nrename from docs/old.md\nrename to docs/new.md\n",
                  diffHash: "branch-hash",
                  truncated: false,
                }),
              ),
            readFileAtRevision: (input) =>
              Effect.sync(() => {
                revisions.push(input.revision);
                return {
                  path: input.relativePath,
                  contents: `# ${input.revision}\n`,
                  byteLength: input.revision.length + 3,
                  truncated: false,
                };
              }),
            readWorkspaceFile: () => Effect.die("branch preview must not read the worktree"),
          }),
        ),
      );

      assert.deepStrictEqual(revisions, ["merge-base-sha", "head-sha"]);
      assert.strictEqual(result.original?.path, "docs/old.md");
      assert.strictEqual(result.updated?.path, "docs/new.md");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects file versions outside the selected diff or with a stale hash", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });

      const errors = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* Effect.all([
          review
            .getDiffFileVersions({
              kind: "working-tree",
              cwd: workspaceRoot,
              diffHash: "working-tree-hash",
              previousPath: ".env",
              currentPath: ".env",
            })
            .pipe(Effect.flip),
          review
            .getDiffFileVersions({
              kind: "working-tree",
              cwd: workspaceRoot,
              diffHash: "stale-hash",
              previousPath: "README.md",
              currentPath: "README.md",
            })
            .pipe(Effect.flip),
        ]);
      }).pipe(
        Effect.provide(
          makeLayer({
            workspaceRoot,
            baseDir,
            executeGit: () =>
              Effect.succeed({
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdout: `${workspaceRoot}\n`,
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              }),
            getReviewDiffPreview: (input) =>
              Effect.succeed(
                makeDiffPreview(input.cwd, {
                  id: "working-tree",
                  kind: "working-tree",
                  title: "Dirty worktree",
                  baseRef: "HEAD",
                  headRef: null,
                  diff: "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n",
                  diffHash: "working-tree-hash",
                  truncated: false,
                }),
              ),
            readFileAtRevision: () => Effect.die("invalid selection must not read revisions"),
            readWorkspaceFile: () => Effect.die("invalid selection must not read the worktree"),
          }),
        ),
      );

      for (const error of errors) {
        assert.strictEqual(error._tag, "ReviewDiffFileVersionsError");
        assert.match(error.message, /no longer matches/);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("does not follow a changed Markdown symlink into another workspace file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });
      yield* fs.writeFileString(`${workspaceRoot}/.env`, "SECRET=value\n");
      yield* fs.symlink(`${workspaceRoot}/.env`, `${workspaceRoot}/README.md`);

      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review
          .getDiffFileVersions({
            kind: "working-tree",
            cwd: workspaceRoot,
            diffHash: "working-tree-hash",
            previousPath: null,
            currentPath: "README.md",
          })
          .pipe(Effect.flip);
      }).pipe(
        Effect.provide(
          makeLayer({
            workspaceRoot,
            baseDir,
            executeGit: () =>
              Effect.succeed({
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdout: `${workspaceRoot}\n`,
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              }),
            getReviewDiffPreview: (input) =>
              Effect.succeed(
                makeDiffPreview(input.cwd, {
                  id: "working-tree",
                  kind: "working-tree",
                  title: "Dirty worktree",
                  baseRef: "HEAD",
                  headRef: null,
                  diff: "diff --git a/README.md b/README.md\nnew file mode 120000\n--- /dev/null\n+++ b/README.md\n@@ -0,0 +1 @@\n+.env\n",
                  diffHash: "working-tree-hash",
                  truncated: false,
                }),
              ),
            readWorkspaceFile: () => Effect.die("Markdown previews must not follow symlinks"),
          }),
        ),
      );

      assert.strictEqual(error._tag, "ReviewDiffFileVersionsError");
      assert.match(error.message, /symbolic links/);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
