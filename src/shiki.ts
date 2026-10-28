import {
  createCssVariablesTheme,
  createHighlighterCore,
  type HighlighterCore,
  type ThemedToken,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";

import { parseFenceInfo } from "./codeInfo";

const THEME_NAME = "memora-markdown-editor";
const CACHE_LIMIT = 128;

// Token colors resolve to `var(--mde-code-token-*)`, so the stylesheet owns every color.
const theme = createCssVariablesTheme({
  name: THEME_NAME,
  variablePrefix: "--mde-code-",
  fontStyle: true,
});

let highlighter: HighlighterCore | null = null;
let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLanguages = new Set<string>();
const languageLoads = new Map<string, Promise<boolean>>();
const tokenCache = new Map<string, ThemedToken[][]>();

function normalizeLanguage(info: string): string | null {
  const { lang } = parseFenceInfo(info);
  return lang && lang in bundledLanguages ? lang : null;
}

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [theme],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  }).then((instance) => {
    highlighter = instance;
    return instance;
  });
  return highlighterPromise;
}

/** Loads the grammar for a fence info string. Resolves to false for unknown languages. */
export function loadLanguage(info: string): Promise<boolean> {
  const lang = normalizeLanguage(info);
  if (!lang) return Promise.resolve(false);
  if (loadedLanguages.has(lang)) return Promise.resolve(true);
  let load = languageLoads.get(lang);
  if (!load) {
    load = getHighlighter()
      .then(async (instance) => {
        const grammar = bundledLanguages[lang as keyof typeof bundledLanguages];
        await instance.loadLanguage(grammar);
        loadedLanguages.add(lang);
        return true;
      })
      .catch(() => false);
    languageLoads.set(lang, load);
  }
  return load;
}

/**
 * Tokens for `code`, or null while the grammar is still loading (call `loadLanguage` and
 * redraw once it resolves). Unknown languages also return null.
 */
export function tokenize(info: string, code: string): ThemedToken[][] | null {
  const lang = normalizeLanguage(info);
  if (!lang || !highlighter || !loadedLanguages.has(lang)) return null;
  const key = `${lang}\u0000${code}`;
  const cached = tokenCache.get(key);
  if (cached) {
    // Refresh recency.
    tokenCache.delete(key);
    tokenCache.set(key, cached);
    return cached;
  }
  const tokens = highlighter.codeToTokensBase(code, { lang, theme: THEME_NAME });
  tokenCache.set(key, tokens);
  if (tokenCache.size > CACHE_LIMIT) {
    tokenCache.delete(tokenCache.keys().next().value as string);
  }
  return tokens;
}

export function hasLanguage(info: string): boolean {
  return normalizeLanguage(info) !== null;
}
