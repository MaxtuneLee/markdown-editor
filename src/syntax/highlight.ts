import type { MarkdownConfig } from "@lezer/markdown";

const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\p{P}\p{S}]/u;
const EQUALS = 61;
const HIGHLIGHT_DELIMITER = { resolve: "Highlight", mark: "HighlightMark" };

// `==text==`, parsed the same way GFM parses `~~strikethrough~~`.
export const Highlight: MarkdownConfig = {
  defineNodes: ["Highlight", "HighlightMark"],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS) {
          return -1;
        }
        const { canOpen, canClose } = flanking(cx.slice(pos - 1, pos), cx.slice(pos + 2, pos + 3));
        return cx.addDelimiter(HIGHLIGHT_DELIMITER, pos, pos + 2, canOpen, canClose);
      },
      after: "Emphasis",
    },
  ],
};

/** Whether `==` between `before` and `after` can open or close, by the GFM flanking rules. */
function flanking(before: string, after: string): { canOpen: boolean; canClose: boolean } {
  const spaceBefore = /\s|^$/.test(before);
  const spaceAfter = /\s|^$/.test(after);
  const punctBefore = PUNCTUATION.test(before);
  const punctAfter = PUNCTUATION.test(after);
  return {
    canOpen: !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
    canClose: !spaceBefore && (!punctBefore || spaceAfter || punctAfter),
  };
}
