import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownParser } from "@lezer/markdown";
import { describe, expect, it } from "vite-plus/test";

import { findStableBlockEnd } from "../src/blocks";
import { parseFenceInfo } from "../src/codeInfo";
import { Container, parseContainerMarker } from "../src/syntax/container";
import { Emoji } from "../src/syntax/emoji";
import { TexMath } from "../src/syntax/math";

const parser = (markdownLanguage.parser as MarkdownParser).configure([TexMath, Container, Emoji]);

function nodes(text: string, name: string): string[] {
  const found: string[] = [];
  parser.parse(text).iterate({
    enter: (node) => {
      if (node.name === name) found.push(text.slice(node.from, node.to));
    },
  });
  return found;
}

describe("math", () => {
  it("parses the inline forms", () => {
    expect(nodes("a $x^2$ b \\(y\\) c $$z$$ d", "InlineMath")).toEqual([
      "$x^2$",
      "\\(y\\)",
      "$$z$$",
    ]);
  });

  it("leaves prices alone", () => {
    expect(nodes("costs $5 and $10 today", "InlineMath")).toEqual([]);
    expect(nodes("a $ b $ c", "InlineMath")).toEqual([]);
  });

  it("keeps link syntax inside math as math", () => {
    expect(nodes("\\(\\left[ a \\right](b)\\)", "Link")).toEqual([]);
  });

  it("parses display blocks, one line or many", () => {
    expect(nodes("$$E=mc^2$$\n", "BlockMath")).toEqual(["$$E=mc^2$$"]);
    expect(nodes("\\[\na + b\n\\]\n\nafter", "BlockMath")).toEqual(["\\[\na + b\n\\]"]);
  });

  it("parses display blocks indented in a list item", () => {
    const text = "- item\n   \\[\n   x\n   \\]\n";
    expect(nodes(text, "BlockMath")).toEqual(["\\[\n   x\n   \\]"]);
  });

  it("lets a display block interrupt a paragraph", () => {
    expect(nodes("text\n$$\nx\n$$", "BlockMath")).toEqual(["$$\nx\n$$"]);
  });
});

describe("containers", () => {
  it("parses marker lines and keeps the content as markdown", () => {
    const text = "::: tip Title\nsome **bold**\n:::\n";
    expect(nodes(text, "ContainerMark")).toEqual(["::: tip Title", ":::"]);
    expect(nodes(text, "StrongEmphasis")).toEqual(["**bold**"]);
  });

  it("reads the type and title", () => {
    expect(parseContainerMarker("::: warning")).toEqual({ type: "warning", title: "Warning" });
    expect(parseContainerMarker("::: tip 提示标题")).toEqual({ type: "tip", title: "提示标题" });
    expect(parseContainerMarker(":::")).toBeNull();
  });
});

describe("emoji", () => {
  it("parses known shortcodes only", () => {
    expect(nodes("hi :smile: and :notreal: and 10:30:45", "Emoji")).toEqual([":smile:"]);
  });
});

describe("fence info", () => {
  it("reads languages, file names and diffs", () => {
    expect(parseFenceInfo("ts")).toEqual({ lang: "ts", diff: false, title: null });
    expect(parseFenceInfo("javascript:electron/main.js")).toEqual({
      lang: "javascript",
      diff: false,
      title: "electron/main.js",
    });
    expect(parseFenceInfo("diff json:package.json")).toEqual({
      lang: "json",
      diff: true,
      title: "package.json",
    });
    expect(parseFenceInfo("diff")).toEqual({ lang: "diff", diff: false, title: null });
  });
});

describe("stable block end with math and containers", () => {
  it("waits for display math to close", () => {
    expect(findStableBlockEnd("a\n\n$$\nx\n")).toBe(3);
    expect(findStableBlockEnd("a\n\n$$\nx\n$$\n")).toBe(11);
    expect(findStableBlockEnd("$$E=mc^2$$\n\n")).toBe(12);
  });

  it("waits for a container to close", () => {
    expect(findStableBlockEnd("::: tip\nline\n\nmore\n")).toBe(0);
    expect(findStableBlockEnd("::: tip\nline\n:::\n")).toBe(17);
  });
});
