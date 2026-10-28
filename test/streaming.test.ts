import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { markdownEditorExtensions } from "../src/extensions";
import { streamingField } from "../src/state";
import { appendMarkdown, replaceDocument, setStreamingActive } from "../src/streaming";

const views: EditorView[] = [];

function createView(doc = ""): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, extensions: markdownEditorExtensions() }),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

describe("streaming", () => {
  it("moves the stable boundary forward as chunks arrive", () => {
    const view = createView();
    setStreamingActive(view, true);
    appendMarkdown(view, "# Title\n\n| a | b |\n| - | - |\n");
    expect(view.state.field(streamingField).stableEnd).toBe("# Title\n\n".length);
    appendMarkdown(view, "| 1 | 2 |\n\nNext");
    expect(view.state.field(streamingField).stableEnd).toBe(view.state.doc.length - 4);
  });

  it("marks everything stable when streaming ends", () => {
    const view = createView();
    setStreamingActive(view, true);
    appendMarkdown(view, "partial **bo");
    setStreamingActive(view, false);
    expect(view.state.field(streamingField)).toEqual({ active: false, stableEnd: 12 });
  });

  it("replaces the document with the smallest change", () => {
    const changes: [number, number, string][] = [];
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: "hello world",
        extensions: [
          markdownEditorExtensions(),
          EditorView.updateListener.of((update) => {
            update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
              changes.push([fromA, toA, inserted.toString()]);
            });
          }),
        ],
      }),
    });
    views.push(view);
    replaceDocument(view, "hello brave world");
    expect(view.state.doc.toString()).toBe("hello brave world");
    expect(changes).toEqual([[6, 6, "brave "]]);
  });
});
