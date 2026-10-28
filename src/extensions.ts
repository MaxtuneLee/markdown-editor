import { completionKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit, syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  keymap,
  placeholder as placeholderExtension,
  type Command,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import { blockPreview } from "./blockPreview";
import { blockSpacing } from "./blockSpacing";
import { markdownClipboard } from "./clipboard";
import { codeBlocks } from "./codeBlocks";
import { editorConfig, type MarkdownEditorConfig } from "./config";
import { findPanel } from "./findPanel";
import { livePreview } from "./livePreview";
import { editorStateExtensions } from "./state";
import { Container } from "./syntax/container";
import { Emoji } from "./syntax/emoji";
import { Highlight } from "./syntax/highlight";
import { TexMath } from "./syntax/math";
import { WikiLink } from "./syntax/wikiLink";
import { editorTheme } from "./theme";
import { wikiLinkExtensions } from "./wikiLinks";

export interface MarkdownExtensionsOptions extends MarkdownEditorConfig {
  placeholder?: string;
}

function inListItem(state: EditorState): boolean {
  return state.selection.ranges.every((range) => {
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(range.head, -1);
    for (; node; node = node.parent) {
      if (node.name === "ListItem") return true;
    }
    return false;
  });
}

// Tab only nests list items; elsewhere it keeps moving focus out of the editor.
const indentListItem: Command = (view) => inListItem(view.state) && indentMore(view);
const dedentListItem: Command = (view) => inListItem(view.state) && indentLess(view);

/** Every extension the editor needs. Use this to build an editor without the React wrapper. */
export function markdownEditorExtensions(options: MarkdownExtensionsOptions = {}): Extension {
  const { placeholder, ...config } = options;
  return [
    editorStateExtensions(),
    editorConfig.of(config),
    history(),
    drawSelection(),
    dropCursor(),
    EditorView.lineWrapping,
    indentUnit.of("  "),
    // GFM: tables, task lists, strikethrough and autolinks. The keymap continues lists on Enter
    // and removes empty items, which dedents nested ones.
    markdown({
      base: markdownLanguage,
      extensions: [Highlight, WikiLink, TexMath, Container, Emoji],
    }),
    keymap.of([
      { key: "Tab", run: indentListItem, shift: dedentListItem },
      ...defaultKeymap,
      ...historyKeymap,
      ...completionKeymap,
    ]),
    livePreview(),
    markdownClipboard,
    blockPreview(),
    blockSpacing(),
    codeBlocks(),
    wikiLinkExtensions(),
    findPanel(),
    editorTheme,
    placeholder ? placeholderExtension(placeholder) : [],
  ];
}
