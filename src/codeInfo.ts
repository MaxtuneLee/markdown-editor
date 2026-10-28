export interface FenceInfo {
  /** Grammar to highlight with, lowercased. */
  lang: string;
  /** `diff json` marks + and - lines while highlighting as JSON. */
  diff: boolean;
  /** A file name written as `lang:path`, if any. */
  title: string | null;
}

/** Reads fence info such as `ts`, `javascript:src/main.js` or `diff json:package.json`. */
export function parseFenceInfo(info: string): FenceInfo {
  const words = info.trim().split(/\s+/);
  let word = words[0] ?? "";
  const diff = word.toLowerCase() === "diff" && words.length > 1;
  if (diff) word = words[1];
  const colon = word.indexOf(":");
  const lang = (colon >= 0 ? word.slice(0, colon) : word).toLowerCase();
  const title = colon >= 0 ? word.slice(colon + 1) || null : null;
  return { lang, diff, title };
}
