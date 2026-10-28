import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { MarkdownEditor, type MarkdownEditorHandle } from "../src/index";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOC = `# Title

Some **bold** text and a [link](https://example.com) and [[Page|a page]].

- [ ] task

| a | b |
| - | - |
| 1 | 2 |

\`\`\`mermaid
graph LR
  A --> B
\`\`\`
`;

let root: Root | null = null;

function press(target: Element | null, init: MouseEventInit = {}): void {
  target?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ...init }));
}

function release(): void {
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

function clipboardEvent(type: string, text = ""): Event & { data: () => string } {
  let data = text;
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => data, setData: (_type: string, value: string) => (data = value) },
  });
  return Object.assign(event, { data: () => data });
}
let host: HTMLElement | null = null;

async function mount(element: React.ReactElement): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(element));
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("MarkdownEditor", () => {
  it("renders blocks and inline decorations without changing the source", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const dom = await mount(<MarkdownEditor ref={ref} defaultValue={DOC} theme="light" />);
    expect(dom.querySelector(".mde")?.getAttribute("data-theme")).toBe("light");
    expect(dom.querySelector(".cm-md-strong")?.textContent).toBe("bold");
    expect(dom.querySelector(".cm-md-h1")).not.toBeNull();
    expect(dom.querySelector("[data-href='https://example.com']")?.textContent).toBe("link");
    expect(dom.querySelector("[data-wiki-target='Page']")?.textContent).toBe("a page");
    expect(dom.querySelector(".cm-md-task input")).not.toBeNull();
    expect(dom.querySelector(".cm-md-table")).not.toBeNull();
    expect(dom.querySelector(".cm-md-diagram")).not.toBeNull();
    expect(ref.current?.getValue()).toBe(DOC);
  });

  it("writes a table cell edit back to the source", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    const dom = await mount(<MarkdownEditor ref={ref} defaultValue={DOC} onChange={onChange} />);
    const cell = dom.querySelector<HTMLElement>("[data-cell='1:1']");
    if (!cell) throw new Error("missing cell");
    cell.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    cell.textContent = "two|three";
    cell.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(ref.current?.getValue()).toContain("| 1 | two\\|three |");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("toggles a task from its checkbox", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const dom = await mount(<MarkdownEditor ref={ref} defaultValue={DOC} />);
    dom
      .querySelector(".cm-md-task input")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(ref.current?.getValue()).toContain("- [x] task");
  });

  it("opens wiki links and regular links on click", async () => {
    const onOpen = vi.fn();
    const onOpenLink = vi.fn();
    const dom = await mount(
      <MarkdownEditor defaultValue={DOC} wikiLinks={{ onOpen }} onOpenLink={onOpenLink} />,
    );
    dom
      .querySelector("[data-wiki-target='Page']")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    dom
      .querySelector("[data-href='https://example.com']")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(onOpen).toHaveBeenCalledWith("Page", expect.any(MouseEvent));
    expect(onOpenLink).toHaveBeenCalledWith("https://example.com", expect.any(MouseEvent));
  });

  it("doesn't open links that would run script", async () => {
    const onOpenLink = vi.fn();
    const dom = await mount(
      <MarkdownEditor
        defaultValue={"[a](javascript:alert(1)) [b](\u0001JavaScript:alert(2))"}
        onOpenLink={onOpenLink}
      />,
    );
    for (const link of dom.querySelectorAll("[data-href]")) press(link);
    expect(dom.querySelectorAll("[data-href]")).toHaveLength(2);
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it("rebuilds tables when the editor stops being read-only", async () => {
    const editable = (dom: HTMLElement): boolean =>
      dom.querySelector(".cm-md-row-handle") !== null &&
      dom.querySelector<HTMLElement>("[data-cell='1:0']")?.contentEditable === "plaintext-only";
    const dom = await mount(<MarkdownEditor defaultValue={DOC} readOnly />);
    expect(dom.querySelector(".cm-md-table")).not.toBeNull();
    expect(editable(dom)).toBe(false);

    await act(async () => root?.render(<MarkdownEditor defaultValue={DOC} />));
    expect(editable(dom)).toBe(true);

    await act(async () => root?.render(<MarkdownEditor defaultValue={DOC} readOnly />));
    expect(editable(dom)).toBe(false);
  });

  it("spaces blocks the same with or without blank lines between them", async () => {
    const tight = await mount(
      <MarkdownEditor defaultValue={"Intro\nsame paragraph\n- item\n# Next"} />,
    );
    expect([...tight.querySelectorAll(".cm-md-gap")].map((gap) => gap.className)).toEqual([
      "cm-md-gap cm-md-gap-block",
      "cm-md-gap cm-md-gap-heading",
    ]);
    expect(tight.querySelector(".cm-md-gap-line")).toBeNull();
  });

  it("shrinks the blank lines between blocks to the block gap", async () => {
    const loose = await mount(<MarkdownEditor defaultValue={"Intro\n\n- item\n\n\n# Next"} />);
    expect(loose.querySelector(".cm-md-gap")).toBeNull();
    expect([...loose.querySelectorAll(".cm-md-gap-line")].map((line) => line.className)).toEqual([
      "cm-line cm-md-gap-line cm-md-gap-block",
      "cm-line cm-md-gap-line cm-md-gap-heading",
      "cm-line cm-md-gap-line cm-md-gap-block",
    ]);
  });

  it("makes each cell, not the editor, the editing host of its caret", async () => {
    const dom = await mount(<MarkdownEditor defaultValue={DOC} />);
    // Without this, a caret placed in a cell belongs to the editor content, which takes focus
    // and reveals the whole table as source.
    expect(dom.querySelector<HTMLElement>(".cm-md-table-block")?.contentEditable).toBe("false");
  });

  it("follows a controlled value without reporting it as a change", async () => {
    const onChange = vi.fn();
    const ref = createRef<MarkdownEditorHandle>();
    await mount(<MarkdownEditor ref={ref} value="one" onChange={onChange} />);
    await act(async () =>
      root?.render(<MarkdownEditor ref={ref} value="one two" onChange={onChange} />),
    );
    expect(ref.current?.getValue()).toBe("one two");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("streams chunks and leaves the unfinished table as source", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const dom = await mount(<MarkdownEditor ref={ref} />);
    await act(async () => {
      ref.current?.append("Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(ref.current?.view?.state.readOnly).toBe(true);
    expect(dom.querySelector(".cm-md-table")).toBeNull();
    expect(dom.querySelector(".cm-md-stream-caret")).not.toBeNull();

    await act(async () => ref.current?.finishStream());
    expect(ref.current?.view?.state.readOnly).toBe(false);
    expect(dom.querySelector(".cm-md-table")).not.toBeNull();
    expect(dom.querySelector(".cm-md-stream-caret")).toBeNull();
  });

  it("keeps raw syntax hidden until the mouse button is released", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const dom = await mount(<MarkdownEditor ref={ref} defaultValue={DOC} />);
    const view = ref.current?.view;
    if (!view) throw new Error("missing view");
    const line = () => dom.querySelector(".cm-md-h1")?.textContent;
    const wait = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
    view.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    view.focus();
    view.dispatch({ selection: { anchor: 3 } });
    // CodeMirror reports focus changes shortly after the focus event.
    await wait(30);
    expect(line()).toBe("Title");

    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await wait(10);
    expect(line()).toBe("# Title");
  });

  it("reveals only the inline node under the cursor", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const dom = await mount(<MarkdownEditor ref={ref} defaultValue={DOC} />);
    const view = ref.current?.view;
    if (!view) throw new Error("missing view");
    const line = () =>
      [...dom.querySelectorAll(".cm-line")].find((el) => el.textContent?.includes("text and"));
    view.focus();
    await act(async () => view.dispatch({ selection: { anchor: DOC.indexOf("bold") + 1 } }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(line()?.textContent).toContain("**bold**");
    expect(line()?.textContent).not.toContain("](https://example.com)");
  });

  it("deletes selected table rows from the toolbar", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const dom = await mount(<MarkdownEditor ref={ref} defaultValue={DOC} />);
    press(dom.querySelector("[data-row='0']"));
    release();
    expect(dom.querySelector(".cm-md-table-toolbar-label")?.textContent).toBe("1 row");
    const remove = [...dom.querySelectorAll<HTMLButtonElement>(".cm-md-table-tool")].find(
      (button) => button.textContent === "Delete",
    );
    remove?.click();
    expect(ref.current?.getValue()).toContain("| a   | b   |\n| --- | --- |\n\n```mermaid");
  });

  it("copies a rendered selection as markdown", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    await mount(<MarkdownEditor ref={ref} defaultValue={DOC} />);
    const view = ref.current?.view;
    if (!view) throw new Error("missing view");
    const from = DOC.indexOf("bold**");
    view.dispatch({ selection: { anchor: from, head: from + 4 } });
    const clipboardData = {
      data: "",
      setData(_type: string, value: string) {
        this.data = value;
      },
    };
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboardData });
    view.contentDOM.dispatchEvent(event);
    expect(clipboardData.data).toBe("**bold**");
  });

  describe("cell ranges", () => {
    const TABLE = "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n";

    async function mountTable(): Promise<{ dom: HTMLElement; value: () => string }> {
      const ref = createRef<MarkdownEditorHandle>();
      const dom = await mount(<MarkdownEditor ref={ref} defaultValue={TABLE} />);
      return { dom, value: () => ref.current?.getValue() ?? "" };
    }

    function selectRange(dom: HTMLElement, from: string, to: string): void {
      // Click to edit the first cell, then Shift-click to extend from it.
      press(dom.querySelector(`[data-cell='${from}']`));
      release();
      press(dom.querySelector(`[data-cell='${to}']`), { shiftKey: true });
    }

    it("selects a rectangle with Shift-click and clears it", async () => {
      const { dom, value } = await mountTable();
      selectRange(dom, "1:0", "2:1");
      expect(dom.querySelectorAll(".cm-md-cell-selected")).toHaveLength(4);
      expect(dom.querySelector(".cm-md-table-toolbar-label")?.textContent).toBe("2 × 2");
      dom
        .querySelector(".cm-md-table-block")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
      expect(value()).toContain("|     |     | 3   |\n|     |     | 6   |");
    });

    it("copies a range as a markdown table", async () => {
      const { dom } = await mountTable();
      selectRange(dom, "0:1", "1:2");
      const event = clipboardEvent("copy");
      dom.querySelector(".cm-md-table-block")?.dispatchEvent(event);
      expect(event.data()).toBe("| b   | c   |\n| --- | --- |\n| 2   | 3   |");
    });

    it("copies the whole table exactly as written", async () => {
      const source = "| Name | Done |\n| :-- | :-: |\n| a | **yes** |\n";
      const dom = await mount(<MarkdownEditor defaultValue={source} />);
      selectRange(dom, "0:0", "1:1");
      const event = clipboardEvent("copy");
      dom.querySelector(".cm-md-table-block")?.dispatchEvent(event);
      expect(event.data()).toBe("| Name | Done |\n| :-- | :-: |\n| a | **yes** |");
    });

    it("keeps column alignment when copying part of a table", async () => {
      const source = "| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |\n";
      const dom = await mount(<MarkdownEditor defaultValue={source} />);
      selectRange(dom, "0:1", "1:2");
      const event = clipboardEvent("copy");
      dom.querySelector(".cm-md-table-block")?.dispatchEvent(event);
      expect(event.data()).toBe("| b   | c   |\n| :-: | --: |\n| 2   | 3   |");
    });

    it("pastes spreadsheet cells from the range's corner, growing the table", async () => {
      const { dom, value } = await mountTable();
      selectRange(dom, "2:1", "2:2");
      // An arrow without Shift collapses the range to one cell: 2:2 stays, clamped at the edge.
      dom
        .querySelector(".cm-md-table-block")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      expect(dom.querySelectorAll(".cm-md-cell-selected")).toHaveLength(1);
      dom.querySelector(".cm-md-table-block")?.dispatchEvent(clipboardEvent("paste", "x\ty\nz\tw"));
      expect(value()).toBe(
        "| a   | b   | c   |     |\n| --- | --- | --- | --- |\n| 1   | 2   | 3   |     |\n| 4   | 5   | x   | y   |\n|     |     | z   | w   |\n",
      );
    });

    it("fills every selected cell with a single pasted value", async () => {
      const { dom, value } = await mountTable();
      selectRange(dom, "1:0", "2:0");
      dom.querySelector(".cm-md-table-block")?.dispatchEvent(clipboardEvent("paste", "-"));
      expect(value()).toContain("| -   | 2   | 3   |\n| -   | 5   | 6   |");
    });

    it("edits a cell when the press doesn't leave it", async () => {
      const { dom } = await mountTable();
      const cell = dom.querySelector<HTMLElement>("[data-cell='1:1']");
      press(cell);
      release();
      expect(document.activeElement).toBe(cell);
    });
  });
});
