const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;

function closesFence(line: string, fence: string): boolean {
  const match = FENCE.exec(line);
  if (!match || match[1][0] !== fence[0] || match[1].length < fence.length) return false;
  return line.slice(match[0].length).trim() === "";
}

type OpenBlock =
  | { kind: "fence"; marker: string }
  | { kind: "math"; close: string }
  | { kind: "container" };

function closes(open: OpenBlock, line: string): boolean {
  if (open.kind === "fence") return closesFence(line, open.marker);
  if (open.kind === "math") return line.trimEnd().endsWith(open.close);
  return /^\s*:::\s*$/.test(line);
}

/** A block that stays open past this line: a fence, unclosed display math or a container. */
function opens(line: string): OpenBlock | null {
  const fence = FENCE.exec(line);
  if (fence) return { kind: "fence", marker: fence[1] };
  const text = line.trim();
  for (const [open, close] of [
    ["$$", "$$"],
    ["\\[", "\\]"],
  ]) {
    const rest = text.slice(open.length);
    if (text.startsWith(open) && !(rest.trim() !== "" && rest.endsWith(close))) {
      return { kind: "math", close };
    }
  }
  if (/^:::\s*[\w-]+/.test(text)) return { kind: "container" };
  return null;
}

/**
 * Returns the offset after the last complete block in `text`, assuming `text` starts at a block
 * boundary outside any fence. Blocks after that offset may still change while text streams in,
 * so tables, diagrams, math and images there stay as source until the boundary moves past them.
 */
export function findStableBlockEnd(text: string): number {
  let stableEnd = 0;
  let open: OpenBlock | null = null;
  let pos = 0;
  while (pos < text.length) {
    const newline = text.indexOf("\n", pos);
    // The last line has no newline yet, so it can still grow.
    if (newline < 0) break;
    const line = text.slice(pos, newline);
    const next = newline + 1;
    if (open) {
      if (closes(open, line)) {
        open = null;
        stableEnd = next;
      }
    } else {
      open = opens(line);
      if (!open && (line.trim() === "" || HEADING.test(line) || THEMATIC_BREAK.test(line))) {
        stableEnd = next;
      }
    }
    pos = next;
  }
  return stableEnd;
}
