import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ReviewDiffFileVersionsInput, ReviewDiffFileVersionsResult } from "./review.ts";

const decodeFileVersionsInput = Schema.decodeUnknownSync(ReviewDiffFileVersionsInput);
const decodeFileVersionsResult = Schema.decodeUnknownSync(ReviewDiffFileVersionsResult);

describe("ReviewDiffFileVersionsInput", () => {
  it("decodes live and checkpoint preview selections", () => {
    expect(
      decodeFileVersionsInput({
        kind: "working-tree",
        cwd: "/repo",
        diffHash: "abc123",
        previousPath: "README.md",
        currentPath: "README.md",
        ignoreWhitespace: true,
      }),
    ).toMatchObject({ kind: "working-tree", diffHash: "abc123", ignoreWhitespace: true });
    expect(
      decodeFileVersionsInput({
        kind: "turn",
        threadId: "thread-1",
        fromTurnCount: 2,
        toTurnCount: 3,
        previousPath: "docs/old.md",
        currentPath: "docs/new.md",
      }),
    ).toMatchObject({ kind: "turn", fromTurnCount: 2, toTurnCount: 3 });
  });
});

describe("ReviewDiffFileVersionsResult", () => {
  it("supports missing file sides for additions and deletions", () => {
    expect(
      decodeFileVersionsResult({
        original: null,
        updated: {
          path: "README.md",
          contents: "# Updated\n",
          byteLength: 10,
          truncated: false,
        },
      }),
    ).toMatchObject({
      original: null,
      updated: { path: "README.md", contents: "# Updated\n" },
    });
  });
});
