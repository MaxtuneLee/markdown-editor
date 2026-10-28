type Katex = typeof import("katex").default;

const CACHE_LIMIT = 500;

let katex: Katex | null = null;
let loading: Promise<boolean> | null = null;
const cache = new Map<string, string>();

/** Loads KaTeX once. Resolves to false if it can't be loaded. */
export function loadMath(): Promise<boolean> {
  loading ??= import("katex").then(
    (module) => {
      katex = module.default;
      return true;
    },
    () => false,
  );
  return loading;
}

export function isMathLoaded(): boolean {
  return katex !== null;
}

/**
 * MathML for `tex`, or null until KaTeX has loaded. MathML renders natively in current browsers,
 * so no KaTeX stylesheet or fonts are needed. Errors render in place instead of throwing.
 */
export function renderMath(tex: string, display: boolean): string | null {
  if (!katex) return null;
  const key = `${display ? "D" : "I"}${tex}`;
  let html = cache.get(key);
  if (html === undefined) {
    html = katex.renderToString(tex, {
      displayMode: display,
      output: "mathml",
      throwOnError: false,
      strict: "ignore",
    });
    cache.set(key, html);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  }
  return html;
}
