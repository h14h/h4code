import type { FileDiffMetadata } from "@pierre/diffs/types";
import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";

export interface DiffFileVersionPaths {
  readonly previousPath: string | null;
  readonly currentPath: string | null;
}

function stripGitDiffPath(raw: string): string {
  return raw.startsWith("a/") || raw.startsWith("b/") ? raw.slice(2) : raw;
}

function resolveVersionPaths(file: FileDiffMetadata): DiffFileVersionPaths {
  const previousPath = stripGitDiffPath(file.prevName ?? file.name ?? "");
  const currentPath = stripGitDiffPath(file.name ?? file.prevName ?? "");

  return {
    previousPath: file.type === "new" || previousPath.length === 0 ? null : previousPath,
    currentPath: file.type === "deleted" || currentPath.length === 0 ? null : currentPath,
  };
}

export function diffContainsMarkdownFileSelection(
  diff: string,
  selection: DiffFileVersionPaths,
): boolean {
  const paths = [selection.previousPath, selection.currentPath].filter(
    (filePath): filePath is string => filePath !== null,
  );
  if (paths.length === 0 || !paths.every((filePath) => /\.(?:md|mdx)$/i.test(filePath))) {
    return false;
  }

  try {
    return parsePatchFiles(diff).some((patch) =>
      patch.files.some((file) => {
        const filePaths = resolveVersionPaths(file);
        return (
          filePaths.previousPath === selection.previousPath &&
          filePaths.currentPath === selection.currentPath
        );
      }),
    );
  } catch {
    return false;
  }
}
