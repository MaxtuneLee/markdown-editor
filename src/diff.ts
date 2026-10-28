import {
  acceptChunk,
  getChunks,
  getOriginalDoc,
  goToNextChunk,
  goToPreviousChunk,
  originalDocChangeEffect,
  rejectChunk,
  unifiedMergeView,
} from "@codemirror/merge";
import { ChangeSet, type EditorState, type Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";

export interface MarkdownDiffOptions {
  /** The text the current document is compared with, such as the version before an AI edit. */
  original: string;
  /** Show accept and reject buttons on each change. Defaults to true. */
  controls?: boolean;
  /** Show small edits inside a line instead of as removed and added lines. Defaults to true. */
  inlineChanges?: boolean;
  /** Collapse long unchanged stretches. Defaults to false. */
  collapseUnchanged?: boolean | { margin?: number; minSize?: number };
}

function renderControl(
  type: "accept" | "reject",
  action: (event: MouseEvent) => void,
): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `cm-md-diff-button cm-md-diff-${type}`;
  button.textContent = type === "accept" ? "Accept" : "Reject";
  button.addEventListener("mousedown", action);
  return button;
}

/**
 * Shows the changes between `original` and the document inline, with removed text above the
 * text that replaced it. Pass it to `MarkdownEditor`'s `extensions` to turn the diff on.
 */
export function markdownDiff(options: MarkdownDiffOptions): Extension {
  const { original, controls = true, inlineChanges = true, collapseUnchanged = false } = options;
  return [
    unifiedMergeView({
      original,
      mergeControls: controls ? renderControl : false,
      highlightChanges: true,
      // A gutter would sit at the editor's edge, away from the centered text column.
      gutter: false,
      syntaxHighlightDeletions: false,
      allowInlineDiffs: inlineChanges,
      collapseUnchanged:
        collapseUnchanged === true
          ? {}
          : collapseUnchanged === false
            ? undefined
            : collapseUnchanged,
    }),
    keymap.of([
      { key: "Mod-Alt-ArrowDown", run: goToNextChunk },
      { key: "Mod-Alt-ArrowUp", run: goToPreviousChunk },
    ]),
  ];
}

/** Number of changed chunks, or 0 when the diff isn't enabled. */
export function countDiffChanges(state: EditorState): number {
  return getChunks(state)?.chunks.length ?? 0;
}

/** Replaces the text the document is compared with. */
export function setDiffOriginal(view: EditorView, original: string): void {
  const previous = getOriginalDoc(view.state);
  const changes = ChangeSet.of(
    [{ from: 0, to: previous.length, insert: original }],
    previous.length,
  );
  view.dispatch({ effects: originalDocChangeEffect(view.state, changes) });
}

function resolveAll(view: EditorView, resolve: (view: EditorView, pos: number) => boolean): void {
  let remaining = countDiffChanges(view.state);
  while (remaining > 0) {
    const chunk = getChunks(view.state)?.chunks[0];
    if (!chunk || !resolve(view, chunk.fromB)) return;
    remaining--;
  }
}

/** Keeps every change: the original becomes the current document. */
export function acceptAllChanges(view: EditorView): void {
  resolveAll(view, acceptChunk);
}

/** Reverts every change back to the original. */
export function rejectAllChanges(view: EditorView): void {
  resolveAll(view, rejectChunk);
}

export { acceptChunk, goToNextChunk, goToPreviousChunk, rejectChunk };
