import { safeHref } from "./config";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renders the inline markdown a table cell can hold (code, strong, emphasis, strikethrough,
 * highlight, links and wiki links) to escaped HTML.
 */
export function renderInlineMarkdown(source: string): string {
  const codeSpans: string[] = [];
  let html = escapeHtml(source.replace(/\\\|/g, "|")).replace(/`([^`]+)`/g, (_match, code) => {
    codeSpans.push(`<code class="cm-md-inline-code">${code}</code>`);
    return `\uE000${codeSpans.length - 1}\uE000`;
  });
  html = html
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_m, a, b) => `<strong>${a ?? b}</strong>`)
    .replace(/(?<![*\w])\*(?!\s)(.+?)\*(?!\w)|(?<![_\w])_(?!\s)(.+?)_(?!\w)/g, (_m, a, b) => {
      return `<em>${a ?? b}</em>`;
    })
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/==(.+?)==/g, '<mark class="cm-md-highlight">$1</mark>')
    .replace(/\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g, (_m, target: string, label?: string) => {
      const text = label?.trim() || target.trim();
      return `<span class="cm-md-wikilink" data-wiki-target="${target.trim()}">${text}</span>`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;.*?&quot;)?\)/g, (match, text, href: string) => {
      const url = safeHref(href);
      return url ? `<span class="cm-md-link" data-href="${url}">${text}</span>` : match;
    });
  return html.replace(/\uE000(\d+)\uE000/g, (_m, index) => codeSpans[Number(index)]);
}
