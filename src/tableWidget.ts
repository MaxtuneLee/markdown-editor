import { redo, undo } from "@codemirror/commands";
import { EditorView, WidgetType } from "@codemirror/view";

import { renderInlineMarkdown } from "./inlineHtml";
import {
  alignColumns,
  cellGrid,
  clearCells,
  deleteColumns,
  deleteRows,
  editTableCell,
  escapeCellText,
  fillCells,
  gridToMarkdown,
  insertColumn,
  insertRows,
  parseGrid,
  serializeTable,
  tableModel,
  type CellRange,
  type ParsedTable,
  type TableAlignment,
  type TableModel,
} from "./table";

type LineKind = "row" | "column";

interface CellAddress {
  /** 0 is the header row; body rows start at 1. */
  row: number;
  column: number;
}

type TableSelection =
  | {
      kind: LineKind;
      /** Body row indices (0 is the first body row) or column indices. */
      indices: Set<number>;
      anchor: number;
    }
  | { kind: "cells"; anchor: CellAddress; focus: CellAddress };

type LineSelection = Extract<TableSelection, { kind: LineKind }>;
type CellSelection = Extract<TableSelection, { kind: "cells" }>;

interface Drag {
  kind: TableSelection["kind"];
  /** The cell the press started on, edited if the pointer never leaves it. */
  cell: HTMLElement | null;
  moved: boolean;
}

function rangeOf(anchor: CellAddress, focus: CellAddress): CellRange {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    right: Math.max(anchor.column, focus.column),
  };
}

function inRange(range: CellRange, { row, column }: CellAddress): boolean {
  return row >= range.top && row <= range.bottom && column >= range.left && column <= range.right;
}

