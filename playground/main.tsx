import { StrictMode, useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";

import { acceptAllChanges, markdownDiff, rejectAllChanges } from "../src/diff";
import { MarkdownEditor, type MarkdownEditorHandle, type WikiLinkSuggestion } from "../src/index";
import "../src/styles.css";

const SAMPLE = `# Live preview

Headings, **strong**, *emphasis*, ~~strike~~, ==highlights== and \`inline code\` render in place.
Links like [CodeMirror](https://codemirror.net) and wiki links like [[Daily notes]] or
[[Missing page|a missing page]] open on click.

> Quotes keep their markers out of the way.

- Bullets continue on Enter
- [ ] A task you can tick
- [x] A finished task
  - Nested item

1. Ordered
2. Lists

| Feature | Status | Notes |
| :-- | :-: | --: |
| Tables | **done** | click a cell to edit |
| Wide content | ok | this column is long enough to show horizontal scrolling inside the wrapper rather than the page |

![Placeholder](https://picsum.photos/seed/memora/640/240)

\`\`\`ts
export function greet(name: string): string {
  // Highlighted by Shiki with CSS variables.
  return \`Hello, \${name}\`;
}
\`\`\`

\`\`\`mermaid
graph LR
  Source[Raw markdown] --> View[Decorations]
  View --> Screen
\`\`\`

---

The end.
`;

const PAGES = ["Daily notes", "Project plan", "Reading list", "Meeting notes"];

function Playground() {
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [diffBase, setDiffBase] = useState<string | null>(null);
  const [log, setLog] = useState("");

  const wikiLinks = useMemo(
    () => ({
      resolve: async (target: string) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return PAGES.includes(target);
      },
      suggest: (query: string): WikiLinkSuggestion[] =>
        PAGES.filter((page) => page.toLowerCase().includes(query.toLowerCase())).map((page) => ({
          target: page,
          detail: "page",
        })),
      onOpen: (target: string) => setLog(`Open page: ${target}`),
    }),
    [],
  );

  const extensions = useMemo(
    () => (diffBase === null ? [] : markdownDiff({ original: diffBase })),
    [diffBase],
  );

  const startDiff = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const current = editor.getValue();
    setDiffBase(current);
    editor.setValue(
      current
        .replace("render in place", "render inline while you type")
        .replace("The end.", "The end, revised.\n\nA new closing line."),
    );
  }, []);

  const bar: CSSProperties = {
    display: "flex",
    gap: 8,
    padding: 8,
    alignItems: "center",
    fontFamily: "system-ui",
    fontSize: 13,
    flexWrap: "wrap",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={bar}>
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>Theme</button>
        {diffBase === null ? (
          <button onClick={startDiff}>Show diff</button>
        ) : (
          <>
            <button
              onClick={() => editorRef.current?.view && acceptAllChanges(editorRef.current.view)}
            >
              Accept all
            </button>
            <button
              onClick={() => editorRef.current?.view && rejectAllChanges(editorRef.current.view)}
            >
              Reject all
            </button>
            <button onClick={() => setDiffBase(null)}>Close diff</button>
          </>
        )}
        <span>{log}</span>
      </div>
      <MarkdownEditor
        ref={editorRef}
        defaultValue={SAMPLE}
        theme={theme}
        wikiLinks={wikiLinks}
        extensions={extensions}
        placeholder="Start writing"
        onReady={(view) => Object.assign(window, { editorView: view })}
        onOpenLink={(href) => setLog(`Open link: ${href}`)}
        style={{ flex: 1, minHeight: 0 }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
