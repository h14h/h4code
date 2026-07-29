export interface MarkdownFrontmatterField {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly sourceLine: number;
}

export interface MarkdownDocumentParts {
  readonly body: string;
  readonly frontmatter: ReadonlyArray<MarkdownFrontmatterField>;
}

const FRONTMATTER_PATTERN =
  /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const FRONTMATTER_FIELD_PATTERN = /^([A-Za-z0-9][A-Za-z0-9_-]*):[ \t]*(.*)$/;

function frontmatterLabel(key: string): string {
  const words = key.replaceAll(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function unwrapQuotedScalar(value: string): string {
  if (value.length < 2) return value;
  const quote = value.charAt(0);
  return (quote === `"` || quote === `'`) && value.endsWith(quote) ? value.slice(1, -1) : value;
}

function formatFrontmatterValue(firstLine: string, continuationLines: ReadonlyArray<string>) {
  const blockStyle = firstLine.match(/^[>|][+-]?\s*$/)?.[0]?.charAt(0);
  const continuation = continuationLines.map((line) => line.trim());

  if (blockStyle === ">") {
    return continuation.filter(Boolean).join(" ");
  }
  if (blockStyle === "|") {
    return continuation.join("\n").trim();
  }

  const lines = [firstLine, ...continuation].filter((line) => line.length > 0);
  return unwrapQuotedScalar(lines.join("\n").trim());
}

export function splitMarkdownFrontmatter(markdown: string): MarkdownDocumentParts {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) {
    return { body: markdown, frontmatter: [] };
  }

  const fields: MarkdownFrontmatterField[] = [];
  let current:
    | {
        readonly key: string;
        readonly firstLine: string;
        readonly continuationLines: string[];
        readonly sourceLine: number;
      }
    | undefined;

  const finishCurrent = () => {
    if (!current) return;
    fields.push({
      key: current.key,
      label: frontmatterLabel(current.key),
      value: formatFrontmatterValue(current.firstLine, current.continuationLines),
      sourceLine: current.sourceLine,
    });
  };

  for (const [sourceLine, line] of (match[1] ?? "").split(/\r?\n/).entries()) {
    const fieldMatch = FRONTMATTER_FIELD_PATTERN.exec(line);
    if (fieldMatch?.[1] !== undefined) {
      finishCurrent();
      current = {
        key: fieldMatch[1],
        firstLine: fieldMatch[2] ?? "",
        continuationLines: [],
        sourceLine,
      };
      continue;
    }

    if (current && (line.startsWith(" ") || line.startsWith("\t") || line.trim() === "")) {
      current.continuationLines.push(line);
    }
  }
  finishCurrent();

  return {
    body: markdown.slice(match[0].length),
    frontmatter: fields,
  };
}