function span(from: number, to: number): number[] {
  const start = Math.min(from, to);
  return Array.from({ length: Math.abs(to - from) + 1 }, (_, index) => start + index);
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

const controllers = new WeakMap<HTMLElement, TableController>();

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toolButton(label: string, title: string, onPress: () => void): HTMLButtonElement {
  const button = element("button", "cm-md-table-tool", label);
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  // Keep focus where it is; the action reads the current selection.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", onPress);
  return button;
}

function cellAddress(cell: HTMLElement): CellAddress {
  const [row, column] = (cell.dataset.cell ?? "0:0").split(":").map(Number);
  return { row, column };
}

function plural(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

class TableController {
  readonly dom: HTMLElement;
  private widget: TableWidget;
  private model: TableModel;
  private selection: TableSelection | null = null;
  private lastPosition = 0;
  private readonly toolbar: HTMLElement;
  private readonly table: HTMLTableElement;
  private readonly cellSources = new WeakMap<HTMLElement, string>();

  constructor(
    readonly view: EditorView,
    widget: TableWidget,
  ) {
    this.widget = widget;
    this.model = tableModel(widget.table);
    this.dom = element("div", "cm-md-table-block");
    // Focusable so keys and clipboard events reach a selection of cells, rows or columns.
    this.dom.tabIndex = -1;
    this.toolbar = element("div", "cm-md-table-toolbar");
    this.toolbar.setAttribute("role", "toolbar");
    this.toolbar.setAttribute("aria-label", "Table");
    this.toolbar.hidden = true;
    const scroller = element("div", "cm-md-table-wrap");
    this.table = element("table", "cm-md-table");
    scroller.append(this.table);
    this.dom.append(this.toolbar, scroller);
    this.renderTable();
    this.attachEvents();
    controllers.set(this.dom, this);
  }

  private get editable(): boolean {
    return this.view.state.facet(EditorView.editable) && !this.view.state.readOnly;
  }

  /** Reuses the DOM for a widget with the same shape, so an edited cell keeps focus. */
  update(widget: TableWidget): boolean {
    const next = tableModel(widget.table);
    const sameShape =
      // Gutters and editable cells are only built when the table is rendered.
      widget.cellsEditable === this.widget.cellsEditable &&
      next.header.length === this.model.header.length &&
      next.rows.length === this.model.rows.length &&
      next.alignments.every((alignment, index) => alignment === this.model.alignments[index]);
    if (!sameShape) return false;
    this.widget = widget;
    this.model = next;
    for (const cell of this.cells()) {
      if (cell === this.view.root.activeElement) continue;
      this.renderCell(cell, this.cellText(cellAddress(cell)));
    }
    return true;
  }

  private cells(): HTMLElement[] {
    return Array.from(this.table.querySelectorAll<HTMLElement>("[data-cell]"));
  }

  private cellText({ row, column }: CellAddress): string {
    return (row === 0 ? this.model.header : this.model.rows[row - 1])?.[column] ?? "";
  }

  private renderCell(cell: HTMLElement, raw: string): void {
    this.cellSources.set(cell, raw);
    cell.innerHTML = renderInlineMarkdown(raw);
  }

  private renderTable(): void {
    const editable = this.editable;
    const head = document.createElement("thead");
    if (editable) head.append(this.columnGutter());
    head.append(this.row(0, "th", editable));
    const body = document.createElement("tbody");
    this.model.rows.forEach((_, index) => body.append(this.row(index + 1, "td", editable)));
    this.table.replaceChildren(head, body);
  }

  private columnGutter(): HTMLTableRowElement {
    const tr = element("tr", "cm-md-col-gutter");
    const corner = element("td", "cm-md-gutter-cell cm-md-corner");
    corner.append(this.insertButton("column", 0, "Insert column at start"));
    tr.append(corner);
    this.model.header.forEach((_, column) => {
      const cell = element("td", "cm-md-gutter-cell");
      const handle = element("button", "cm-md-col-handle");
      handle.type = "button";
      handle.dataset.column = String(column);
      handle.setAttribute("aria-label", `Select column ${column + 1}`);
      cell.append(handle, this.insertButton("column", column + 1, "Insert column after"));
      tr.append(cell);
    });
    return tr;
  }

  private row(row: number, tag: "th" | "td", editable: boolean): HTMLTableRowElement {
    const tr = document.createElement("tr");
    if (editable) {
      const gutter = element(tag, "cm-md-gutter-cell cm-md-row-gutter");
      if (row > 0) {
        const handle = element("button", "cm-md-row-handle");
        handle.type = "button";
        handle.dataset.row = String(row - 1);
        handle.setAttribute("aria-label", `Select row ${row}`);
        gutter.append(handle);
      }
      gutter.append(this.insertButton("row", row, "Insert row below"));
      tr.append(gutter);
    }
    this.model.header.forEach((_, column) => {
      const cell = document.createElement(tag);
      cell.dataset.cell = `${row}:${column}`;
      const alignment = this.model.alignments[column];
      if (alignment) cell.style.textAlign = alignment;
      if (editable) {
        cell.contentEditable = "plaintext-only";
        cell.spellcheck = false;
        // Focusable even where plaintext-only isn't recognized; Tab is handled per cell anyway.
        cell.tabIndex = -1;
      }
      this.renderCell(cell, this.cellText({ row, column }));
      tr.append(cell);
    });
    return tr;
  }

  private insertButton(kind: LineKind, index: number, title: string): HTMLButtonElement {
    const button = toolButton("+", title, () => {
      if (kind === "row")
        this.apply((model) => insertRows(model, index), { row: index + 1, column: 0 });
      else this.apply((model) => insertColumn(model, index), { row: 0, column: index });
    });
    button.className = `cm-md-table-insert cm-md-insert-${kind}`;
    return button;
  }

  /** Selects a row or column from its handle: plain, Shift for a range, Ctrl/Cmd to toggle. */
  private selectLine(kind: LineKind, index: number, event: MouseEvent): void {
    const current = this.selection?.kind === kind ? (this.selection as LineSelection) : null;
    const extend = event.shiftKey || event.metaKey || event.ctrlKey;
    const next =
      current && extend
        ? extendLineSelection(current, index, event.shiftKey)
        : { kind, indices: new Set([index]), anchor: index };
    this.selection = next.indices.size > 0 ? next : null;
    this.renderSelection();
  }

  private selectCells(anchor: CellAddress, focus: CellAddress): void {
    this.finishEditing();
    this.selection = { kind: "cells", anchor, focus };
    this.renderSelection();
    this.dom.focus({ preventScroll: true });
  }

  /** Commits and leaves the cell being edited, if any. */
  private finishEditing(): void {
    const editing = this.dom.querySelector<HTMLElement>(".cm-md-cell-editing");
    if (!editing) return;
    // Commit once here; the class check stops the focusout that follows from committing the
    // rendered text again.
    editing.classList.remove("cm-md-cell-editing");
    this.commit(editing);
  }

  private clearSelection(): void {
    if (!this.selection) return;
    this.selection = null;
    this.renderSelection();
  }

  private isSelected(address: CellAddress): boolean {
    const selection = this.selection;
    if (!selection) return false;
    if (selection.kind === "cells")
      return inRange(rangeOf(selection.anchor, selection.focus), address);
    if (selection.kind === "row") return address.row > 0 && selection.indices.has(address.row - 1);
    return selection.indices.has(address.column);
  }

  private renderSelection(): void {
    const selection = this.selection;
    for (const cell of this.cells()) {
      cell.classList.toggle("cm-md-cell-selected", this.isSelected(cellAddress(cell)));
    }
    for (const handle of this.table.querySelectorAll<HTMLElement>(".cm-md-row-handle")) {
      const active = selection?.kind === "row" && selection.indices.has(Number(handle.dataset.row));
      handle.classList.toggle("cm-md-handle-active", active);
    }
    for (const handle of this.table.querySelectorAll<HTMLElement>(".cm-md-col-handle")) {
      const index = Number(handle.dataset.column);
      const active = selection?.kind === "column" && selection.indices.has(index);
      handle.classList.toggle("cm-md-handle-active", active);
    }
    this.renderToolbar();
  }

  private renderToolbar(): void {
    const selection = this.selection;
    this.toolbar.hidden = !selection;
    if (!selection) {
      this.toolbar.replaceChildren();
    } else if (selection.kind === "cells") {
      this.toolbar.replaceChildren(...this.cellTools(rangeOf(selection.anchor, selection.focus)));
    } else {
      const indices = [...selection.indices].sort((a, b) => a - b);
      const tools = selection.kind === "row" ? this.rowTools(indices) : this.columnTools(indices);
      this.toolbar.replaceChildren(...tools);
    }
  }

  private label(text: string): HTMLElement {
    return element("span", "cm-md-table-toolbar-label", text);
  }

  private alignTools(columns: number[]): HTMLButtonElement[] {
    const align = (alignment: TableAlignment, text: string, title: string): HTMLButtonElement =>
      toolButton(text, title, () => this.apply((model) => alignColumns(model, columns, alignment)));
    return [
      align("left", "Left", "Align left"),
      align("center", "Center", "Align center"),
      align("right", "Right", "Align right"),
    ];
  }

  private rowTools(indices: number[]): HTMLElement[] {
    const first = indices[0];
    const last = indices[indices.length - 1];
    const count = plural(indices.length, "row");
    return [
      this.label(count),
      toolButton("Add above", "Insert a row above", () =>
        this.apply((model) => insertRows(model, first), { row: first + 1, column: 0 }),
      ),
      toolButton("Add below", "Insert a row below", () =>
        this.apply((model) => insertRows(model, last + 1), { row: last + 2, column: 0 }),
      ),
      toolButton("Delete", `Delete ${count}`, () => this.deleteSelection()),
    ];
  }

  private columnTools(indices: number[]): HTMLElement[] {
    const first = indices[0];
    const last = indices[indices.length - 1];
    const count = plural(indices.length, "column");
    return [
      this.label(count),
      ...this.alignTools(indices),
      toolButton("Add left", "Insert a column to the left", () =>
        this.apply((model) => insertColumn(model, first), { row: 0, column: first }),
      ),
      toolButton("Add right", "Insert a column to the right", () =>
        this.apply((model) => insertColumn(model, last + 1), { row: 0, column: last + 1 }),
      ),
      toolButton("Delete", `Delete ${count}`, () => this.deleteSelection()),
    ];
  }

  private cellTools(range: CellRange): HTMLElement[] {
    const columns = span(range.left, range.right);
    // The header row can't be deleted, only body rows.
    const rows = span(Math.max(range.top, 1), range.bottom)
      .filter((row) => row >= 1)
      .map((row) => row - 1);
    const size = `${range.bottom - range.top + 1} × ${columns.length}`;
    const tools: HTMLElement[] = [
      this.label(size),
      toolButton("Clear", "Clear the selected cells", () => this.clearSelectedCells()),
      ...this.alignTools(columns),
    ];
    if (range.bottom >= 1) {
      tools.push(
        toolButton("Delete rows", `Delete ${plural(rows.length, "row")}`, () =>
          this.apply((model) => deleteRows(model, rows)),
        ),
      );
    }
    tools.push(
      toolButton("Delete columns", `Delete ${plural(columns.length, "column")}`, () =>
        this.apply((model) => deleteColumns(model, columns)),
      ),
    );
    return tools;
  }

  private clearSelectedCells(): void {
    const selection = this.selection;
    if (selection?.kind !== "cells") return;
    const range = rangeOf(selection.anchor, selection.focus);
    this.apply((model) => clearCells(model, range), undefined, true);
  }

  private deleteSelection(): void {
    const selection = this.selection;
    if (!selection) return;
    if (selection.kind === "cells") {
      this.clearSelectedCells();
      return;
    }
    const indices = [...selection.indices];
    if (selection.kind === "row") this.apply((model) => deleteRows(model, indices));
    else this.apply((model) => deleteColumns(model, indices));
  }

  /** The selection as a markdown table, or null without a selection. */
  private selectionMarkdown(): string | null {
    const selection = this.selection;
    if (!selection) return null;
    if (selection.kind === "cells") return this.cellsMarkdown(selection);
    return this.linesMarkdown(selection);
  }

  private cellsMarkdown(selection: CellSelection): string {
    const range = rangeOf(selection.anchor, selection.focus);
    const whole =
      range.top === 0 &&
      range.bottom === this.model.rows.length &&
      range.left === 0 &&
      range.right === this.model.header.length - 1;
    if (whole) return this.widget.source;
    const alignments = this.model.alignments.slice(range.left, range.right + 1);
    return gridToMarkdown(cellGrid(this.model, range), alignments);
  }

  private linesMarkdown(selection: LineSelection): string | null {
    // All rows or all columns is the whole table, copied exactly as written.
    const total = selection.kind === "row" ? this.model.rows.length : this.model.header.length;
    if (selection.indices.size === total) return this.widget.source;
    if (selection.kind === "row") {
      const rows = this.model.rows.filter((_, index) => selection.indices.has(index));
      return serializeTable({ ...this.model, rows });
    }
    const others = this.model.header
      .map((_, index) => index)
      .filter((index) => !selection.indices.has(index));
    const subset = deleteColumns(this.model, others);
    return subset ? serializeTable(subset) : null;
  }

  /**
   * Pastes a grid with its top-left corner at the selection's top-left cell. A single value
   * fills every selected cell, as in a spreadsheet.
   */
  private paste(text: string, at: CellAddress, range: CellRange | null): void {
    const grid = parseGrid(text);
    const single = grid.length === 1 && grid[0].length === 1;
    const filled =
      single && range
        ? span(range.top, range.bottom).map(() =>
            span(range.left, range.right).map(() => grid[0][0]),
          )
        : grid;
    const width = Math.max(...filled.map((row) => row.length));
    const focus = { row: at.row + filled.length - 1, column: at.column + width - 1 };
    this.apply((model) => fillCells(model, at, filled), undefined, true);
    this.restoreSelection({ kind: "cells", anchor: at, focus });
  }

  /**
   * Replaces the whole table with what `build` returns (or removes it on null), then focuses a
   * cell if asked. A cell being edited is committed first, and `build` sees the result.
   */
  private apply(
    build: (model: TableModel) => TableModel | null,
    focus?: CellAddress,
    keepSelection = false,
  ): void {
    if (!this.editable) return;
    this.finishEditing();
    const selection = keepSelection ? this.selection : null;
    const from = this.replaceTable(build(this.model));
    if (from === null) return;
    if (focus) focusTableCell(this.view, from, focus);
    else if (selection) this.restoreSelection(selection);
    else this.view.focus();
  }

  /**
   * Swaps the table's source for `next`, or removes the table on null. Returns where the table
   * starts, or null when the document no longer holds this table's source there.
   */
  private replaceTable(next: TableModel | null): number | null {
    const { view } = this;
    const source = this.widget.source;
    const from = this.position();
    if (from === null) return null;
    this.lastPosition = from;
    if (view.state.sliceDoc(from, from + source.length) !== source) return null;
    let to = from + source.length;
    if (!next && view.state.sliceDoc(to, to + 1) === "\n") to += 1;
    view.dispatch({
      changes: { from, to, insert: next ? serializeTable(next) : "" },
      userEvent: "input.table",
    });
    return from;
  }

  /** Reapplies a selection to this table's current DOM, which an edit may have replaced. */
  private restoreSelection(selection: TableSelection): void {
    const from = this.position();
    const controller = from === null ? findTable(this.view, this.lastPosition) : this;
    controller?.setSelection(selection);
  }

  setSelection(selection: TableSelection): void {
    this.selection = selection;
    this.renderSelection();
    this.dom.focus({ preventScroll: true });
  }

  /** Where the table starts in the document, or null once the editor has dropped this DOM. */
  private position(): number | null {
    if (!this.view.contentDOM.contains(this.dom)) return null;
    return this.view.posAtDOM(this.dom);
  }

  private commit(cell: HTMLElement): void {
    const raw = this.cellSources.get(cell) ?? "";
    const text = escapeCellText(cell.textContent ?? "");
    const { view } = this;
    const source = this.widget.source;
    const from = this.position();
    const address = cellAddress(cell);
    const edit =
      text !== raw && this.editable
        ? editTableCell(this.widget.table, address.row, address.column, text)
        : null;
    if (!edit || from === null || view.state.sliceDoc(from, from + source.length) !== source) {
      this.renderCell(cell, raw);
      return;
    }
    this.renderCell(cell, text);
    view.dispatch({
      changes: { from: from + edit.from, to: from + edit.to, insert: edit.insert },
      userEvent: "input.table",
    });
  }

  private onCellKey(cell: HTMLElement, event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      const { row, column } = cellAddress(cell);
      // Commit this cell first so the inserted row builds on the latest source.
      cell.blur();
      this.apply((model) => insertRows(model, row), { row: row + 1, column });
    } else if (event.key === "Escape") {
      event.preventDefault();
      cell.textContent = this.cellSources.get(cell) ?? "";
      this.view.focus();
    } else {
      const step = cellStep(event, this.model.header.length);
      if (step === null) return;
      event.preventDefault();
      const cells = this.cells();
      focusCell(cells[cells.indexOf(cell) + step], this.view);
    }
  }

  private attachEvents(): void {
    const { dom } = this;
    dom.addEventListener("focusin", (event) => {
      const cell = event.target as HTMLElement;
      if (!cell.dataset.cell) return;
      this.clearSelection();
      cell.classList.add("cm-md-cell-editing");
      cell.textContent = this.cellSources.get(cell) ?? "";
      // Swapping rendered text for the source drops the caret somewhere arbitrary.
      placeCaretAtEnd(cell);
    });
    dom.addEventListener("focusout", (event) => {
      const cell = event.target as HTMLElement;
      if (cell.dataset.cell && cell.classList.contains("cm-md-cell-editing")) {
        cell.classList.remove("cm-md-cell-editing");
        this.commit(cell);
      }
      if (!(event.relatedTarget instanceof Node) || !dom.contains(event.relatedTarget)) {
        this.clearSelection();
      }
    });
    dom.addEventListener("mousedown", (event) => this.onMouseDown(event));
    dom.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement;
      if (target.dataset.cell) this.onCellKey(target, event);
      else if (this.selection) this.onSelectionKey(event);
    });
    dom.addEventListener("copy", (event) => this.onClipboard(event, "copy"));
    dom.addEventListener("cut", (event) => this.onClipboard(event, "cut"));
    dom.addEventListener("paste", (event) => this.onClipboard(event, "paste"));
  }

  /**
   * Pressing on a cell and dragging selects a range of cells; releasing on the same cell edits
   * it. Handles select rows or columns, and dragging across handles extends the selection.
   */
  private onMouseDown(event: MouseEvent): void {
    if (event.button !== 0 || !this.editable) return;
    const target = event.target as HTMLElement;
    if (target.closest(".cm-md-table-insert, .cm-md-table-toolbar")) return;
    const handle = target.closest<HTMLElement>(".cm-md-row-handle, .cm-md-col-handle");
    if (handle) this.pressHandle(handle, event);
    else this.pressCell(target.closest<HTMLElement>("[data-cell]"), event);
  }

  private pressHandle(handle: HTMLElement, event: MouseEvent): void {
    event.preventDefault();
    this.finishEditing();
    const kind: LineKind = handle.dataset.row !== undefined ? "row" : "column";
    this.selectLine(kind, Number(handle.dataset.row ?? handle.dataset.column), event);
    this.dom.focus({ preventScroll: true });
    this.startDrag({ kind, cell: null, moved: false });
  }

  private pressCell(cell: HTMLElement | null, event: MouseEvent): void {
    // Inside the cell being edited, the press places the caret or selects text as usual.
    if (!cell || cell.classList.contains("cm-md-cell-editing")) return;
    event.preventDefault();
    const address = cellAddress(cell);
    if (event.shiftKey) {
      this.selectCells(this.cellAnchor() ?? address, address);
      return;
    }
    this.startDrag({ kind: "cells", cell, moved: false });
  }

  /** The cell a Shift-click extends from: the selected range's anchor or the edited cell. */
  private cellAnchor(): CellAddress | null {
    if (this.selection?.kind === "cells") return this.selection.anchor;
    const editing = this.dom.querySelector<HTMLElement>(".cm-md-cell-editing");
    return editing ? cellAddress(editing) : null;
  }

  private startDrag(drag: Drag): void {
    const anchor = drag.cell ? cellAddress(drag.cell) : null;
    const lineAnchor =
      this.selection && this.selection.kind !== "cells" ? this.selection.anchor : 0;
    const move = (event: MouseEvent): void => {
      const under = document.elementFromPoint(event.clientX, event.clientY);
      if (!(under instanceof HTMLElement) || !this.dom.contains(under)) return;
      const address = hoveredAddress(under);
      if (address) this.dragTo(drag, anchor, lineAnchor, address);
    };
    const up = (): void => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      // A press that never left its cell is a click: edit that cell.
      if (drag.kind === "cells" && !drag.moved && drag.cell) focusCell(drag.cell, this.view);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  private dragTo(
    drag: Drag,
    anchor: CellAddress | null,
    lineAnchor: number,
    address: CellAddress,
  ): void {
    if (drag.kind === "cells") {
      if (!anchor) return;
      if (!drag.moved && address.row === anchor.row && address.column === anchor.column) return;
      drag.moved = true;
      this.selectCells(anchor, address);
    } else if (drag.kind === "row") {
      if (address.row > 0) this.extendLines("row", lineAnchor, address.row - 1);
    } else {
      this.extendLines("column", lineAnchor, address.column);
    }
  }

  private extendLines(kind: LineKind, anchor: number, index: number): void {
    const indices = new Set(span(anchor, index));
    if (this.selection?.kind === kind && sameSet(this.selection.indices, indices)) return;
    this.selection = { kind, indices, anchor };
    this.renderSelection();
  }

  private onSelectionKey(event: KeyboardEvent): void {
    const selection = this.selection;
    if (!selection) return;
    if (isHistoryKey(event)) {
      event.preventDefault();
      this.runHistory(event, selection);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.deleteSelection();
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.clearSelection();
      this.view.focus();
    } else if (selection.kind === "cells") {
      this.onCellSelectionKey(selection, event);
    }
  }

  // The editor's keymap doesn't see keys pressed inside the table, so undo runs here.
  private runHistory(event: KeyboardEvent, selection: TableSelection): void {
    this.lastPosition = this.position() ?? this.lastPosition;
    if (event.key.toLowerCase() === "y" || event.shiftKey) redo(this.view);
    else undo(this.view);
    this.restoreSelection(selection);
  }

  private onCellSelectionKey(selection: CellSelection, event: KeyboardEvent): void {
    if (event.key in ARROWS) {
      event.preventDefault();
      const [dRow, dColumn] = ARROWS[event.key];
      const clamp = (value: number, max: number): number => Math.max(0, Math.min(value, max));
      const focus = {
        row: clamp(selection.focus.row + dRow, this.model.rows.length),
        column: clamp(selection.focus.column + dColumn, this.model.header.length - 1),
      };
      this.selectCells(event.shiftKey ? selection.anchor : focus, focus);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const { row, column } = selection.focus;
      focusCell(
        this.dom.querySelector<HTMLElement>(`[data-cell="${row}:${column}"]`) ?? undefined,
        this.view,
      );
    }
  }

  private onPaste(event: ClipboardEvent, text: string, target: HTMLElement): void {
    const selection = this.selection;
    if (target.dataset.cell) {
      // Plain text pastes into the cell; a grid spreads out from it.
      if (!/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return;
      event.preventDefault();
      this.paste(text, cellAddress(target), null);
    } else if (selection?.kind === "cells") {
      event.preventDefault();
      const range = rangeOf(selection.anchor, selection.focus);
      this.paste(text, { row: range.top, column: range.left }, range);
    }
  }

  private onClipboard(event: ClipboardEvent, action: "copy" | "cut" | "paste"): void {
    const data = event.clipboardData;
    const target = event.target as HTMLElement;
    if (!data) return;
    if (action === "paste") {
      this.onPaste(event, data.getData("text/plain"), target);
      return;
    }
    if (target.dataset.cell) return;
    const markdown = this.selectionMarkdown();
    if (!markdown) return;
    event.preventDefault();
    data.setData("text/plain", markdown);
    if (action === "cut") this.deleteSelection();
  }
}

function extendLineSelection(
  selection: LineSelection,
  index: number,
  range: boolean,
): LineSelection {
  if (range) {
    selection.indices = new Set(span(selection.anchor, index));
    return selection;
  }
  if (selection.indices.has(index)) selection.indices.delete(index);
  else selection.indices.add(index);
  selection.anchor = index;
  return selection;
}

/** How far Tab, Shift+Tab or Enter moves from a cell, or null for other keys. */
function cellStep(event: KeyboardEvent, columns: number): number | null {
  if (event.key === "Tab") return event.shiftKey ? -1 : 1;
  if (event.key === "Enter" && !event.shiftKey) return columns;
  return null;
}

function isHistoryKey(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  return (event.metaKey || event.ctrlKey) && (key === "z" || key === "y");
}

function sameSet(a: Set<number>, b: Set<number>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

/** The cell, or the row and column of a handle, under the pointer. */
function hoveredAddress(under: HTMLElement): CellAddress | null {
  const cell = under.closest<HTMLElement>("[data-cell]");
  if (cell) return cellAddress(cell);
  const columnHandle = under.closest<HTMLElement>(".cm-md-col-gutter .cm-md-gutter-cell");
  const column = columnHandle?.querySelector<HTMLElement>(".cm-md-col-handle")?.dataset.column;
  if (column !== undefined) return { row: 0, column: Number(column) };
  const rowCell = under.closest("tr")?.querySelector<HTMLElement>("[data-cell]");
  return rowCell ? { row: cellAddress(rowCell).row, column: 0 } : null;
}

function focusCell(cell: HTMLElement | undefined, view: EditorView): void {
  if (!cell) {
    view.focus();
    return;
  }
  cell.focus();
  placeCaretAtEnd(cell);
}

function placeCaretAtEnd(cell: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** The controller of the table that starts at `pos`, after the editor has redrawn it. */
function findTable(view: EditorView, pos: number): TableController | null {
  for (const block of view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-table-block")) {
    if (view.posAtDOM(block) === pos) return controllers.get(block) ?? null;
  }
  return null;
}

/** Focuses a cell of the table that starts at `pos`, after the editor has redrawn it. */
function focusTableCell(view: EditorView, pos: number, { row, column }: CellAddress): void {
  const cell = findTable(view, pos)?.dom.querySelector<HTMLElement>(
    `[data-cell="${row}:${column}"]`,
  );
  if (cell) focusCell(cell, view);
}

export class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly table: ParsedTable,
    // Not `editable`: that name is WidgetType's flag for leaving the widget's DOM editable, which
    // would make the editor's content, not a cell, the editing host of a cell's caret.
    readonly cellsEditable: boolean,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.source === this.source && other.cellsEditable === this.cellsEditable;
  }

  get estimatedHeight(): number {
    return (this.table.rows.length + 1) * 36 + 18;
  }

  toDOM(view: EditorView): HTMLElement {
    return new TableController(view, this).dom;
  }

  updateDOM(dom: HTMLElement): boolean {
    return controllers.get(dom)?.update(this) ?? false;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
