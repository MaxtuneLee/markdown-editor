import { describe, expect, it } from "vite-plus/test";

import {
  alignColumns,
  cellGrid,
  clearCells,
  deleteColumns,
  deleteRows,
  editTableCell,
  fillCells,
  gridToMarkdown,
  insertColumn,
  insertRows,
  parseGrid,
  parseTable,
  serializeTable,
  tableModel,
} from "../src/table";

function apply(source: string, edit: { from: number; to: number; insert: string }): string {
  return source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
}

describe("parseTable", () => {
  it("reads cells, alignment and escaped pipes", () => {
    const table = parseTable("| Name | Note |\n|:--|--:|\n| a \\| b | `x` |");
    expect(table?.header.cells.map((cell) => cell.text)).toEqual(["Name", "Note"]);
    expect(table?.alignments).toEqual(["left", "right"]);
    expect(table?.rows[0].cells.map((cell) => cell.text)).toEqual(["a \\| b", "`x`"]);
  });

  it("accepts tables without outer pipes", () => {
    const table = parseTable("a | b\n--- | ---\n1 | 2");
    expect(table?.rows[0].cells.map((cell) => cell.text)).toEqual(["1", "2"]);
  });

  it("rejects a missing delimiter row", () => {
    expect(parseTable("| a |\n| b |")).toBeNull();
  });
});

describe("editTableCell", () => {
  const source = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 |  |";

  it("replaces only the edited cell", () => {
    const table = parseTable(source);
    const edit = table && editTableCell(table, 1, 1, "two");
    expect(edit && apply(source, edit)).toBe("| a | b |\n| --- | --- |\n| 1 | two |\n| 3 |  |");
  });

  it("fills an empty cell and escapes pipes", () => {
    const table = parseTable(source);
    const edit = table && editTableCell(table, 2, 1, "x|y");
    expect(edit && apply(source, edit)).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | x\\|y |");
  });

  it("edits the header", () => {
    const table = parseTable(source);
    const edit = table && editTableCell(table, 0, 0, "Name");
    expect(edit && apply(source, edit).split("\n")[0]).toBe("| Name | b |");
  });

  it("appends a missing trailing cell", () => {
    const short = "| a | b |\n| - | - |\n| 1 |";
    const table = parseTable(short);
    const edit = table && editTableCell(table, 1, 1, "2");
    expect(edit && apply(short, edit).split("\n")[2]).toBe("| 1 | 2 |");
  });
});

describe("table model", () => {
  const source = "| a | b |\n|:-|-:|\n| 1 | 2 |\n| 3 | 4 |";
  const model = () => {
    const parsed = parseTable(source);
    if (!parsed) throw new Error("not a table");
    return tableModel(parsed);
  };

  it("serializes with padded columns and alignment", () => {
    expect(serializeTable(model())).toBe(
      "| a   | b   |\n| :-- | --: |\n| 1   | 2   |\n| 3   | 4   |",
    );
  });

  it("pads wide characters by display width", () => {
    const table = parseTable("| 名称 | x |\n| - | - |\n| a | b |");
    expect(table && serializeTable(tableModel(table)).split("\n")[2]).toBe("| a    | b   |");
  });

  it("inserts and deletes rows", () => {
    const inserted = insertRows(model(), 1);
    expect(inserted.rows).toEqual([
      ["1", "2"],
      ["", ""],
      ["3", "4"],
    ]);
    expect(deleteRows(inserted, [0, 1]).rows).toEqual([["3", "4"]]);
  });

  it("inserts, aligns and deletes columns", () => {
    const inserted = insertColumn(model(), 1);
    expect(inserted.header).toEqual(["a", "", "b"]);
    expect(inserted.rows[0]).toEqual(["1", "", "2"]);
    expect(alignColumns(inserted, [1], "center").alignments).toEqual(["left", "center", "right"]);
    expect(deleteColumns(inserted, [0, 2])?.header).toEqual([""]);
    expect(deleteColumns(inserted, [0, 1, 2])).toBeNull();
  });
});

describe("cell ranges", () => {
  const model = () => {
    const parsed = parseTable("| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |");
    if (!parsed) throw new Error("not a table");
    return tableModel(parsed);
  };

  it("reads and clears a rectangle", () => {
    const range = { top: 0, bottom: 1, left: 1, right: 1 };
    expect(cellGrid(model(), range)).toEqual([["b"], ["2"]]);
    expect(clearCells(model(), range).rows).toEqual([
      ["1", ""],
      ["3", "4"],
    ]);
    expect(clearCells(model(), range).header).toEqual(["a", ""]);
  });

  it("writes a grid, growing rows and columns", () => {
    const next = fillCells(model(), { row: 2, column: 1 }, [["x", "y"], ["z"]]);
    expect(next.header).toEqual(["a", "b", ""]);
    expect(next.rows).toEqual([
      ["1", "2", ""],
      ["3", "x", "y"],
      ["", "z", ""],
    ]);
  });

  it("escapes pipes in pasted values", () => {
    expect(fillCells(model(), { row: 1, column: 0 }, [["a|b"]]).rows[0][0]).toBe("a\\|b");
  });

  it("parses markdown tables, tab-separated lines and single values", () => {
    expect(parseGrid("| h |\n| - |\n| v |")).toEqual([["h"], ["v"]]);
    expect(parseGrid("1\t2\n3\t4\n")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(parseGrid("one")).toEqual([["one"]]);
  });

  it("turns a grid into a table with its first row as header", () => {
    expect(gridToMarkdown([["a"], ["1"]])).toBe("| a   |\n| --- |\n| 1   |");
  });
});
