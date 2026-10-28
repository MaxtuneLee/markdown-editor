import type { BlockContext, InlineContext, Line, MarkdownConfig } from "@lezer/markdown";

const DOLLAR = 36;
const BACKSLASH = 92;
const OPEN_PAREN = 40;
const SPACE = /\s/;

/** Where an inline math span ends, or -1 when it isn't math. */
function inlineMathEnd(cx: InlineContext, pos: number): { end: number; open: number } | null {
  const rest = cx.slice(pos, cx.end);
  if (rest.startsWith("\\(")) return pairedMathEnd(rest, pos, "\\)");
  if (rest.startsWith("$$")) return pairedMathEnd(rest, pos, "$$");
  return dollarMathEnd(rest, pos);
}

function dollarMathEnd(rest: string, pos: number): { end: number; open: number } | null {
  // $x$: no space just inside the dollars and no digit right after, so "$5 and $10" stays text.
  if (rest.length < 3 || SPACE.test(rest[1]) || rest[1] === "$") return null;
  const close = closingDollar(rest);
  if (close < 0 || SPACE.test(rest[close - 1]) || /\d/.test(rest[close + 1] ?? "")) return null;
  return { end: pos + close + 1, open: 1 };
}

/** The end of math opened by a two-character delimiter and closed by `close`. */
function pairedMathEnd(
  rest: string,
  pos: number,
  close: string,
): { end: number; open: number } | null {
  const at = rest.indexOf(close, 2);
  return at > 2 ? { end: pos + at + 2, open: 2 } : null;
}

/** Index of the `$` closing `$x$`, or -1. Escaped characters are skipped; a blank line ends it. */
function closingDollar(rest: string): number {
  for (let i = 1; i < rest.length; i++) {
    const char = rest[i];
    if (char === "\\") i++;
    else if (char === "$") return i;
    else if (char === "\n" && rest[i + 1] === "\n") return -1;
  }
  return -1;
}

function blockMathOpener(line: Line): { open: string; close: string } | null {
  const text = line.text.slice(line.pos);
  if (text.startsWith("$$")) return { open: "$$", close: "$$" };
  if (text.startsWith("\\[")) return { open: "\\[", close: "\\]" };
  return null;
}

function parseBlockMath(cx: BlockContext, line: Line): boolean {
  const opener = blockMathOpener(line);
  if (!opener) return false;
  const start = cx.lineStart + line.pos;
  const children = [cx.elt("BlockMathMark", start, start + opener.open.length)];
  const first = line.text.slice(line.pos + opener.open.length).trimEnd();
  let end: number;

  if (first.endsWith(opener.close) && first.trim() !== "") {
    // $$E=mc^2$$ on one line.
    end = start + opener.open.length + first.length;
    children.push(cx.elt("BlockMathMark", end - opener.close.length, end));
    cx.nextLine();
  } else {
    end = cx.lineStart + line.text.length;
    while (cx.nextLine()) {
      const text = line.text.slice(line.pos).trimEnd();
      const lineEnd = cx.lineStart + line.text.length;
      if (text.endsWith(opener.close)) {
        end = cx.lineStart + line.pos + text.length;
        children.push(cx.elt("BlockMathMark", end - opener.close.length, end));
        cx.nextLine();
        break;
      }
      end = lineEnd;
    }
  }
  cx.addElement(cx.elt("BlockMath", start, end, children));
  return true;
}

/**
 * TeX math: `$x$`, `\(x\)` and `$$x$$` inline; `$$ … $$` and `\[ … \]` as blocks. Like a code
 * fence, a block left open (while a reply is still streaming) runs to the end of the document.
 */
export const TexMath: MarkdownConfig = {
  defineNodes: [
    { name: "BlockMath", block: true },
    "BlockMathMark",
    "InlineMath",
    "InlineMathMark",
  ],
  parseBlock: [
    {
      name: "BlockMath",
      parse: parseBlockMath,
      endLeaf: (_cx, line) => blockMathOpener(line) !== null,
      before: "FencedCode",
    },
  ],
  parseInline: [
    {
      name: "InlineMath",
      parse(cx, next, pos) {
        if (next !== DOLLAR && !(next === BACKSLASH && cx.char(pos + 1) === OPEN_PAREN)) return -1;
        const match = inlineMathEnd(cx, pos);
        if (!match) return -1;
        const close = next === DOLLAR ? match.open : 2;
        return cx.addElement(
          cx.elt("InlineMath", pos, match.end, [
            cx.elt("InlineMathMark", pos, pos + match.open),
            cx.elt("InlineMathMark", match.end - close, match.end),
          ]),
        );
      },
      before: "Escape",
    },
  ],
};
