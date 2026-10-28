import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

// Markers before a line's text: headings, quotes, list bullets and task boxes.
const LINE_PREFIX = /^(\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+(\[[ xX]\]\s+)?))*$/;

const INLINE_NODES = new Set([
  "Emphasis",
  "StrongEmphasis",
  "Strikethrough",
  "Highlight",
  "InlineCode",
  "Link",
  "Image",
  "WikiLink",
  "Autolink",
]);

interface Span {
  from: number;
  to: number;
}

/** The part of an inline node that stays visible once its syntax is hidden. */
function visibleContent(node: SyntaxNode): Span {
  return linkContent(node) ?? markedContent(node) ?? { from: node.from, to: node.to };
}

/** The label of a link, image, wiki link or autolink. */
function linkContent(node: SyntaxNode): Span | null {
  if (node.name === "Link" || node.name === "Image") {
    const marks = node.getChildren("LinkMark");
    return marks.length >= 2 ? { from: marks[0].to, to: marks[1].from } : null;
  }
  if (node.name === "WikiLink") {
    const visible = node.getChild("WikiLinkLabel") ?? node.getChild("WikiLinkTarget");
    return visible ? { from: visible.from, to: visible.to } : null;
  }
  return node.name === "Autolink" ? { from: node.from + 1, to: node.to - 1 } : null;
}

/** The text between a node's opening and closing marks. */
function markedContent(node: SyntaxNode): Span | null {
  const first = node.firstChild;
  const last = node.lastChild;
  if (!first || !last || first === last) return null;
  return first.name.endsWith("Mark") && last.name.endsWith("Mark")
    ? { from: first.to, to: last.from }
    : null;
}

/** Grows a span to cover every inline node whose visible text it fully contains. */
function coverInlineNodes(state: EditorState, span: Span): Span {
  const tree = syntaxTree(state);
  let { from, to } = span;
  for (const [pos, side] of [
    [from, 1],
    [to, -1],
  ] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (!INLINE_NODES.has(node.name) || (node.from >= from && node.to <= to)) continue;
      const content = visibleContent(node);
      if (from <= content.from && to >= content.to) {
        from = Math.min(from, node.from);
        to = Math.max(to, node.to);
      }
    }
  }
  return { from, to };
}

/**
 * Expands a selection so it includes the markdown hidden around what was selected: the `**`
 * around a fully selected bold word, or the `# ` before a fully selected heading.
 */
export function expandToMarkdown(state: EditorState, from: number, to: number): Span {
  if (from === to) return { from, to };
  const line = state.doc.lineAt(from);
  const start = LINE_PREFIX.test(state.sliceDoc(line.from, from)) ? line.from : from;
  let span = { from: start, to };
  // Covering one node can make an enclosing one fully selected, as in ***both***.
  for (let i = 0; i < 4; i++) {
    const next = coverInlineNodes(state, span);
    if (next.from === span.from && next.to === span.to) break;
    span = next;
  }
  return span;
}

function selectedSpans(state: EditorState): Span[] {
  const spans = state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => expandToMarkdown(state, range.from, range.to))
    .sort((a, b) => a.from - b.from);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}

function writeClipboard(event: ClipboardEvent, view: EditorView, cut: boolean): boolean {
  const spans = selectedSpans(view.state);
  // Empty selections fall back to CodeMirror, which copies the whole line.
  if (spans.length === 0 || !event.clipboardData) return false;
  event.preventDefault();
  const text = spans.map((span) => view.state.sliceDoc(span.from, span.to));
  event.clipboardData.setData("text/plain", text.join(view.state.lineBreak));
  if (cut && !view.state.readOnly) {
    view.dispatch({ changes: spans, scrollIntoView: true, userEvent: "delete.cut" });
  }
  return true;
}

/** Copy and cut put markdown on the clipboard, including syntax the preview hides. */
export const markdownClipboard = EditorView.domEventHandlers({
  copy: (event, view) => writeClipboard(event, view, false),
  cut: (event, view) => writeClipboard(event, view, true),
});
