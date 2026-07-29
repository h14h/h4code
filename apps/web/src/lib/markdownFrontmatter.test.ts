import { describe, expect, it } from "vite-plus/test";
import { splitMarkdownFrontmatter } from "./markdownFrontmatter";

describe("splitMarkdownFrontmatter", () => {
  it("separates top-level metadata from the Markdown body", () => {
    expect(
      splitMarkdownFrontmatter(`---
name: summarize-home-assistant
description: "Summarize a Home Assistant installation"
---
# Instructions
`),
    ).toEqual({
      body: "# Instructions\n",
      frontmatter: [
        {
          key: "name",
          label: "Name",
          value: "summarize-home-assistant",
          sourceLine: 0,
        },
        {
          key: "description",
          label: "Description",
          value: "Summarize a Home Assistant installation",
          sourceLine: 1,
        },
      ],
    });
  });

  it("formats folded and literal block values for readable metadata", () => {
    const result = splitMarkdownFrontmatter(`---
short-description: >
  First line
  second line
example: |
  first
  second
...
Body
`);

    expect(result.frontmatter).toEqual([
      {
        key: "short-description",
        label: "Short description",
        value: "First line second line",
        sourceLine: 0,
      },
      {
        key: "example",
        label: "Example",
        value: "first\nsecond",
        sourceLine: 3,
      },
    ]);
    expect(result.body).toBe("Body\n");
  });

  it("leaves ordinary Markdown thematic breaks untouched", () => {
    const markdown = `---

# Heading
`;
    expect(splitMarkdownFrontmatter(markdown)).toEqual({
      body: markdown,
      frontmatter: [],
    });
  });

  it("preserves unique source positions for repeated keys", () => {
    expect(
      splitMarkdownFrontmatter(`---
tag: first
tag: second
---
`).frontmatter,
    ).toEqual([
      { key: "tag", label: "Tag", value: "first", sourceLine: 0 },
      { key: "tag", label: "Tag", value: "second", sourceLine: 1 },
    ]);
  });
});
