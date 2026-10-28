import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import { editorConfig, type MarkdownEditorConfig } from "./config";
import { isRangeActive, isUnstable, revealedSelection } from "./state";
import { parseTable } from "./table";
import { TableWidget } from "./tableWidget";
import { parseContainerMarker } from "./syntax/container";
import { CalloutTitleWidget, ImageWidget, MathWidget, MermaidWidget } from "./widgets";

const CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);
const CLOSING_FENCE = /^\s*(`{3,}|~{3,})\s*$/;

/**
 * The full lines a block covers, or null when it starts after a container marker like `> `.
 * With `indented`, a block indented inside a list item counts too; tables don't allow it,
 * because rewriting a table would drop the indentation.
 */
function blockLines(
  state: EditorState,
  node: SyntaxNode,
  indented = false,
): { from: number; to: number } | null {
  const first = state.doc.lineAt(node.from);
  const prefix = state.sliceDoc(first.from, node.from);
  if (indented ? prefix.trim() !== "" : prefix !== "") return null;
  return { from: first.from, to: state.doc.lineAt(node.to).to };
}

function decorateTable(state: EditorState, node: SyntaxNode, ranges: Range<Decoration>[]): void {
  const lines = blockLines(state, node);
  if (!lines || isRangeActive(state, lines.from, lines.to) || isUnstable(state, lines.to)) return;
  const source = state.sliceDoc(lines.from, lines.to);
  const table = parseTable(source);
  if (!table) return;
  const editable = state.facet(EditorView.editable) && !state.readOnly;
  const widget = new TableWidget(source, table, editable);
  ranges.push(Decoration.replace({ widget, block: true }).range(lines.from, lines.to));
}

/** A closed, stable Mermaid fence with code in it, or null. */
function mermaidBlock(
  state: EditorState,
  node: SyntaxNode,
): { lines: { from: number; to: number }; code: string } | null {
  const info = node.getChild("CodeInfo");
  if (!info || state.sliceDoc(info.from, info.to).trim().toLowerCase() !== "mermaid") return null;
  const lines = blockLines(state, node, true);
  if (!lines || isUnstable(state, lines.to)) return null;
  const lastLine = state.doc.lineAt(lines.to);
  // An unclosed fence is still being written.
  if (lastLine.from === lines.from || !CLOSING_FENCE.test(lastLine.text)) return null;
  const text = node.getChild("CodeText");
  const code = text ? state.sliceDoc(text.from, text.to) : "";
  return code.trim() ? { lines, code } : null;
}

function decorateDiagram(state: EditorState, node: SyntaxNode, ranges: Range<Decoration>[]): void {
  const block = mermaidBlock(state, node);
  if (!block) return;
  const { lines, code } = block;
  if (isRangeActive(state, lines.from, lines.to)) {
    const widget = new MermaidWidget(code, true);
    ranges.push(Decoration.widget({ widget, block: true, side: 1 }).range(lines.to));
    return;
  }
  const widget = new MermaidWidget(code, false);
  ranges.push(Decoration.replace({ widget, block: true }).range(lines.from, lines.to));
}

function decorateActiveImages(state: EditorState, ranges: Range<Decoration>[]): void {
  const selection = revealedSelection(state);
  if (!selection) return;
  const config = state.facet(editorConfig);
  const tree = syntaxTree(state);
  const seen = new Set<number>();
  for (const range of selection.ranges) {
    const from = state.doc.lineAt(range.from).from;
    const to = state.doc.lineAt(range.to).to;
    tree.iterate({
      from,
      to,
      enter(ref) {
        if (ref.name === "FencedCode" || ref.name === "CodeBlock" || ref.name === "Table") {
          return false;
        }
        if (ref.name !== "Image" || seen.has(ref.from) || isUnstable(state, ref.to)) return;
        seen.add(ref.from);
        const image = activeImage(state, ref.node, config);
        if (image) ranges.push(image);
        return false;
      },
    });
  }
}

/** An image shown under its line while the source is visible, so it doesn't vanish. */
function activeImage(
  state: EditorState,
  node: SyntaxNode,
  config: MarkdownEditorConfig,
): Range<Decoration> | null {
  const url = node.getChild("URL");
  const marks = node.getChildren("LinkMark");
  if (!url || marks.length < 2) return null;
  const src = state.sliceDoc(url.from, url.to);
  const alt = state.sliceDoc(marks[0].to, marks[1].from);
  const widget = new ImageWidget(config.resolveImageUrl?.(src) ?? src, alt, true);
  const lineEnd = state.doc.lineAt(node.to).to;
  return Decoration.widget({ widget, block: true, side: 1 }).range(lineEnd);
}

function decorateBlockMath(
  state: EditorState,
  node: SyntaxNode,
  ranges: Range<Decoration>[],
): void {
  const marks = node.getChildren("BlockMathMark");
  const lines = blockLines(state, node, true);
  // Leave a block that isn't closed yet, or is still streaming, as source.
  if (marks.length < 2 || !lines || isUnstable(state, lines.to)) return;
  const tex = state.sliceDoc(marks[0].to, marks[1].from).trim();
  if (isRangeActive(state, lines.from, lines.to)) {
    const widget = new MathWidget(tex, true, true);
    ranges.push(Decoration.widget({ widget, block: true, side: 1 }).range(lines.to));
    return;
  }
  const widget = new MathWidget(tex, true);
  ranges.push(Decoration.replace({ widget, block: true }).range(lines.from, lines.to));
}

const containerLines = new Map<string, Decoration>();

function containerLine(className: string): Decoration {
  let decoration = containerLines.get(className);
  if (!decoration) {
    decoration = Decoration.line({ class: className });
    containerLines.set(className, decoration);
  }
  return decoration;
}

/**
 * Pairs `::: type` with the next bare `:::` and styles the lines between as a callout. The marker
 * lines show while the cursor is inside; otherwise the opening line shows only its title.
 */
class ContainerTracker {
  private open: { node: SyntaxNode; type: string; title: string } | null = null;

  constructor(
    readonly state: EditorState,
    readonly ranges: Range<Decoration>[],
  ) {}

  mark(node: SyntaxNode): void {
    const opening = parseContainerMarker(this.state.sliceDoc(node.from, node.to));
    if (opening) {
      this.open = { node, ...opening };
    } else if (this.open) {
      this.decorate(this.open, node);
      this.open = null;
    }
  }

  private decorate(
    open: { node: SyntaxNode; type: string; title: string },
    close: SyntaxNode,
  ): void {
    const { state, ranges } = this;
    const from = open.node.from;
    if (isUnstable(state, close.to)) return;
    const first = state.doc.lineAt(from).number;
    const last = state.doc.lineAt(close.to).number;
    const base = `cm-md-callout cm-md-callout-${open.type}`;
    for (let number = first; number <= last; number++) {
      const edge =
        number === first ? " cm-md-callout-first" : number === last ? " cm-md-callout-last" : "";
      ranges.push(containerLine(base + edge).range(state.doc.line(number).from));
    }
    if (isRangeActive(state, from, close.to)) {
      ranges.push(Decoration.mark({ class: "cm-md-mark" }).range(open.node.from, open.node.to));
      ranges.push(Decoration.mark({ class: "cm-md-mark" }).range(close.from, close.to));
      return;
    }
    const title = new CalloutTitleWidget(open.title);
    ranges.push(Decoration.replace({ widget: title }).range(open.node.from, open.node.to));
    // Transparent rather than removed, so the line still takes clicks.
    ranges.push(Decoration.mark({ class: "cm-md-hidden-text" }).range(close.from, close.to));
  }
}

function buildBlocks(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const mermaid = state.facet(editorConfig).mermaid !== false;
  const containers = new ContainerTracker(state, ranges);
  syntaxTree(state).iterate({
    enter(ref) {
      if (CONTAINERS.has(ref.name)) return true;
      if (ref.name === "Table") decorateTable(state, ref.node, ranges);
      else if (ref.name === "FencedCode" && mermaid) decorateDiagram(state, ref.node, ranges);
      else if (ref.name === "BlockMath") decorateBlockMath(state, ref.node, ranges);
      else if (ref.name === "ContainerMark") containers.mark(ref.node);
      return false;
    },
  });
  decorateActiveImages(state, ranges);
  return Decoration.set(ranges, true);
}

const blockPreviewField = StateField.define<DecorationSet>({
  create: buildBlocks,
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.length > 0 ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
    ) {
      return buildBlocks(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function blockPreview(): Extension {
  return blockPreviewField;
}
