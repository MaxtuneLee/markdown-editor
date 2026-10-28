import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

/*
 * Space between top-level blocks follows the markdown structure rather than the blank lines in
 * the source: a block that directly follows another gets a spacer before it, and the blank lines
 * between two blocks shrink to the same height. A note reads the same with or without blank
 * lines, and lines of one paragraph stay together.
 */

// `flush` sits next to a table, whose own chrome (the column handles above it and the scrollbar
// space below) makes up the rest of the gap.
type Gap = "block" | "heading" | "flush";

const HEADING = /^(ATXHeading|SetextHeading)\d$/;

class GapWidget extends WidgetType {
  constructor(readonly gap: Gap) {
    super();
  }

  eq(other: GapWidget): boolean {
    return other.gap === this.gap;
  }

  toDOM(): HTMLElement {
    const spacer = document.createElement("div");
    spacer.className = `cm-md-gap cm-md-gap-${this.gap}`;
    spacer.setAttribute("aria-hidden", "true");
    return spacer;
  }

  // A click on the spacer places the caret at the start of the block below it.
  ignoreEvent(): boolean {
    return false;
  }
}

const GAPS: Gap[] = ["block", "heading", "flush"];

const gapWidgets = Object.fromEntries(
  GAPS.map((gap) => [
    gap,
    Decoration.widget({ widget: new GapWidget(gap), block: true, side: -1 }),
  ]),
) as Record<Gap, Decoration>;

const gapLines = Object.fromEntries(
  GAPS.map((gap) => [gap, Decoration.line({ class: `cm-md-gap-line cm-md-gap-${gap}` })]),
) as Record<Gap, Decoration>;

function gapBetween(previous: string, next: string): Gap {
  if (HEADING.test(next)) return "heading";
  return previous === "Table" || next === "Table" ? "flush" : "block";
}

function buildGaps(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const doc = state.doc;
  let previous: { name: string; to: number } | null = null;
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    const start = doc.lineAt(node.from);
    if (previous) {
      const gap = gapBetween(previous.name, node.name);
      const firstBlank = doc.lineAt(previous.to).number + 1;
      if (firstBlank >= start.number) {
        ranges.push(gapWidgets[gap].range(start.from));
      } else {
        // The first blank line takes the gap; any further ones stay as deliberate extra space.
        ranges.push(gapLines[gap].range(doc.line(firstBlank).from));
        for (let number = firstBlank + 1; number < start.number; number++) {
          ranges.push(gapLines.block.range(doc.line(number).from));
        }
      }
    }
    previous = { name: node.name, to: node.to };
  }
  return Decoration.set(ranges, true);
}

const blockSpacingField = StateField.define<DecorationSet>({
  create: buildGaps,
  update(value, tr) {
    if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return buildGaps(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function blockSpacing(): Extension {
  return blockSpacingField;
}
