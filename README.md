# memora-markdown-editor

A markdown editor for React with WYSIWYM live preview.

## Introduction

It follows [CommonMark](https://spec.commonmark.org/) with
[GitHub Flavored Markdown](https://github.github.com/gfm/) (tables, task lists, strikethrough and
autolinks), and adds `==highlights==`, `[[wiki links]]`, `$math$` and `$$math$$`,
`::: callouts`, `:emoji:` shortcodes and ` ```mermaid ` diagrams. HTML stays as source.

## Features

- **Live preview.** Markdown renders in place, and raw syntax shows only on the line you are
  editing. The document stays plain markdown, byte for byte.
- **Tables that edit like a spreadsheet.** Edit cells in place, select ranges, rows and columns,
  insert, align and delete them, and copy or paste cells to and from a spreadsheet.
- **Code blocks** highlighted by Shiki, with grammars loaded on demand, file names in the fence
  info and diff lines.
- **Math** rendered by KaTeX as MathML, so no extra stylesheet or fonts are needed.
- **Mermaid diagrams** rendered by Pele.
- **Wiki links** with async resolution, completion after `[[` and your own click handler.
- **Task lists, callouts and emoji shortcodes.**
- **Streaming.** Append chunks as a model writes; an unfinished table, diagram or formula stays
  as source until it closes.
- **Diff view** with Accept and Reject on each change, in a separate entry point.
- **Markdown on the clipboard.** Copying a rendered bold word gives you `**word**`.
- **Theming** through CSS variables, with light and dark built in. The styles sit in a cascade
  layer, so your CSS, Tailwind CSS or StyleX overrides them without specificity tricks.
- **Safe defaults.** HTML stays as source, and `javascript:` links never open.

## Getting started

Install the package. React 19 is a peer dependency:

```sh
pnpm add memora-markdown-editor
```

Import the stylesheet once, then render the editor. It can be uncontrolled with `defaultValue`
or controlled with `value`:

```tsx
import { MarkdownEditor } from "memora-markdown-editor";
import "memora-markdown-editor/styles.css";

export function Note({ text, setText }: { text: string; setText: (text: string) => void }) {
  return <MarkdownEditor value={text} onChange={setText} theme="light" />;
}
```

The editor grows with its content. To scroll inside it instead, give it a height through `style`
or `className`, for example `style={{ flex: 1, minHeight: 0 }}` in a flex column. A controlled
`value` is applied as the smallest change to the document, and doesn't call
`onChange`.

For imperative access, pass a ref:

```tsx
const editor = useRef<MarkdownEditorHandle>(null);

<MarkdownEditor ref={editor} defaultValue={text} />;

editor.current?.getValue();
editor.current?.focus();
```

To build an editor without React, use `markdownEditorExtensions(options)` with your own
`EditorView`. It takes the same options as the `wikiLinks`, `onOpenLink`, `resolveImageUrl`,
`mermaid` and `placeholder` props.

## Configuration

### Props

| Prop              | Default         | Description                                                                                                            |
| ----------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `value`           |                 | Controlled content.                                                                                                    |
| `defaultValue`    | `""`            | Initial content when uncontrolled.                                                                                     |
| `onChange`        |                 | Called with the new markdown after an edit.                                                                            |
| `theme`           |                 | `"dark"` or `"light"`. Unset, the editor follows an ancestor's `data-theme`, and is dark without one.                  |
| `readOnly`        | `false`         | Prevents editing, including table cells and checkboxes.                                                                |
| `streaming`       | `false`         | Content is still arriving. See [Streaming](#streaming).                                                                |
| `placeholder`     |                 | Text shown while the document is empty.                                                                                |
| `autoFocus`       | `false`         | Focuses the editor when it mounts.                                                                                     |
| `wikiLinks`       |                 | See [Wiki links](#wiki-links).                                                                                         |
| `onOpenLink`      | opens a new tab | Called with the href when a rendered link is clicked. `javascript:`, `vbscript:` and `data:` links never open.         |
| `resolveImageUrl` |                 | Maps an image's markdown source, such as a relative path, to a loadable URL.                                           |
| `mermaid`         | `true`          | Renders ` ```mermaid ` blocks as diagrams.                                                                             |
| `extensions`      |                 | Extra CodeMirror extensions, such as `markdownDiff()`. Keep the value stable, since a new one reconfigures the editor. |
| `className`       |                 | Added to the `.mde` host element.                                                                                      |
| `style`           |                 | Inline style for the `.mde` host element.                                                                              |
| `onReady`         |                 | Called with the `EditorView` once it is created.                                                                       |

### Handle

| Member               | Description                                                           |
| -------------------- | --------------------------------------------------------------------- |
| `view`               | The CodeMirror `EditorView`, or `null` before mount.                  |
| `getValue()`         | The current markdown.                                                 |
| `setValue(text)`     | Replaces the content without adding an undo step.                     |
| `append(chunk)`      | Queues a streamed chunk and enters streaming mode.                    |
| `finishStream()`     | Applies queued chunks and leaves streaming mode.                      |
| `refreshWikiLinks()` | Resolves every wiki link again, for example after a page was created. |
| `focus()`            | Focuses the editor.                                                   |

### Wiki links

```tsx
<MarkdownEditor
  wikiLinks={{
    resolve: (target) => pages.has(target),
    suggest: (query) => searchPages(query),
    onOpen: (target) => openPage(target),
  }}
/>
```

`resolve` and `suggest` may return promises. Targets that resolve to `false` use the missing-link
style.

### Streaming

Content can arrive in chunks, for example from a model. Either update `value` as text arrives
with `streaming` set, or use the handle:

```tsx
editor.current?.append(chunk); // applied once per frame
editor.current?.finishStream();
```

While streaming, the editor is read-only and the unfinished block at the end stays as source, so
half-written tables, diagrams, math and callouts don't flicker. Completed blocks render as soon as
they close. Each chunk is applied as one small change at the end of the document.
`createStreamWriter(view)` does the same without React.

### Diff

The diff view is a separate entry point, so it isn't bundled unless you use it:

```tsx
import { acceptAllChanges, markdownDiff } from "memora-markdown-editor/diff";

const diff = useMemo(() => markdownDiff({ original }), [original]);

<MarkdownEditor value={revised} extensions={diff} />;
```

Removed text appears above its replacement, with Accept and Reject on each change.
Ctrl/Cmd+Alt+Up and Down move between changes. `acceptAllChanges(view)` and
`rejectAllChanges(view)` resolve every change at once.

### Styling

Every color, font and size is a `--mde-*` variable in `styles.css`; code colors are
`--mde-code-token-*` and diagram colors are `--pele-*`. Set the variables on the `.mde` element
itself, through `className`, `style` or a selector such as `.notes .mde`. The defaults are
declared on `.mde`, so a value set only on an ancestor doesn't reach it.

```css
.notes .mde {
  --mde-font: var(--app-font);
  --mde-accent: var(--app-accent);
  --mde-radius: 4px; /* code blocks, tables, panels; smaller corners scale from it */
  --mde-heading-font: var(--app-display-font);
  --mde-heading-weight: 600;
  --mde-h1-size: 2.2em; /* also --mde-h2-size, --mde-h3-size, --mde-h4-size */
  --mde-block-gap: 0.75em; /* between blocks, with or without blank lines in the source */
  --mde-heading-gap: 1.6em; /* above a heading */
}
```

Keep passing `theme` even when your variables follow your app's theme: it sets `color-scheme`,
which native controls such as the task checkboxes and scrollbars follow.

The editor's rules sit in the `mde` cascade layer, so any unlayered rule of yours wins regardless
of specificity, such as `.cm-md-h1 { letter-spacing: 0 }`. If your own styles are in layers too,
declare the order once so `mde` comes first, for example `@layer mde, base, components;`. Line
padding and the diff view's styles stay outside the layer, because CodeMirror's own unlayered
styles set the same properties; override those with a selector at least as specific as the one in
`styles.css`.

#### Tailwind CSS

Tailwind v4 puts its output in the `theme`, `base`, `components` and `utilities` layers. Declare
`mde` before them in your main stylesheet so utilities override the editor:

```css
@layer mde, theme, base, components, utilities;
@import "tailwindcss";
```

Then set variables with arbitrary properties. They land on the `.mde` element through
`className`, and an arbitrary variant reaches the editor's inner elements:

```tsx
<MarkdownEditor
  theme={isDark ? "dark" : "light"}
  className={[
    "[--mde-font:var(--font-sans)]",
    "[--mde-accent:var(--color-blue-600)]",
    "[--mde-radius:var(--radius-md)]",
    "[&_.cm-md-h1]:tracking-tight",
  ].join(" ")}
/>
```

#### StyleX

Spread `stylex.props` onto the editor and use `--mde-*` names as keys in `stylex.create`, so the
variables follow your StyleX tokens, including a theme switched with `stylex.createTheme`:

```tsx
import * as stylex from "@stylexjs/stylex";

import { tokens } from "./tokens.stylex";

const styles = stylex.create({
  editor: {
    "--mde-bg": tokens.background,
    "--mde-fg": tokens.text,
    "--mde-accent": tokens.accent,
    "--mde-heading-font": tokens.fontSerif,
    "--mde-radius": tokens.radiusSmall,
  },
});

<MarkdownEditor theme={isDark ? "dark" : "light"} {...stylex.props(styles.editor)} />;
```

StyleX's atomic classes win against the `mde` layer when StyleX emits unlayered CSS, which is the
`@stylexjs/unplugin` default for Vite (`useCSSLayers: false`). With `useCSSLayers: true`, make
sure `mde` is declared before StyleX's `priority*` layers. StyleX can't select descendants, so
anything without a variable, such as heading letter spacing, goes in a plain stylesheet.

## Contributing

Report bugs and ideas in the [issues](https://github.com/MaxtuneLee/memora-markdown-editor/issues).
The project uses pnpm and [Vite+](https://viteplus.dev). Clone the repository, run `pnpm install`,
then:

| Task                                  | Command           |
| ------------------------------------- | ----------------- |
| Playground at `http://localhost:9006` | `pnpm playground` |
| Tests                                 | `pnpm test`       |
| Type check, including the playground  | `pnpm typecheck`  |
| Lint                                  | `pnpm lint`       |
| Format                                | `pnpm format`     |
| Build `dist`                          | `pnpm build`      |

The playground renders the editor from `src` with a sample document, wiki links, a theme switch
and the diff view, and keeps the view on `window.editorView` for inspection.

Tests run in jsdom and live in `test/`. A change to rendering or editing behavior should come with
a test in `test/editor.test.tsx`; parsing and table logic have their own files. A change to
`styles.css` can't be covered by jsdom, so check it in the playground in both themes.

Where things are in `src/`:

- `MarkdownEditor.tsx`: the React component and its handle.
- `extensions.ts`: the full extension set, also exported as `markdownEditorExtensions`.
- `livePreview.ts` and `blockPreview.ts`: inline decorations, and block widgets such as tables,
  diagrams and display math.
- `syntax/`: the Lezer extensions for highlights, wiki links, math, callouts and emoji.
- `streaming.ts` and `blocks.ts`: streamed input and the boundary of the finished blocks.
- `styles.css` and `theme.ts`: the stylesheet and the colors CodeMirror applies itself.

To release, bump `version` in `package.json` and run `pnpm publish`. Use pnpm rather than npm: it
replaces the `catalog:` versions in `pnpm-workspace.yaml` with real ones, and `prepublishOnly`
builds `dist` first.

## License

[MIT](./LICENSE)
