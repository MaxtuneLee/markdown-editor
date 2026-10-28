import { EditorView } from "@codemirror/view";

// Colors for the parts CodeMirror styles itself. Values come from the `--mde-*` variables in
// styles.css, so changing a variable restyles everything.
export const editorTheme = EditorView.theme({
  "&": {
    color: "var(--mde-fg)",
    backgroundColor: "var(--mde-bg)",
    fontSize: "var(--mde-font-size)",
    height: "100%",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--mde-font)",
    lineHeight: "var(--mde-line-height)",
    overflowAnchor: "none",
  },
  ".cm-content": {
    caretColor: "var(--mde-cursor)",
    padding: "var(--mde-padding-block) 0",
    maxWidth: "var(--mde-content-width)",
    margin: "0 auto",
    width: "100%",
    boxSizing: "border-box",
  },
  ".cm-line": { padding: "0 var(--mde-padding-inline)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--mde-cursor)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--mde-selection)" },
  ".cm-placeholder": { color: "var(--mde-faint)" },
  ".cm-searchMatch": {
    backgroundColor: "var(--mde-search-match)",
    borderRadius: "2px",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--mde-search-match-active)",
  },
  ".cm-panels": {
    backgroundColor: "transparent",
    color: "var(--mde-fg)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "none" },
  ".cm-tooltip": {
    backgroundColor: "var(--mde-surface)",
    border: "1px solid var(--mde-border)",
    borderRadius: "var(--mde-radius)",
    boxShadow: "var(--mde-shadow)",
    color: "var(--mde-fg)",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--mde-font)",
    maxHeight: "16em",
    padding: "4px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    borderRadius: "calc(var(--mde-radius) * 0.625)",
    padding: "4px 8px",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--mde-accent-soft)",
    color: "var(--mde-fg)",
  },
  ".cm-completionDetail": { color: "var(--mde-muted)", fontStyle: "normal", marginLeft: "8px" },
  ".cm-completionMatchedText": { color: "var(--mde-accent)", textDecoration: "none" },
});
