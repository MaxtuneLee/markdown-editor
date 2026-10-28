export type TableAlignment = "left" | "center" | "right" | null;

export interface TableCell {
  text: string;
  /** Offsets of the trimmed cell content within the table source. */
  from: number;
  to: number;
}

export interface TableRow {
  cells: TableCell[];
  /** Offsets of the row's line within the table source. */
  lineFrom: number;
  lineTo: number;
}

export interface ParsedTable {
  header: TableRow;
  alignments: TableAlignment[];
  rows: TableRow[];
}

const BACKSLASH = "\\";

function splitRow(line: string, lineFrom: number): TableCell[] {
  const cells: TableCell[] = [];
  let start = 0;
  let end = line.length;
  // Leading and trailing pipes are optional.
  const leading = /^\s*\|/.exec(line);
  if (leading) start = leading[0].length;
  const trailing = /\|\s*$/.exec(line.slice(start));
  if (trailing && !line.slice(0, start + trailing.index).endsWith(BACKSLASH)) {
    end = start + trailing.index;
  }

  let cellStart = start;
  const pushCell = (cellEnd: number): void => {
    const raw = line.slice(cellStart, cellEnd);
    const leadingSpace = raw.length - raw.trimStart().length;
    const text = raw.trim();
    const from = text ? cellStart + leadingSpace : cellStart + Math.min(1, raw.length);
    cells.push({ text, from: lineFrom + from, to: lineFrom + from + text.length });
  };
  for (let i = start; i < end; i++) {
    if (line[i] === BACKSLASH) {
      i++;
      continue;
    }
    if (line[i] === "|") {
      pushCell(i);
      cellStart = i + 1;
    }
  }
  pushCell(end);
  return cells;
}

function parseAlignment(cell: string): TableAlignment {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

export function parseTable(source: string): ParsedTable | null {
  const lines: { text: string; from: number }[] = [];
  let offset = 0;
  for (const text of source.split("\n")) {
    lines.push({ text, from: offset });
    offset += text.length + 1;
  }
  if (lines.length < 2) return null;
  const toRow = (line: { text: string; from: number }): TableRow => ({
    cells: splitRow(line.text, line.from),
    lineFrom: line.from,
    lineTo: line.from + line.text.length,
  });
  const delimiter = splitRow(lines[1].text, 0);
  if (!delimiter.every((cell) => /^:?-+:?$/.test(cell.text))) return null;
  return {
    header: toRow(lines[0]),
    alignments: delimiter.map((cell) => parseAlignment(cell.text)),
    rows: lines
      .slice(2)
      .filter((line) => line.text.trim() !== "")
      .map(toRow),
  };
}

export function escapeCellText(text: string): string {
  return text
    .replace(/\r?\n/g, " ")
    .replace(/(?<!\\)\|/g, "\\|")
    .trim();
}

export interface TableCellEdit {
  from: number;
  to: number;
  insert: string;
}

/**
 * The change, relative to the table source, that sets one cell's content. Row 0 is the header;
 * body rows start at 1. Missing trailing cells are appended.
 */
export function editTableCell(
  table: ParsedTable,
  row: number,
  column: number,
  text: string,
): TableCellEdit | null {
  const target = row === 0 ? table.header : table.rows[row - 1];
  if (!target) return null;
  const insert = escapeCellText(text);
  const cell = target.cells[column];
  if (cell) return { from: cell.from, to: cell.to, insert };

  const missing = column - target.cells.length;
  const padding = " |".repeat(missing);
  return { from: target.lineTo, to: target.lineTo, insert: `${padding} ${insert} |` };
}

/** A table as plain cell text, every row padded to the same number of columns. */
export interface TableModel {
  header: string[];
  alignments: TableAlignment[];
  rows: string[][];
}

export function tableModel(table: ParsedTable): TableModel {
  const columns = Math.max(
    table.alignments.length,
    table.header.cells.length,
    ...table.rows.map((row) => row.cells.length),
  );
  const pad = (cells: TableCell[]): string[] =>
    Array.from({ length: columns }, (_, index) => cells[index]?.text ?? "");
  return {
    header: pad(table.header.cells),
    alignments: Array.from({ length: columns }, (_, index) => table.alignments[index] ?? null),
    rows: table.rows.map((row) => pad(row.cells)),
  };
}

const WIDE_CHARACTER = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}]/u;

/** Monospace columns a string takes up, counting CJK and emoji as two. */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += WIDE_CHARACTER.test(char) ? 2 : 1;
  return width;
}

function delimiterCell(alignment: TableAlignment, width: number): string {
  const dashes = (count: number): string => "-".repeat(Math.max(count, 1));
  if (alignment === "center") return `:${dashes(width - 2)}:`;
  if (alignment === "left") return `:${dashes(width - 1)}`;
  if (alignment === "right") return `${dashes(width - 1)}:`;
  return dashes(width);
}

