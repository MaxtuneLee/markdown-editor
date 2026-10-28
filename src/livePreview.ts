import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";

import { editorConfig, openLink } from "./config";
import {
  isNodeActive,
  isRangeActive,
  isUnstable,
  needsRedecoration,
  streamingField,
} from "./state";
import { EMOJI } from "./syntax/emoji";
import { BulletWidget, CheckboxWidget, EmojiWidget, ImageWidget, MathWidget } from "./widgets";
import { requestWikiResolution, wikiStatusField } from "./wikiLinks";

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const markCache = new Map<string, Decoration>();
const lineCache = new Map<string, Decoration>();

function mark(className: string): Decoration {
  let decoration = markCache.get(className);
  if (!decoration) {
    decoration = Decoration.mark({ class: className });
    markCache.set(className, decoration);
  }
  return decoration;
}

function line(className: string): Decoration {
  let decoration = lineCache.get(className);
  if (!decoration) {
    decoration = Decoration.line({ class: className });
    lineCache.set(className, decoration);
  }
  return decoration;
}

class StreamCaretWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const caret = document.createElement("span");
    caret.className = "cm-md-stream-caret";
    caret.setAttribute("aria-hidden", "true");
    return caret;
  }
}

const streamCaret = Decoration.widget({ widget: new StreamCaretWidget(), side: 1 });

const INLINE_STYLES: Record<string, string> = {
  Emphasis: "cm-md-em",
  StrongEmphasis: "cm-md-strong",
  Strikethrough: "cm-md-strike",
  Highlight: "cm-md-highlight",
  InlineCode: "cm-md-inline-code",
};

class Builder {
  readonly ranges: Range<Decoration>[] = [];
  private readonly activeCache = new Map<string, boolean>();

  constructor(
    readonly view: EditorView,
    readonly state: EditorState,
  ) {}

  /** Whether the cursor is inside the syntax node spanning `from`..`to`. */
  active(from: number, to: number): boolean {
    return isNodeActive(this.state, from, to);
  }

  /** Whether the cursor is on a line spanned by `from`..`to`. */
  onLine(from: number, to: number): boolean {
    const key = `${from}:${to}`;
    let value = this.activeCache.get(key);
    if (value === undefined) {
      value = isRangeActive(this.state, from, to);
      this.activeCache.set(key, value);
    }
    return value;
  }

  text(from: number, to: number): string {
    return this.state.sliceDoc(from, to);
  }

  hide(from: number, to: number): void {
    if (to <= from) return;
    const line = this.state.doc.lineAt(from);
    // A line with every character replaced has nothing for clicks to land on, so they go to the
    // next line. Keep such text in place and make it transparent instead.
    if (from === line.from && to >= line.to) this.mark("cm-md-hidden-text", from, to);
    else this.ranges.push(hidden.range(from, to));
  }

  mark(className: string, from: number, to: number): void {
    if (to > from) this.ranges.push(mark(className).range(from, to));
  }

  line(className: string, pos: number): void {
    this.ranges.push(line(className).range(this.state.doc.lineAt(pos).from));
  }

  /** Hides a marker together with the single space that follows it. */
  hideWithSpace(from: number, to: number): void {
    this.hide(from, this.text(to, to + 1) === " " ? to + 1 : to);
  }
}

function headingLevel(name: string): number {
  if (name.startsWith("ATXHeading")) return Number(name.slice(10));
  if (name === "SetextHeading1") return 1;
  if (name === "SetextHeading2") return 2;
  return 0;
}

function linkAttributes(
  b: Builder,
  className: string,
  from: number,
  to: number,
  attrs: Record<string, string>,
): void {
  if (to > from)
    b.ranges.push(Decoration.mark({ class: className, attributes: attrs }).range(from, to));
}

function decorateLink(b: Builder, node: SyntaxNode): void {
  const marks = node.getChildren("LinkMark");
  const url = node.getChild("URL");
  if (marks.length < 2) return;
  const labelFrom = marks[0].to;
  const labelTo = marks[1].from;
  const href = url ? b.text(url.from, url.to) : null;
  if (b.active(node.from, node.to)) {
    b.mark("cm-md-mark", node.from, labelFrom);
    b.mark("cm-md-mark", labelTo, node.to);
    linkAttributes(b, "cm-md-link", labelFrom, labelTo, href ? { "data-href": href } : {});
    return;
  }
  b.hide(node.from, labelFrom);
  b.hide(labelTo, node.to);
  const attrs: Record<string, string> = href ? { "data-href": href, "data-open": "click" } : {};
  linkAttributes(b, "cm-md-link", labelFrom, labelTo, attrs);
}

