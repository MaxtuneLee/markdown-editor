import type { InlineContext, MarkdownConfig } from "@lezer/markdown";

const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
const PIPE = 124;
const NEWLINE = 10;

/** Finds the first `|` and the closing `]]` after `start`, or null if the link isn't closed. */
function scanWikiLink(cx: InlineContext, start: number): { pipe: number; close: number } | null {
  let pipe = -1;
  for (let i = start; i < cx.end; i++) {
    const ch = cx.char(i);
    if (ch === NEWLINE || ch === OPEN_BRACKET) return null;
    if (ch === PIPE && pipe < 0) pipe = i;
    if (ch === CLOSE_BRACKET) return cx.char(i + 1) === CLOSE_BRACKET ? { pipe, close: i } : null;
  }
  return null;
}

// `[[target]]` and `[[target|label]]`. Targets and labels can't contain brackets or line breaks.
export const WikiLink: MarkdownConfig = {
  defineNodes: ["WikiLink", "WikiLinkMark", "WikiLinkTarget", "WikiLinkLabel"],
  parseInline: [
    {
      name: "WikiLink",
      parse(cx, next, pos) {
        if (next !== OPEN_BRACKET || cx.char(pos + 1) !== OPEN_BRACKET) return -1;
        const start = pos + 2;
        const bounds = scanWikiLink(cx, start);
        if (!bounds) return -1;
        const { pipe, close } = bounds;
        const targetEnd = pipe < 0 ? close : pipe;
        if (cx.slice(start, targetEnd).trim() === "") return -1;

        const children = [
          cx.elt("WikiLinkMark", pos, start),
          cx.elt("WikiLinkTarget", start, targetEnd),
        ];
        if (pipe >= 0) {
          children.push(cx.elt("WikiLinkMark", pipe, pipe + 1));
          children.push(cx.elt("WikiLinkLabel", pipe + 1, close));
        }
        children.push(cx.elt("WikiLinkMark", close, close + 2));
        return cx.addElement(cx.elt("WikiLink", pos, close + 2, children));
      },
      before: "Link",
    },
  ],
};

export interface ParsedWikiLink {
  target: string;
  label: string;
}

export function parseWikiLink(source: string): ParsedWikiLink | null {
  const match = /^\[\[([^[\]|\n]+)(?:\|([^[\]\n]*))?\]\]$/.exec(source);
  if (!match) return null;
  const target = match[1].trim();
  return { target, label: match[2]?.trim() || target };
}