/** Markdown for a table, with columns padded so the source stays readable. */
export function serializeTable(model: TableModel): string {
  const widths = model.header.map((_, column) =>
    Math.max(3, ...[model.header, ...model.rows].map((row) => displayWidth(row[column] ?? ""))),
  );
  const line = (cells: string[]): string =>
    `| ${cells
      .map((cell, column) => cell + " ".repeat(widths[column] - displayWidth(cell)))
      .join(" | ")} |`;
  const delimiter = model.alignments.map((alignment, column) =>
    delimiterCell(alignment, widths[column]),
  );
  return [line(model.header), line(delimiter), ...model.rows.map(line)].join("\n");
}

/** Inserts empty body rows before `index`, where 0 is the first body row. */
export function insertRows(model: TableModel, index: number, count = 1): TableModel {
  const empty = Array.from({ length: count }, () => model.header.map(() => ""));
  const rows = [...model.rows];
  rows.splice(Math.max(0, Math.min(index, rows.length)), 0, ...empty);
  return { ...model, rows };
}

/** Removes body rows by index, where 0 is the first body row. */
export function deleteRows(model: TableModel, indices: readonly number[]): TableModel {
  const removed = new Set(indices);
  return { ...model, rows: model.rows.filter((_, index) => !removed.has(index)) };
}

/** Inserts an empty column before `index`. */
export function insertColumn(model: TableModel, index: number): TableModel {
  const at = Math.max(0, Math.min(index, model.header.length));
  const insert = <T>(cells: T[], value: T): T[] => [
    ...cells.slice(0, at),
    value,
    ...cells.slice(at),
  ];
  return {
    header: insert(model.header, ""),
    alignments: insert(model.alignments, null),
    rows: model.rows.map((row) => insert(row, "")),
  };
}

/** Removes columns by index. Returns null when no column is left. */
export function deleteColumns(model: TableModel, indices: readonly number[]): TableModel | null {
  const removed = new Set(indices);
  const keep = <T>(cells: T[]): T[] => cells.filter((_, index) => !removed.has(index));
  if (keep(model.header).length === 0) return null;
  return {
    header: keep(model.header),
    alignments: keep(model.alignments),
    rows: model.rows.map(keep),
  };
}

export function alignColumns(
  model: TableModel,
  indices: readonly number[],
  alignment: TableAlignment,
): TableModel {
  const columns = new Set(indices);
  return {
    ...model,
    alignments: model.alignments.map((current, index) =>
      columns.has(index) ? alignment : current,
    ),
  };
}

/** A rectangle of cells. Row 0 is the header; body rows start at 1. Bounds are inclusive. */
export interface CellRange {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function modelRow(model: TableModel, row: number): string[] | undefined {
  return row === 0 ? model.header : model.rows[row - 1];
}

function mapCells(
  model: TableModel,
  map: (text: string, row: number, column: number) => string,
): TableModel {
  const mapRow = (cells: string[], row: number): string[] =>
    cells.map((text, column) => map(text, row, column));
  return {
    ...model,
    header: mapRow(model.header, 0),
    rows: model.rows.map((cells, index) => mapRow(cells, index + 1)),
  };
}

/** The text of the cells in `range`, row by row. */
export function cellGrid(model: TableModel, range: CellRange): string[][] {
  const grid: string[][] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    grid.push((modelRow(model, row) ?? []).slice(range.left, range.right + 1));
  }
  return grid;
}

/** A grid as a markdown table whose first row is the header. */
export function gridToMarkdown(
  grid: string[][],
  alignments: readonly TableAlignment[] = [],
): string {
  const [header = [], ...rows] = grid;
  return serializeTable({
    header,
    alignments: header.map((_, column) => alignments[column] ?? null),
    rows,
  });
}

export function clearCells(model: TableModel, range: CellRange): TableModel {
  return mapCells(model, (text, row, column) =>
    row >= range.top && row <= range.bottom && column >= range.left && column <= range.right
      ? ""
      : text,
  );
}

/**
 * Writes `grid` into the table with its top-left cell at `at`, adding rows and columns when the
 * grid runs past the table's edge.
 */
export function fillCells(
  model: TableModel,
  at: { row: number; column: number },
  grid: string[][],
): TableModel {
  const width = Math.max(0, ...grid.map((row) => row.length));
  let next = model;
  while (next.header.length < at.column + width) next = insertColumn(next, next.header.length);
  const bodyRowsNeeded = at.row + grid.length - 1;
  if (next.rows.length < bodyRowsNeeded) {
    next = insertRows(next, next.rows.length, bodyRowsNeeded - next.rows.length);
  }
  return mapCells(next, (text, row, column) => {
    const value = grid[row - at.row]?.[column - at.column];
    return value === undefined ? text : escapeCellText(value);
  });
}

/**
 * Reads pasted text as a grid: a markdown table (header first), tab-separated lines from a
 * spreadsheet, or a single value.
 */
export function parseGrid(text: string): string[][] {
  const trimmed = text.replace(/\r?\n$/, "");
  const table = parseTable(trimmed);
  if (table) {
    const model = tableModel(table);
    return [model.header, ...model.rows];
  }
  return trimmed.split(/\r?\n/).map((line) => line.split("\t"));
}
