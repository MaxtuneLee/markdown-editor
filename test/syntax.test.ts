import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownParser } from "@lezer/markdown";
import { describe, expect, it } from "vite-plus/test";

import { Highlight } from "../src/syntax/highlight";
import { parseWikiLink, WikiLink } from "../src/syntax/wikiLink";

const parser = (markdownLanguage.parser as MarkdownParser).configure([Highlight, WikiLink]);

function nodes(text: string): string[] {
  const names: string[] = [];
  parser.parse(text).iterate({
    enter: (node) => {
      names.push(`${node.name}:${text.slice(node.from, node.to)}`);
    },
  });
  return names;
}

describe("Highlight", () => {
  it("parses ==text==", () => {
    expect(nodes("a ==marked== b")).toContain("Highlight:==marked==");
  });

  it("ignores lone and spaced delimiters", () => {
    expect(nodes("a == b == c").some((node) => node.startsWith("Highlight:"))).toBe(false);
  });
});

describe("WikiLink", () => {
  it("parses targets and labels", () => {
    const parsed = nodes("see [[Note A|the note]] and [[B]]");
    expect(parsed).toContain("WikiLink:[[Note A|the note]]");
    expect(parsed).toContain("WikiLinkTarget:Note A");
    expect(parsed).toContain("WikiLinkLabel:the note");
    expect(parsed).toContain("WikiLinkTarget:B");
  });

  it("leaves regular links alone", () => {
    const parsed = nodes("[text](https://example.com)");
    expect(parsed.some((node) => node.startsWith("WikiLink"))).toBe(false);
    expect(parsed).toContain("Link:[text](https://example.com)");
  });

  it("parses a source string", () => {
    expect(parseWikiLink("[[a|b]]")).toEqual({ target: "a", label: "b" });
    expect(parseWikiLink("[[a]]")).toEqual({ target: "a", label: "a" });
    expect(parseWikiLink("[[]]")).toBeNull();
  });
});
