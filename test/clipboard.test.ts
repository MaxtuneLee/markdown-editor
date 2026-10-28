import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vite-plus/test";
import { ensureSyntaxTree } from "@codemirror/language";

import { expandToMarkdown } from "../src/clipboard";
import { markdownEditorExtensions } from "../src/extensions";

function copy(doc: string, selected: string, occurrence = 0): string {
  const state = EditorState.create({ doc, extensions: markdownEditorExtensions() });
  ensureSyntaxTree(state, doc.length);
  let from = -1;
  for (let i = 0; i <= occurrence; i++) from = doc.indexOf(selected, from + 1);
  const span = expandToMarkdown(state, from, from + selected.length);
  return doc.slice(span.from, span.to);
}

describe("expandToMarkdown", () => {
  it("includes the marks around fully selected inline text", () => {
    expect(copy("a **bold** b", "bold")).toBe("**bold**");
    expect(copy("a ==mark== b", "mark")).toBe("==mark==");
    expect(copy("a `code` b", "code")).toBe("`code`");
    expect(copy("see [site](https://x.dev) now", "site")).toBe("[site](https://x.dev)");
    expect(copy("see [[Page|label]] now", "label")).toBe("[[Page|label]]");
  });

  it("covers nested formatting", () => {
    expect(copy("***both***", "both")).toBe("***both***");
  });

  it("leaves partial selections alone", () => {
    expect(copy("a **bold** b", "ol")).toBe("ol");
  });

  it("includes line markers before a selection that starts at the visible text", () => {
    expect(copy("# Title", "Title")).toBe("# Title");
    expect(copy("- [ ] task one", "task one")).toBe("- [ ] task one");
    expect(copy("> quoted", "quoted")).toBe("> quoted");
  });

  it("extends across lines", () => {
    expect(copy("# Title\n\nSome **bold**", "Title\n\nSome **bold")).toBe(
      "# Title\n\nSome **bold**",
    );
  });
});
