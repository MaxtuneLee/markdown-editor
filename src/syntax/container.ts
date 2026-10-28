import type { Line, MarkdownConfig } from "@lezer/markdown";

const MARKER = /^:::/;

function isMarker(line: Line): boolean {
  return MARKER.test(line.text.slice(line.pos));
}

/**
 * The `:::` lines that open and close a container such as `::: warning Title`. Only the marker
 * lines are nodes; the lines between them stay ordinary markdown.
 */
export const Container: MarkdownConfig = {
  defineNodes: [{ name: "ContainerMark", block: true }],
  parseBlock: [
    {
      name: "ContainerMark",
      parse(cx, line) {
        if (!isMarker(line)) return false;
        cx.addElement(
          cx.elt("ContainerMark", cx.lineStart + line.pos, cx.lineStart + line.text.length),
        );
        cx.nextLine();
        return true;
      },
      endLeaf: (_cx, line) => isMarker(line),
      before: "FencedCode",
    },
  ],
};

export interface ContainerOpening {
  type: string;
  title: string;
}

/** The type and title of an opening marker, or null for a closing `:::`. */
export function parseContainerMarker(text: string): ContainerOpening | null {
  const match = /^:::\s*([\w-]+)\s*(.*)$/.exec(text.trim());
  if (!match) return null;
  const type = match[1].toLowerCase();
  return { type, title: match[2].trim() || type[0].toUpperCase() + type.slice(1) };
}
