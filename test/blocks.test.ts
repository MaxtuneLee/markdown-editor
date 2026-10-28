import { describe, expect, it } from "vite-plus/test";

import { findStableBlockEnd } from "../src/blocks";

describe("findStableBlockEnd", () => {
  it("stops before the paragraph still being written", () => {
    const text = "# Title\n\nFirst paragraph.\n\nSecond par";
    expect(text.slice(0, findStableBlockEnd(text))).toBe("# Title\n\nFirst paragraph.\n\n");
  });

  it("keeps an unclosed fence unstable", () => {
    const text = "Intro\n\n```mermaid\ngraph TD\nA-->B\n";
    expect(findStableBlockEnd(text)).toBe("Intro\n\n".length);
  });

  it("treats a closed fence as complete", () => {
    const text = "```js\nconst a = 1;\n\nconst b = 2;\n```\nmore";
    expect(findStableBlockEnd(text)).toBe(text.indexOf("more"));
  });

  it("keeps a table unstable until a blank line follows it", () => {
    const table = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    expect(findStableBlockEnd(table)).toBe(0);
    expect(findStableBlockEnd(`${table}\n`)).toBe(table.length + 1);
  });

  it("needs a matching fence to close", () => {
    const text = "````\n```\nstill code\n";
    expect(findStableBlockEnd(text)).toBe(0);
  });
});
