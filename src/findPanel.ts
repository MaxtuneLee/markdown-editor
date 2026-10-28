import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  search,
  searchKeymap,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorState, Extension } from "@codemirror/state";
import { keymap, type EditorView, type Panel, type ViewUpdate } from "@codemirror/view";

const MATCH_LIMIT = 1000;

function countMatches(state: EditorState, query: SearchQuery): { total: number; current: number } {
  if (!query.valid) return { total: 0, current: 0 };
  const cursor = query.getCursor(state);
  const selection = state.selection.main;
  let total = 0;
  let current = 0;
  for (let match = cursor.next(); !match.done; match = cursor.next()) {
    total++;
    if (match.value.from === selection.from && match.value.to === selection.to) current = total;
    if (total >= MATCH_LIMIT) break;
  }
  return { total, current };
}

function button(label: string, title: string, onPress: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "cm-md-find-button";
  element.textContent = label;
  element.title = title;
  element.setAttribute("aria-label", title);
  element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("click", onPress);
  return element;
}

function createFindPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-md-find";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "cm-md-find-input";
  input.placeholder = "Find";
  input.setAttribute("aria-label", "Find");
  // Search commands focus the element marked as the panel's main field.
  input.setAttribute("main-field", "true");
  input.value = getSearchQuery(view.state).search;

  const count = document.createElement("span");
  count.className = "cm-md-find-count";
  count.setAttribute("aria-live", "polite");

  const refreshCount = (state: EditorState): void => {
    const query = getSearchQuery(state);
    if (!query.search) {
      count.textContent = "";
      return;
    }
    const { total, current } = countMatches(state, query);
    const suffix = total >= MATCH_LIMIT ? "+" : "";
    count.textContent = total === 0 ? "No results" : `${current || "–"} of ${total}${suffix}`;
  };

  const commit = (): void => {
    const query = new SearchQuery({ search: input.value });
    if (!query.eq(getSearchQuery(view.state))) {
      view.dispatch({ effects: setSearchQuery.of(query) });
    }
  };

  input.addEventListener("input", () => {
    commit();
    findNext(view);
    input.focus();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      if (event.shiftKey) findPrevious(view);
      else findNext(view);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });

  dom.append(
    input,
    count,
    button("↑", "Previous match", () => findPrevious(view)),
    button("↓", "Next match", () => findNext(view)),
    button("×", "Close", () => {
      closeSearchPanel(view);
      view.focus();
    }),
  );

  return {
    dom,
    top: true,
    mount() {
      input.select();
      refreshCount(view.state);
    },
    update(update: ViewUpdate) {
      const query = getSearchQuery(update.state);
      if (query.search !== input.value && document.activeElement !== input) {
        input.value = query.search;
      }
      if (
        update.docChanged ||
        update.selectionSet ||
        !query.eq(getSearchQuery(update.startState))
      ) {
        refreshCount(update.state);
      }
    },
  };
}

export function findPanel(): Extension {
  return [search({ top: true, createPanel: createFindPanel }), keymap.of(searchKeymap)];
}