function decorateImage(b: Builder, node: SyntaxNode): void {
  const marks = node.getChildren("LinkMark");
  const url = node.getChild("URL");
  if (b.active(node.from, node.to) || isUnstable(b.state, node.to) || !url || marks.length < 2) {
    b.mark("cm-md-image-source", node.from, node.to);
    return;
  }
  const config = b.state.facet(editorConfig);
  const src = b.text(url.from, url.to);
  const alt = b.text(marks[0].to, marks[1].from);
  const widget = new ImageWidget(config.resolveImageUrl?.(src) ?? src, alt, false);
  b.ranges.push(Decoration.replace({ widget }).range(node.from, node.to));
}

function decorateInlineMath(b: Builder, node: SyntaxNode): void {
  const marks = node.getChildren("InlineMathMark");
  if (marks.length < 2 || b.active(node.from, node.to) || isUnstable(b.state, node.to)) {
    b.mark("cm-md-math-source", node.from, node.to);
    return;
  }
  const tex = b.text(marks[0].to, marks[1].from);
  const widget = new MathWidget(tex, false);
  b.ranges.push(Decoration.replace({ widget }).range(node.from, node.to));
}

function decorateWikiLink(b: Builder, node: SyntaxNode): void {
  const target = node.getChild("WikiLinkTarget");
  if (!target) return;
  const name = b.text(target.from, target.to).trim();
  const label = node.getChild("WikiLinkLabel");
  const status = b.state.field(wikiStatusField, false)?.get(name);
  if (status === undefined) requestWikiResolution(b.view, name);
  const className = status === false ? "cm-md-wikilink cm-md-wikilink-missing" : "cm-md-wikilink";

  if (b.active(node.from, node.to)) {
    b.mark("cm-md-mark", node.from, node.to);
    linkAttributes(b, className, target.from, target.to, { "data-wiki-target": name });
    return;
  }
  const visibleFrom = label ? label.from : target.from;
  const visibleTo = label ? label.to : target.to;
  b.hide(node.from, visibleFrom);
  b.hide(visibleTo, node.to);
  linkAttributes(b, className, visibleFrom, visibleTo, {
    "data-wiki-target": name,
    "data-open": "click",
  });
}

function decorateListMark(b: Builder, node: SyntaxNode): void {
  const item = node.parent;
  if (!item || item.name !== "ListItem") return;
  if (item.parent?.name === "OrderedList") {
    b.mark("cm-md-list-number", node.from, node.to);
    return;
  }
  if (b.onLine(node.from, node.to)) {
    b.mark("cm-md-mark", node.from, node.to);
    return;
  }
  // Task items show only their checkbox.
  if (item.getChild("Task")) {
    b.hideWithSpace(node.from, node.to);
  } else {
    b.ranges.push(bullet.range(node.from, node.to));
  }
}

type NodeHandler = (b: Builder, ref: SyntaxNodeRef) => boolean | void;

/** Raw syntax for `from`..`to` that shows while `active` and hides otherwise. */
function toggleMark(b: Builder, from: number, to: number, active: boolean): void {
  if (active) b.mark("cm-md-mark", from, to);
  else b.hide(from, to);
}

function decorateLines(b: Builder, className: string, from: number, to: number, last = 0): void {
  for (let pos = from; pos <= to;) {
    const current = b.state.doc.lineAt(pos);
    if (last && current.number > last) break;
    b.line(className, current.from);
    pos = current.to + 1;
  }
}

// Headings keep their size while the cursor is on them, so lines never jump.
const heading: NodeHandler = (b, { name, from, to }) => {
  const lastLine = name.startsWith("Setext") ? b.state.doc.lineAt(to).number - 1 : 0;
  decorateLines(b, `cm-md-heading cm-md-h${headingLevel(name)}`, from, to, lastLine);
};

const inlineStyle: NodeHandler = (b, { name, from, to }) => {
  b.mark(INLINE_STYLES[name], from, to);
};

// Marks show while the cursor is inside the styled span they belong to.
const inlineMark: NodeHandler = (b, ref) => {
  const parent = ref.node.parent;
  const active = parent ? b.active(parent.from, parent.to) : b.active(ref.from, ref.to);
  toggleMark(b, ref.from, ref.to, active);
};

const skip: NodeHandler = () => false;

