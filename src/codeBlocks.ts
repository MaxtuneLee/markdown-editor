import { syntaxTree } from "@codemirror/language";
import { StateEffect, type EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import { parseFenceInfo } from "./codeInfo";
import { hasLanguage, loadLanguage, tokenize } from "./shiki";
import { isRangeActive, needsRedecoration } from "./state";

const languageLoaded = StateEffect.define<null>();

const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const FONT_STYLE_UNDERLINE = 4;

const lineDecorations = {
  first: Decoration.line({ class: "cm-md-code-line cm-md-code-first" }),
  middle: Decoration.line({ class: "cm-md-code-line" }),
  last: Decoration.line({ class: "cm-md-code-line cm-md-code-last" }),
  only: Decoration.line({ class: "cm-md-code-line cm-md-code-first cm-md-code-last" }),
};
const fenceMark = Decoration.mark({ class: "cm-md-fence" });
const infoMark = Decoration.mark({ class: "cm-md-code-info" });
const hiddenFence = Decoration.replace({});
// For a fence that is the line's only text: replacing all of it would leave nothing for clicks
// to land on, so the text stays in place, transparent.
const transparentFence = Decoration.mark({ class: "cm-md-hidden-text" });
const tokenMarks = new Map<string, Decoration>();

const FONT_STYLES: [number, string][] = [
  [FONT_STYLE_ITALIC, "font-style:italic"],
  [FONT_STYLE_BOLD, "font-weight:600"],
  [FONT_STYLE_UNDERLINE, "text-decoration:underline"],
];

function tokenMark(color: string | undefined, fontStyle = 0): Decoration | null {
  const styles = FONT_STYLES.filter(([flag]) => fontStyle & flag).map(([, style]) => style);
  if (color) styles.unshift(`color:${color}`);
  if (styles.length === 0) return null;
  const style = styles.join(";");
  let decoration = tokenMarks.get(style);
  if (!decoration) {
    decoration = Decoration.mark({ attributes: { style } });
    tokenMarks.set(style, decoration);
  }
  return decoration;
}

class CodeBlockHighlighter {
  decorations: DecorationSet;
  private destroyed = false;
  private readonly requested = new Set<string>();

  constructor(readonly view: EditorView) {
    this.decorations = this.build();
  }

  update(update: ViewUpdate): void {
    if (needsRedecoration(update)) this.decorations = this.build();
  }

  destroy(): void {
    this.destroyed = true;
  }

  private requestLanguage(info: string): void {
    if (this.requested.has(info)) return;
    this.requested.add(info);
    void loadLanguage(info).then((loaded) => {
      if (loaded && !this.destroyed) this.view.dispatch({ effects: languageLoaded.of(null) });
    });
  }

  private build(): DecorationSet {
    const { state } = this.view;
    const ranges: Range<Decoration>[] = [];
    const seen = new Set<number>();
    const tree = syntaxTree(state);

    for (const visible of this.view.visibleRanges) {
      tree.iterate({
        from: visible.from,
        to: visible.to,
        enter: (ref) => {
          if (ref.name !== "FencedCode" && ref.name !== "CodeBlock") return;
          if (seen.has(ref.from)) return false;
          seen.add(ref.from);
          decorateCodeLines(state, ref.from, ref.to, ranges);
          if (ref.name === "FencedCode") {
            const lang = decorateFence(state, ref.node, ranges);
            if (lang) this.requestLanguage(lang);
          }
          return false;
        },
      });
    }
    return Decoration.set(ranges, true);
  }
}

const diffAdded = Decoration.line({ class: "cm-md-diff-added" });
const diffRemoved = Decoration.line({ class: "cm-md-diff-removed" });

/** Marks + and - lines in a `diff <lang>` block, which is highlighted as <lang>. */
function decorateDiffLines(
  state: EditorState,
  from: number,
  to: number,
  ranges: Range<Decoration>[],
): void {
  for (let pos = from; pos <= to;) {
    const line = state.doc.lineAt(pos);
    const marker = line.text.trimStart()[0];
    if (marker === "+") ranges.push(diffAdded.range(line.from));
    else if (marker === "-") ranges.push(diffRemoved.range(line.from));
    pos = line.to + 1;
  }
}

function lineDecoration(number: number, first: number, last: number): Decoration {
  if (first === last) return lineDecorations.only;
  if (number === first) return lineDecorations.first;
  return number === last ? lineDecorations.last : lineDecorations.middle;
}

function decorateCodeLines(
  state: EditorState,
  from: number,
  to: number,
  ranges: Range<Decoration>[],
): void {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  for (let number = first; number <= last; number++) {
    ranges.push(lineDecoration(number, first, last).range(state.doc.line(number).from));
  }
}

/** Decorates a fenced block's markers and tokens. Returns its language if that still has to load. */
function decorateFence(
  state: EditorState,
  node: SyntaxNode,
  ranges: Range<Decoration>[],
): string | null {
  decorateFenceMarks(state, node, ranges);
  const info = node.getChild("CodeInfo");
  const text = node.getChild("CodeText");
  if (info) ranges.push(infoMark.range(info.from, info.to));
  if (!info || !text) return null;
  return highlightCode(state, state.sliceDoc(info.from, info.to), text, ranges);
}

// Fences show only while the cursor is in the block; the language stays as a label.
function decorateFenceMarks(
  state: EditorState,
  node: SyntaxNode,
  ranges: Range<Decoration>[],
): void {
  const active = isRangeActive(state, node.from, node.to);
  for (const fence of node.getChildren("CodeMark")) {
    if (active) {
      ranges.push(fenceMark.range(fence.from, fence.to));
      continue;
    }
    const line = state.doc.lineAt(fence.from);
    const alone =
      state.sliceDoc(line.from, line.to).trim() === state.sliceDoc(fence.from, fence.to);
    ranges.push((alone ? transparentFence : hiddenFence).range(fence.from, fence.to));
  }
}

/** Colors a block's code. Returns its language if that still has to load. */
function highlightCode(
  state: EditorState,
  lang: string,
  text: SyntaxNode,
  ranges: Range<Decoration>[],
): string | null {
  if (parseFenceInfo(lang).diff) decorateDiffLines(state, text.from, text.to, ranges);
  if (!hasLanguage(lang)) return null;
  const tokens = tokenize(lang, state.sliceDoc(text.from, text.to));
  if (!tokens) return lang;
  for (const token of tokens.flat()) {
    const decoration = tokenMark(token.color, token.fontStyle);
    if (!decoration || token.content.length === 0) continue;
    const from = text.from + token.offset;
    ranges.push(decoration.range(from, from + token.content.length));
  }
  return null;
}

export function codeBlocks(): Extension {
  return ViewPlugin.fromClass(CodeBlockHighlighter, {
    decorations: (plugin) => plugin.decorations,
  });
}
