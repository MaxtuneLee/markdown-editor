import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { EditorView, type ViewUpdate } from "@codemirror/view";

import { findStableBlockEnd } from "./blocks";

const setFocused = StateEffect.define<boolean>();

/** Whether the editor has focus. Raw syntax is only revealed while it does. */
const focusField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFocused)) value = effect.value;
    }
    return value;
  },
});

const setPointerDown = StateEffect.define<boolean>();

interface RevealState {
  pointerDown: boolean;
  /** The selection whose lines show raw syntax, or null when none do. */
  selection: EditorSelection | null;
}

/**
 * Which lines reveal their syntax. While the mouse button is down this stays where it was, so
 * text doesn't shift under a drag and the selection ends where the pointer is. It catches up to
 * the real selection once the button is released.
 */
const revealField = StateField.define<RevealState>({
  create: () => ({ pointerDown: false, selection: null }),
  update(value, tr) {
    let { pointerDown, selection } = applyPointerEffects(value, tr);
    if (!pointerDown) selection = tr.state.field(focusField) ? tr.state.selection : null;
    else if (selection && tr.docChanged) selection = selection.map(tr.changes);
    return pointerDown === value.pointerDown && selection === value.selection
      ? value
      : { pointerDown, selection };
  },
});

function applyPointerEffects(value: RevealState, tr: Transaction): RevealState {
  let { pointerDown, selection } = value;
  for (const effect of tr.effects) {
    if (!effect.is(setPointerDown)) continue;
    pointerDown = effect.value;
    // A click into an unfocused editor reveals nothing until the button is released.
    if (pointerDown && !tr.startState.field(focusField)) selection = null;
  }
  return { pointerDown, selection };
}

const pointerTracking = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false;
    view.dispatch({ effects: setPointerDown.of(true) });
    const release = (): void => {
      window.removeEventListener("mouseup", release, true);
      window.removeEventListener("blur", release);
      // Wait until CodeMirror has applied the final mouse selection.
      setTimeout(() => {
        if (!view.dom.isConnected) return;
        // Sync focus too, in case the focus change hasn't been reported yet.
        view.dispatch({ effects: [setFocused.of(view.hasFocus), setPointerDown.of(false)] });
      });
    };
    window.addEventListener("mouseup", release, true);
    window.addEventListener("blur", release);
    return false;
  },
});

export const setStreaming = StateEffect.define<boolean>();

export interface StreamingState {
  active: boolean;
  /** Everything before this offset is complete blocks; the rest may still change. */
  stableEnd: number;
}

export const streamingField = StateField.define<StreamingState>({
  create: (state) => ({ active: false, stableEnd: state.doc.length }),
  update(value, tr) {
    let active = value.active;
    for (const effect of tr.effects) {
      if (effect.is(setStreaming)) active = effect.value;
    }
    if (!active) {
      return value.active || tr.docChanged ? { active, stableEnd: tr.state.doc.length } : value;
    }
    if (!tr.docChanged && active === value.active) return value;

    // Streams append, so scanning can resume from the last boundary. Any earlier edit rescans.
    let from = value.active ? value.stableEnd : 0;
    tr.changes.iterChangedRanges((fromA) => {
      if (fromA < from) from = 0;
    });
    const doc = tr.state.doc;
    const tail = doc.sliceString(from);
    return { active, stableEnd: from + findStableBlockEnd(tail) };
  },
});

export function editorStateExtensions(): Extension {
  return [
    focusField,
    revealField,
    streamingField,
    pointerTracking,
    EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
  ];
}

/** The selection whose lines currently show raw syntax, or null when none do. */
export function revealedSelection(state: EditorState): EditorSelection | null {
  return state.field(revealField, false)?.selection ?? null;
}

/** Whether any revealed selection range touches the lines spanned by `from`..`to`. */
export function isRangeActive(state: EditorState, from: number, to: number): boolean {
  const selection = revealedSelection(state);
  if (!selection) return false;
  const lineFrom = state.doc.lineAt(from).from;
  const lineTo = state.doc.lineAt(to).to;
  return selection.ranges.some((range) => range.from <= lineTo && range.to >= lineFrom);
}

/** Whether `to` is still inside the part of a stream that may change. */
export function isUnstable(state: EditorState, to: number): boolean {
  const streaming = state.field(streamingField, false);
  return Boolean(streaming?.active && to > streaming.stableEnd);
}

/** Whether any revealed selection range touches `from`..`to`, edges included. */
export function isNodeActive(state: EditorState, from: number, to: number): boolean {
  const selection = revealedSelection(state);
  return Boolean(selection?.ranges.some((range) => range.from <= to && range.to >= from));
}

/** Whether an update can change live-preview decorations. */
export function needsRedecoration(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.viewportChanged ||
    update.selectionSet ||
    syntaxTree(update.startState) !== syntaxTree(update.state) ||
    // Includes language loads and focus or pointer changes that reveal syntax.
    update.transactions.some((tr) => tr.effects.length > 0)
  );
}
