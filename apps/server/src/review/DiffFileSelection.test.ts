import { describe, expect, it } from "vite-plus/test";

import { diffContainsMarkdownFileSelection } from "./DiffFileSelection.ts";

describe("diffContainsMarkdownFileSelection", () => {
  it("matches changed, added, and renamed Markdown files", () => {
    const diff = [
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/dev/null b/docs/new.mdx",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/docs/new.mdx",
      "@@ -0,0 +1 @@",
      "+# New",
      "diff --git a/docs/old.md b/docs/renamed.md",
      "similarity index 100%",
      "rename from docs/old.md",
      "rename to docs/renamed.md",
      "",
    ].join("\n");

    expect(
      diffContainsMarkdownFileSelection(diff, {
        previousPath: "README.md",
        currentPath: "README.md",
      }),
    ).toBe(true);
    expect(
      diffContainsMarkdownFileSelection(diff, {
        previousPath: null,
        currentPath: "docs/new.mdx",
      }),
    ).toBe(true);
    expect(
      diffContainsMarkdownFileSelection(diff, {
        previousPath: "docs/old.md",
        currentPath: "docs/renamed.md",
      }),
    ).toBe(true);
  });

  it("rejects paths outside the diff, mismatched sides, and non-Markdown files", () => {
    const diff = [
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");

    expect(
      diffContainsMarkdownFileSelection(diff, {
        previousPath: ".env",
        currentPath: ".env",
      }),
    ).toBe(false);
    expect(
      diffContainsMarkdownFileSelection(diff, {
        previousPath: "README.md",
        currentPath: "docs/other.md",
      }),
    ).toBe(false);
    expect(
      diffContainsMarkdownFileSelection(
        "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
        { previousPath: "app.ts", currentPath: "app.ts" },
      ),
    ).toBe(false);

    for (const selection of [
      { previousPath: ".env", currentPath: "README.md" },
      { previousPath: "README.md", currentPath: ".env" },
    ]) {
      expect(
        diffContainsMarkdownFileSelection(
          `diff --git a/${selection.previousPath} b/${selection.currentPath}\nsimilarity index 100%\nrename from ${selection.previousPath}\nrename to ${selection.currentPath}\n`,
          selection,
        ),
      ).toBe(false);
    }
  });
});
