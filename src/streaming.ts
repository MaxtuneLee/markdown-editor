import { Annotation, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { setStreaming, streamingField } from "./state";

/** Marks transactions that came from outside the editor, such as a new `value` or a stream. */
export const externalChange = Annotation.define<boolean>();

const FOLLOW_THRESHOLD = 48;

function isNearEnd(view: EditorView): boolean {
  const { scrollDOM } = view;
  if (scrollDOM.scrollHeight > scrollDOM.clientHeight + 1) {
    return scrollDOM.scrollHeight - scrollDOM.scrollTop - scrollDOM.clientHeight < FOLLOW_THRESHOLD;
  }
  // The editor grows with its content, so the page scrolls instead.
  const rect = view.dom.getBoundingClientRect();
  return rect.bottom - window.innerHeight < FOLLOW_THRESHOLD;
}

/**
 * Replaces the document with `text` through the smallest single change, so appended text stays
 * an insertion at the end and decorations elsewhere are left alone.
 */
export function replaceDocument(view: EditorView, text: string): void {
  const current = view.state.doc.toString();
  if (current === text) return;
  let start = 0;
  const minLength = Math.min(current.length, text.length);
  while (start < minLength && current.charCodeAt(start) === text.charCodeAt(start)) start++;
  let endCurrent = current.length;
  let endText = text.length;
  while (
    endCurrent > start &&
    endText > start &&
    current.charCodeAt(endCurrent - 1) === text.charCodeAt(endText - 1)
  ) {
    endCurrent--;
    endText--;
  }
  const follow = view.state.field(streamingField, false)?.active && isNearEnd(view);
  view.dispatch({
    changes: { from: start, to: endCurrent, insert: text.slice(start, endText) },
    annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
    effects: follow ? EditorView.scrollIntoView(endText, { y: "end" }) : [],
  });
}

/** Appends a chunk at the end of the document, keeping the end in view if it was in view. */
export function appendMarkdown(view: EditorView, chunk: string): void {
  if (!chunk) return;
  const end = view.state.doc.length;
  const follow = isNearEnd(view);
  view.dispatch({
    changes: { from: end, insert: chunk },
    annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
    effects: follow ? EditorView.scrollIntoView(end + chunk.length, { y: "end" }) : [],
  });
}

/**
 * While streaming, the unfinished block at the end stays as source, so a half-written table or
 * diagram doesn't flicker between rendered and raw.
 */
export function setStreamingActive(view: EditorView, active: boolean): void {
  if (view.state.field(streamingField, false)?.active === active) return;
  view.dispatch({ effects: setStreaming.of(active) });
}

export interface StreamWriter {
  /** Queues a chunk. Chunks are applied together once per animation frame. */
  write(chunk: string): void;
  /** Applies queued chunks now. */
  flush(): void;
  /** Applies queued chunks and ends streaming. */
  close(): void;
}

export function createStreamWriter(view: EditorView): StreamWriter {
  let pending = "";
  let frame = 0;
  const flush = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    const chunk = pending;
    pending = "";
    appendMarkdown(view, chunk);
  };
  setStreamingActive(view, true);
  return {
    write(chunk) {
      pending += chunk;
      frame ||= requestAnimationFrame(flush);
    },
    flush,
    close() {
      flush();
      setStreamingActive(view, false);
    },
  };
}
