import * as Schema from "effect/Schema";
import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { VcsError } from "./vcs.ts";

export const ReviewDiffPreviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: Schema.optional(TrimmedNonEmptyString),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type ReviewDiffPreviewInput = typeof ReviewDiffPreviewInput.Type;

export const ReviewDiffPreviewSourceKind = Schema.Literals(["working-tree", "branch-range"]);
export type ReviewDiffPreviewSourceKind = typeof ReviewDiffPreviewSourceKind.Type;

export const ReviewDiffPreviewSource = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ReviewDiffPreviewSourceKind,
  title: TrimmedNonEmptyString,
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  diff: Schema.String,
  diffHash: TrimmedNonEmptyString,
  truncated: Schema.Boolean,
});
export type ReviewDiffPreviewSource = typeof ReviewDiffPreviewSource.Type;

export const ReviewDiffPreviewResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  generatedAt: Schema.DateTimeUtc,
  sources: Schema.Array(ReviewDiffPreviewSource),
});
export type ReviewDiffPreviewResult = typeof ReviewDiffPreviewResult.Type;

export const ReviewDiffPreviewError = Schema.Union([VcsError, GitCommandError]);
export type ReviewDiffPreviewError = typeof ReviewDiffPreviewError.Type;

const ReviewDiffFilePaths = {
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  currentPath: Schema.NullOr(TrimmedNonEmptyString),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
};

export const ReviewDiffFileVersionsInput = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("working-tree"),
    cwd: TrimmedNonEmptyString,
    diffHash: TrimmedNonEmptyString,
    ...ReviewDiffFilePaths,
  }),
  Schema.Struct({
    kind: Schema.Literal("branch-range"),
    cwd: TrimmedNonEmptyString,
    baseRef: TrimmedNonEmptyString,
    diffHash: TrimmedNonEmptyString,
    ...ReviewDiffFilePaths,
  }),
  Schema.Struct({
    kind: Schema.Literal("turn"),
    threadId: ThreadId,
    fromTurnCount: NonNegativeInt,
    toTurnCount: NonNegativeInt,
    ...ReviewDiffFilePaths,
  }),
]);
export type ReviewDiffFileVersionsInput = typeof ReviewDiffFileVersionsInput.Type;

export const ReviewDiffFileVersion = Schema.Struct({
  path: TrimmedNonEmptyString,
  contents: Schema.String,
  byteLength: NonNegativeInt,
  truncated: Schema.Boolean,
});
export type ReviewDiffFileVersion = typeof ReviewDiffFileVersion.Type;

export const ReviewDiffFileVersionsResult = Schema.Struct({
  original: Schema.NullOr(ReviewDiffFileVersion),
  updated: Schema.NullOr(ReviewDiffFileVersion),
});
export type ReviewDiffFileVersionsResult = typeof ReviewDiffFileVersionsResult.Type;

export class ReviewDiffFileVersionsError extends Schema.TaggedErrorClass<ReviewDiffFileVersionsError>()(
  "ReviewDiffFileVersionsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
