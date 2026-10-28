import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { editorConfig } from "./config";

const setWikiStatus = StateEffect.define<{ target: string; exists: boolean }>();
const clearWikiStatus = StateEffect.define<null>();

/** Resolution results so far: true for targets that exist, false for missing ones. */
export const wikiStatusField = StateField.define<ReadonlyMap<string, boolean>>({
  create: () => new Map(),
  update(value, tr) {
    let next: Map<string, boolean> | null = null;
    for (const effect of tr.effects) {
      if (effect.is(clearWikiStatus)) {
        next = new Map();
        continue;
      }
      const current = next ?? value;
      if (!effect.is(setWikiStatus) || current.get(effect.value.target) === effect.value.exists) {
        continue;
      }
      next ??= new Map(value);
      next.set(effect.value.target, effect.value.exists);
    }
    return next ?? value;
  },
});

const pendingByView = new WeakMap<EditorView, Set<string>>();

/** Starts resolving `target` unless it is known or already in flight. */
export function requestWikiResolution(view: EditorView, target: string): void {
  const resolve = view.state.facet(editorConfig).wikiLinks?.resolve;
  if (!resolve || view.state.field(wikiStatusField).has(target)) return;
  let pending = pendingByView.get(view);
  if (!pending) {
    pending = new Set();
    pendingByView.set(view, pending);
  }
  if (pending.has(target)) return;
  pending.add(target);
  Promise.resolve()
    .then(() => resolve(target))
    .then(
      (exists) => {
        pending.delete(target);
        // The view may have been destroyed while resolving.
        if (view.dom.isConnected) {
          view.dispatch({ effects: setWikiStatus.of({ target, exists: Boolean(exists) }) });
        }
      },
      () => pending.delete(target),
    );
}

/** Forgets resolved targets so they are resolved again, for example after creating a page. */
export function invalidateWikiLinks(view: EditorView): void {
  pendingByView.delete(view);
  view.dispatch({ effects: clearWikiStatus.of(null) });
}

async function wikiCompletions(context: CompletionContext): Promise<CompletionResult | null> {
  const suggest = context.state.facet(editorConfig).wikiLinks?.suggest;
  const match = context.matchBefore(/\[\[[^[\]|\n]*/);
  if (!suggest || !match) return null;
  const from = match.from + 2;
  const suggestions = await suggest(match.text.slice(2));
  if (context.aborted) return null;
  const options = suggestions.map((suggestion): Completion => ({
    label: suggestion.target,
    displayLabel: suggestion.title ?? suggestion.target,
    detail: suggestion.detail,
    type: "text",
    apply: (view, _completion, applyFrom, applyTo) => {
      const closed = view.state.sliceDoc(applyTo, applyTo + 2) === "]]";
      const insert = closed ? suggestion.target : `${suggestion.target}]]`;
      view.dispatch({
        changes: { from: applyFrom, to: applyTo, insert },
        selection: { anchor: applyFrom + suggestion.target.length + 2 },
        userEvent: "input.complete",
      });
    },
  }));
  return { from, options, validFor: /^[^[\]|\n]*$/ };
}

export function wikiLinkExtensions(): Extension {
  return [
    wikiStatusField,
    autocompletion({ icons: false }),
    EditorState.languageData.of(() => [{ autocomplete: wikiCompletions }]),
  ];
}
