import { Facet } from "@codemirror/state";

export interface WikiLinkSuggestion {
  target: string;
  title?: string;
  detail?: string;
}

export interface WikiLinkOptions {
  /** Whether a target exists. Missing targets render with the unresolved style. */
  resolve?: (target: string) => Promise<boolean> | boolean;
  /** Completion candidates after `[[`. */
  suggest?: (
    query: string,
  ) => Promise<readonly WikiLinkSuggestion[]> | readonly WikiLinkSuggestion[];
  /** Called when a rendered wiki link is clicked. */
  onOpen?: (target: string, event: MouseEvent) => void;
}

export interface MarkdownEditorConfig {
  wikiLinks?: WikiLinkOptions;
  /** Called when a rendered link is clicked. Defaults to opening it in a new tab. */
  onOpenLink?: (href: string, event: MouseEvent) => void;
  /** Maps an image's markdown source (for example a relative path) to a loadable URL. */
  resolveImageUrl?: (src: string) => string;
  /** Render ```mermaid blocks as diagrams with Pele. Defaults to true. */
  mermaid?: boolean;
}

export const editorConfig = Facet.define<MarkdownEditorConfig, MarkdownEditorConfig>({
  combine: (values) => Object.assign({}, ...values) as MarkdownEditorConfig,
});

const BLOCKED_PROTOCOLS = new Set(["javascript:", "vbscript:", "data:"]);

/** The trimmed href, or null when opening it would run script or load inline data. */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  // The URL parser drops the control characters and tabs browsers ignore, as in `java\tscript:`.
  // The base only resolves relative links; their protocol is never blocked.
  if (!URL.canParse(trimmed, "https://localhost/")) return null;
  const { protocol } = new URL(trimmed, "https://localhost/");
  return BLOCKED_PROTOCOLS.has(protocol) ? null : trimmed;
}

export function openLink(config: MarkdownEditorConfig, href: string, event: MouseEvent): void {
  const url = safeHref(href);
  if (url === null) return;
  if (config.onOpenLink) {
    config.onOpenLink(url, event);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
