import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import {
  type ReviewDiffFileVersionsInput,
  ReviewDiffFileVersionsError,
  type ReviewDiffFileVersionsResult,
  VcsRepositoryDetectionError,
  VcsUnsupportedOperationError,
  type ReviewDiffPreviewError,
  type ReviewDiffPreviewInput,
  type ReviewDiffPreviewResult,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import { diffContainsMarkdownFileSelection } from "./DiffFileSelection.ts";

type LiveReviewDiffFileVersionsInput = Exclude<
  ReviewDiffFileVersionsInput,
  { readonly kind: "turn" }
>;

export class ReviewService extends Context.Service<
  ReviewService,
  {
    readonly getDiffPreview: (
      input: ReviewDiffPreviewInput,
    ) => Effect.Effect<ReviewDiffPreviewResult, ReviewDiffPreviewError>;
    readonly getDiffFileVersions: (
      input: LiveReviewDiffFileVersionsInput,
    ) => Effect.Effect<
      ReviewDiffFileVersionsResult,
      ReviewDiffPreviewError | ReviewDiffFileVersionsError
    >;
  }
>()("t3/review/ReviewService") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;

  const canonicalizePath = (value: string) => {
    const resolvedPath = path.resolve(value);
    return fileSystem.realPath(resolvedPath).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(resolvedPath)
            : Effect.fail(
                new VcsRepositoryDetectionError({
                  operation: "ReviewService.assertWorkspaceBoundCwd.canonicalizePath",
                  cwd: resolvedPath,
                  detail: "Failed to resolve a path while validating the review workspace.",
                  cause,
                }),
              ),
      }),
    );
  };

  const isWithinRoot = (candidate: string, root: string) => {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };

  const assertWorkspaceBoundCwd = Effect.fn("ReviewService.assertWorkspaceBoundCwd")(function* (
    cwd: string,
  ) {
    const [candidate, workspaceRoot, worktreesRoot] = yield* Effect.all([
      canonicalizePath(cwd),
      canonicalizePath(config.cwd),
      canonicalizePath(config.worktreesDir),
    ]);

    if (isWithinRoot(candidate, workspaceRoot) || isWithinRoot(candidate, worktreesRoot)) {
      return;
    }

    if (isWithinRoot(workspaceRoot, candidate)) {
      const configuredRootResult = yield* Effect.option(
        git.execute({
          operation: "ReviewService.assertWorkspaceBoundCwd.configuredGitRoot",
          cwd: workspaceRoot,
          args: ["rev-parse", "--show-toplevel"],
          maxOutputBytes: 4_096,
        }),
      );
      if (Option.isSome(configuredRootResult)) {
        const output = configuredRootResult.value.stdout.trim();
        if (output.length > 0) {
          const configuredRoot = yield* canonicalizePath(
            path.isAbsolute(output) ? output : path.resolve(workspaceRoot, output),
          );
          if (candidate === configuredRoot) {
            return;
          }
        }
      }
    }

    return yield* new VcsRepositoryDetectionError({
      operation: "ReviewService.getDiffPreview",
      cwd,
      detail: "Review diff preview cwd must stay within the configured workspace root.",
    });
  });

  const canonicalizeRepositoryRoot = Effect.fn("ReviewService.canonicalizeRepositoryRoot")(
    function* (cwd: string, repositoryRoot: string) {
      const [candidate, root] = yield* Effect.all([
        canonicalizePath(cwd),
        canonicalizePath(repositoryRoot),
      ]);
      if (isWithinRoot(candidate, root)) {
        return root;
      }

      return yield* new VcsRepositoryDetectionError({
        operation: "ReviewService.canonicalizeRepositoryRoot",
        cwd,
        detail: "The detected repository root does not contain the review workspace.",
      });
    },
  );

  const getDiffPreview: ReviewService["Service"]["getDiffPreview"] = Effect.fn(
    "ReviewService.getDiffPreview",
  )(function* (input) {
    yield* assertWorkspaceBoundCwd(input.cwd);

    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (!handle) {
      return {
        cwd: input.cwd,
        generatedAt: yield* DateTime.now,
        sources: [],
      };
    }

    const previewCwd =
      handle.kind === "git"
        ? yield* canonicalizeRepositoryRoot(input.cwd, handle.repository.rootPath)
        : input.cwd;
    const previewInput = {
      ...input,
      cwd: previewCwd,
    };
    const getDriverDiffPreview = handle.driver.getDiffPreview;
    if (!getDriverDiffPreview) {
      if (handle.kind === "git") {
        return yield* git.getReviewDiffPreview(previewInput);
      }
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getDiffPreview",
        kind: handle.kind,
        detail: `The ${handle.kind} VCS driver does not support review diff previews.`,
      });
    }

    return yield* getDriverDiffPreview(previewInput);
  });

  const resolveGitRepositoryRoot = Effect.fn("ReviewService.resolveGitRepositoryRoot")(function* (
    cwd: string,
  ) {
    const result = yield* git.execute({
      operation: "ReviewService.resolveGitRepositoryRoot",
      cwd,
      args: ["rev-parse", "--show-toplevel"],
      maxOutputBytes: 4_096,
    });
    const output = result.stdout.trim();
    if (output.length === 0) {
      return yield* new VcsRepositoryDetectionError({
        operation: "ReviewService.resolveGitRepositoryRoot",
        cwd,
        detail: "Git did not return a repository root for the review workspace.",
      });
    }

    const repositoryRoot = path.normalize(
      path.isAbsolute(output) ? output : path.resolve(cwd, output),
    );
    return yield* canonicalizeRepositoryRoot(cwd, repositoryRoot);
  });

  const readWorkspaceFile = Effect.fn("ReviewService.readWorkspaceFile")(function* (
    cwd: string,
    relativePath: string,
  ) {
    const linkTarget = yield* Effect.option(fileSystem.readLink(path.resolve(cwd, relativePath)));
    if (Option.isSome(linkTarget)) {
      return yield* new ReviewDiffFileVersionsError({
        message: "Markdown preview does not follow symbolic links",
      });
    }

    const result = yield* Effect.option(workspaceFileSystem.readFile({ cwd, relativePath }));
    return Option.match(result, {
      onNone: () => null,
      onSome: (file) => ({
        path: file.relativePath,
        contents: file.contents,
        byteLength: file.byteLength,
        truncated: file.truncated,
      }),
    });
  });

  const getDiffFileVersions: ReviewService["Service"]["getDiffFileVersions"] = Effect.fn(
    "ReviewService.getDiffFileVersions",
  )(function* (input) {
    yield* assertWorkspaceBoundCwd(input.cwd);
    const repositoryRoot = yield* resolveGitRepositoryRoot(input.cwd);

    const preview = yield* git.getReviewDiffPreview({
      cwd: repositoryRoot,
      ...(input.kind === "branch-range" ? { baseRef: input.baseRef } : {}),
      ignoreWhitespace: input.ignoreWhitespace ?? false,
    });
    const source = preview.sources.find((candidate) => candidate.kind === input.kind);
    if (
      !source ||
      source.diffHash !== input.diffHash ||
      !diffContainsMarkdownFileSelection(source.diff, input)
    ) {
      return yield* new ReviewDiffFileVersionsError({
        message: "Markdown preview selection no longer matches the selected diff",
      });
    }

    if (input.kind === "working-tree") {
      const [original, updated] = yield* Effect.all([
        input.previousPath
          ? git.readFileAtRevision({
              cwd: repositoryRoot,
              revision: "HEAD",
              relativePath: input.previousPath,
            })
          : Effect.succeed(null),
        input.currentPath
          ? readWorkspaceFile(repositoryRoot, input.currentPath)
          : Effect.succeed(null),
      ]);
      return { original, updated };
    }

    const [mergeBaseResult, headResult] = yield* Effect.all([
      git.execute({
        operation: "ReviewService.getDiffFileVersions.mergeBase",
        cwd: repositoryRoot,
        args: ["merge-base", input.baseRef, "HEAD"],
        maxOutputBytes: 4_096,
      }),
      git.execute({
        operation: "ReviewService.getDiffFileVersions.head",
        cwd: repositoryRoot,
        args: ["rev-parse", "--verify", "HEAD^{commit}"],
        maxOutputBytes: 4_096,
      }),
    ]);
    const mergeBase = mergeBaseResult.stdout.trim();
    const head = headResult.stdout.trim();
    const [original, updated] = yield* Effect.all([
      input.previousPath
        ? git.readFileAtRevision({
            cwd: repositoryRoot,
            revision: mergeBase,
            relativePath: input.previousPath,
          })
        : Effect.succeed(null),
      input.currentPath
        ? git.readFileAtRevision({
            cwd: repositoryRoot,
            revision: head,
            relativePath: input.currentPath,
          })
        : Effect.succeed(null),
    ]);
    return { original, updated };
  });

  return ReviewService.of({
    getDiffPreview,
    getDiffFileVersions,
  });
});

export const layer = Layer.effect(ReviewService, make);