const NODE_HANDLERS: Record<string, NodeHandler> = {
  ATXHeading1: heading,
  ATXHeading2: heading,
  ATXHeading3: heading,
  ATXHeading4: heading,
  ATXHeading5: heading,
  ATXHeading6: heading,
  SetextHeading1: heading,
  SetextHeading2: heading,
  HeaderMark: (b, ref) => {
    const { from, to } = ref;
    const parent = ref.node.parent;
    if (!parent?.name.startsWith("ATXHeading") || b.onLine(from, to)) {
      b.mark("cm-md-mark", from, to);
    } else if (from === parent.from) {
      b.hideWithSpace(from, to);
    } else {
      // Closing hashes take the space before them.
      b.hide(b.text(from - 1, from) === " " ? from - 1 : from, to);
    }
  },
  Emphasis: inlineStyle,
  StrongEmphasis: inlineStyle,
  Strikethrough: inlineStyle,
  Highlight: inlineStyle,
  InlineCode: inlineStyle,
  EmphasisMark: inlineMark,
  StrikethroughMark: inlineMark,
  HighlightMark: inlineMark,
  CodeMark: (b, ref) => {
    if (ref.node.parent?.name === "InlineCode") inlineMark(b, ref);
  },
  Link: (b, ref) => decorateLink(b, ref.node),
  Image: (b, ref) => {
    decorateImage(b, ref.node);
    return false;
  },
  WikiLink: (b, ref) => {
    decorateWikiLink(b, ref.node);
    return false;
  },
  URL: (b, ref) => {
    const parent = ref.node.parent?.name;
    if (parent === "Link" || parent === "Image") return;
    linkAttributes(b, "cm-md-link", ref.from, ref.to, { "data-href": b.text(ref.from, ref.to) });
  },
  Autolink: (b, { from, to }) => {
    if (b.active(from, to)) return;
    b.hide(from, from + 1);
    b.hide(to - 1, to);
  },
  QuoteMark: (b, { from, to }) => {
    b.line("cm-md-quote", from);
    if (b.onLine(from, to)) b.mark("cm-md-mark", from, to);
    else b.hideWithSpace(from, to);
  },
  ListMark: (b, ref) => decorateListMark(b, ref.node),
  TaskMarker: (b, { from, to }) => {
    const checked = /x/i.test(b.text(from, to));
    if (checked) b.line("cm-md-task-done", from);
    if (b.onLine(from, to)) {
      b.mark("cm-md-mark", from, to);
      return;
    }
    const widget = new CheckboxWidget(checked);
    b.ranges.push(Decoration.replace({ widget }).range(from, to));
  },
  HorizontalRule: (b, { from, to }) => {
    b.line("cm-md-hr", from);
    toggleMark(b, from, to, b.onLine(from, to));
  },
  // Rendered as a widget by the block preview; this styles its source on the cursor's lines.
  Table: (b, { from, to }) => {
    decorateLines(b, "cm-md-table-source", from, to);
    return false;
  },
  InlineMath: (b, ref) => {
    decorateInlineMath(b, ref.node);
    return false;
  },
  // Rendered by the block preview; this styles the source while the cursor is in it.
  BlockMath: (b, { from, to }) => {
    decorateLines(b, "cm-md-math-source-line", from, to);
    return false;
  },
  Emoji: (b, { from, to }) => {
    const emoji = EMOJI[b.text(from + 1, to - 1)];
    if (b.active(from, to) || !emoji) b.mark("cm-md-mark", from, to);
    else b.ranges.push(Decoration.replace({ widget: new EmojiWidget(emoji) }).range(from, to));
  },
  // HTML stays as source: rendering arbitrary markup from a document isn't safe.
  HTMLBlock: (b, { from, to }) => {
    decorateLines(b, "cm-md-html", from, to);
    return false;
  },
  HTMLTag: (b, { from, to }) => b.mark("cm-md-html", from, to),
  FencedCode: skip,
  CodeBlock: skip,
  CommentBlock: skip,
};

function enterNode(b: Builder, ref: SyntaxNodeRef): boolean | void {
  return NODE_HANDLERS[ref.name]?.(b, ref);
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const b = new Builder(view, state);
  const tree = syntaxTree(state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({ from, to, enter: (ref) => enterNode(b, ref) });
  }
  if (state.field(streamingField, false)?.active) {
    b.ranges.push(streamCaret.range(state.doc.length));
  }
  return Decoration.set(b.ranges, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (needsRedecoration(update)) this.decorations = buildDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** The link a left click should open: a rendered link, or any link with Ctrl/Cmd held. */
function clickedLink(event: MouseEvent, view: EditorView): HTMLElement | null {
  if (event.button !== 0 || !(event.target instanceof Element)) return null;
  const target = event.target.closest<HTMLElement>("[data-href], [data-wiki-target]");
  if (!target || !view.contentDOM.contains(target)) return null;
  const modifier = event.metaKey || event.ctrlKey;
  return target.dataset.open === "click" || modifier ? target : null;
}

const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = clickedLink(event, view);
    if (!target) return false;
    const config = view.state.facet(editorConfig);
    const wikiTarget = target.dataset.wikiTarget;
    if (wikiTarget !== undefined && !config.wikiLinks?.onOpen) return false;
    event.preventDefault();
    if (wikiTarget !== undefined) config.wikiLinks?.onOpen?.(wikiTarget, event);
    else openLink(config, target.dataset.href ?? "", event);
    return true;
  },
});

export function livePreview(): Extension {
  return [livePreviewPlugin, linkClicks];
}
