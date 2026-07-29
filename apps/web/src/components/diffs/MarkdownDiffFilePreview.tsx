import type { ReviewDiffFileVersionsInput, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useMemo, useState } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { type MarkdownFrontmatterField, splitMarkdownFrontmatter } from "~/lib/markdownFrontmatter";
import { useEnvironmentQuery } from "~/state/query";
import { reviewEnvironment } from "~/state/review";

import { DiffPanelLoadingState } from "../DiffPanelShell";

interface MarkdownDiffFilePreviewFile {
  readonly previousPath: string | null;
  readonly currentPath: string | null;
}

export type MarkdownDiffFilePreviewSelection =
  | {
      readonly kind: "working-tree";
      readonly cwd: string;
      readonly diffHash: string;
      readonly ignoreWhitespace: boolean;
    }
  | {
      readonly kind: "branch-range";
      readonly cwd: string;
      readonly baseRef: string;
      readonly diffHash: string;
      readonly ignoreWhitespace: boolean;
    }
  | {
      readonly kind: "turn";
      readonly threadId: ThreadId;
      readonly fromTurnCount: number;
      readonly toTurnCount: number;
      readonly ignoreWhitespace: boolean;
    };

interface MarkdownDiffFilePreviewProps {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string;
  readonly file: MarkdownDiffFilePreviewFile;
  readonly selection: MarkdownDiffFilePreviewSelection;
  readonly originalDescription: string;
}

type PreviewVersion = "original" | "updated";

function defaultVersion(file: MarkdownDiffFilePreviewFile): PreviewVersion {
  return file.currentPath === null ? "original" : "updated";
}

function MarkdownFrontmatter({
  fields,
}: {
  readonly fields: ReadonlyArray<MarkdownFrontmatterField>;
}) {
  if (fields.length === 0) return null;

  return (
    <Collapsible className="mb-4 border-y border-border/60">
      <CollapsibleTrigger className="flex min-h-12 w-full items-center gap-2 text-left text-base outline-none data-panel-open:[&_svg]:rotate-90 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-8 sm:text-sm">
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform"
        />
        <span className="font-medium text-foreground">Metadata</span>
        <span className="text-muted-foreground">
          {fields.length} {fields.length === 1 ? "field" : "fields"}
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <dl
          aria-label="Document metadata"
          className="border-t border-border/50 pb-2 text-base sm:text-sm"
        >
          {fields.map((field) => (
            <div
              key={`${field.sourceLine}:${field.key}`}
              className="grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-3 border-t border-border/40 py-1.5 first:border-t-0"
            >
              <dt className="font-medium text-foreground/90">{field.label}</dt>
              <dd className="min-w-0 whitespace-pre-line text-pretty text-muted-foreground">
                {field.value || "—"}
              </dd>
            </div>
          ))}
        </dl>
      </CollapsiblePanel>
    </Collapsible>
  );
}

export function MarkdownDiffFilePreview({
  threadRef,
  cwd,
  file,
  selection,
  originalDescription,
}: MarkdownDiffFilePreviewProps) {
  const previewInput = useMemo<ReviewDiffFileVersionsInput>(
    () => ({
      ...selection,
      previousPath: file.previousPath,
      currentPath: file.currentPath,
    }),
    [file.currentPath, file.previousPath, selection],
  );
  const versions = useEnvironmentQuery(
    reviewEnvironment.diffFileVersions({
      environmentId: threadRef.environmentId,
      input: previewInput,
    }),
  );
  const [preferredVersion, setPreferredVersion] = useState<PreviewVersion>(() =>
    defaultVersion(file),
  );
  const alternateVersion: PreviewVersion = preferredVersion === "updated" ? "original" : "updated";
  const effectiveVersion =
    versions.data?.[preferredVersion] === null && versions.data[alternateVersion] !== null
      ? alternateVersion
      : preferredVersion;
  const visibleVersion = versions.data?.[effectiveVersion] ?? null;
  const document = useMemo(
    () => (visibleVersion ? splitMarkdownFrontmatter(visibleVersion.contents) : null),
    [visibleVersion],
  );
  const originalAvailable = versions.data?.original != null;
  const updatedAvailable = versions.data?.updated != null;

  return (
    <div className="min-w-0 bg-background font-sans">
      <div className="flex min-w-0 items-center justify-end border-b border-border/70 bg-muted/20 px-3 py-1.5">
        <ToggleGroup
          aria-label="Markdown preview version"
          className="shrink-0"
          variant="outline"
          size="xs"
          value={[effectiveVersion]}
        >
          <Toggle
            className="px-2 data-pressed:bg-foreground/10 data-pressed:ring-1 data-pressed:ring-foreground/15 data-pressed:ring-inset"
            value="original"
            disabled={!originalAvailable}
            onPressedChange={(pressed) => {
              if (pressed) setPreferredVersion("original");
            }}
            title={originalDescription}
          >
            Original
          </Toggle>
          <Toggle
            className="px-2 data-pressed:bg-foreground/10 data-pressed:ring-1 data-pressed:ring-foreground/15 data-pressed:ring-inset"
            value="updated"
            disabled={!updatedAvailable}
            onPressedChange={(pressed) => {
              if (pressed) setPreferredVersion("updated");
            }}
            title="Show the post-diff Markdown preview."
          >
            Updated
          </Toggle>
        </ToggleGroup>
      </div>
      {versions.error ? (
        <div className="flex min-h-40 items-center justify-center px-5 text-center text-sm text-destructive">
          {versions.error}
        </div>
      ) : versions.isPending && versions.data === null ? (
        <DiffPanelLoadingState label="Loading Markdown preview..." />
      ) : visibleVersion && document ? (
        <>
          {visibleVersion.truncated ? (
            <p className="shrink-0 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground sm:text-xs">
              Preview limited to the first 1 MB of a {visibleVersion.byteLength.toLocaleString()}{" "}
              byte file.
            </p>
          ) : null}
          <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
            <MarkdownFrontmatter fields={document.frontmatter} />
            <ChatMarkdown
              text={document.body}
              cwd={cwd}
              threadRef={threadRef}
              className="font-sans text-base leading-7 sm:text-sm sm:leading-6"
            />
          </div>
        </>
      ) : (
        <div className="flex min-h-40 items-center justify-center px-5 text-center text-sm text-muted-foreground">
          {effectiveVersion === "updated"
            ? "The updated Markdown preview is unavailable."
            : "The original Markdown preview is unavailable."}
        </div>
      )}
    </div>
  );
}
