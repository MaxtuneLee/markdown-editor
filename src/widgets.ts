import { StateEffect } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";

import { isMathLoaded, loadMath, renderMath } from "./mathRender";

/** Dispatched once KaTeX has loaded, so math redraws. */
const mathLoaded = StateEffect.define<null>();

export class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const bullet = document.createElement("span");
    bullet.className = "cm-md-bullet";
    bullet.setAttribute("aria-hidden", "true");
    return bullet;
  }
}

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-task";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.tabIndex = -1;
    input.setAttribute("aria-label", this.checked ? "Completed task" : "Task");
    input.addEventListener("mousedown", (event) => {
      event.preventDefault();
      if (view.state.readOnly) return;
      const pos = view.posAtDOM(wrap);
      if (!/^\[[ xX]\]$/.test(view.state.sliceDoc(pos, pos + 3))) return;
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: this.checked ? " " : "x" },
        userEvent: "input.toggle",
      });
    });
    // The document drives the checked state; a native toggle would race it.
    input.addEventListener("click", (event) => event.preventDefault());
    wrap.append(input);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const imageHeights = new Map<string, number>();

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly preview: boolean,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt && other.preview === this.preview;
  }

  get estimatedHeight(): number {
    return imageHeights.get(this.src) ?? (this.preview ? 160 : -1);
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement(this.preview ? "div" : "span");
    wrap.className = this.preview ? "cm-md-image cm-md-image-preview" : "cm-md-image";
    const image = document.createElement("img");
    image.src = this.src;
    image.alt = this.alt;
    image.loading = "lazy";
    image.decoding = "async";
    image.draggable = false;
    image.addEventListener("load", () => {
      imageHeights.set(this.src, image.offsetHeight);
      view.requestMeasure();
    });
    image.addEventListener("error", () => {
      wrap.classList.add("cm-md-image-broken");
      wrap.textContent = this.alt || this.src;
    });
    wrap.append(image);
    return wrap;
  }
}

const diagramCache = new Map<string, string>();
const diagramHeights = new Map<string, number>();
let diagramId = 0;

async function renderDiagram(code: string): Promise<string> {
  const cached = diagramCache.get(code);
  if (cached) return cached;
  const { renderAsync } = await import("pele/lazy");
  diagramId += 1;
  const { svg } = await renderAsync(code, { idPrefix: `mde-diagram-${diagramId}` });
  diagramCache.set(code, svg);
  return svg;
}

export class MermaidWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly preview: boolean,
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return other.code === this.code && other.preview === this.preview;
  }

  get estimatedHeight(): number {
    return diagramHeights.get(this.code) ?? 200;
  }

  toDOM(view: EditorView): HTMLElement {
    const block = document.createElement("div");
    block.className = "cm-md-diagram-block";
    const wrap = document.createElement("div");
    wrap.className = this.preview ? "cm-md-diagram cm-md-diagram-preview" : "cm-md-diagram";
    const canvas = document.createElement("div");
    canvas.className = "cm-md-diagram-canvas";
    wrap.append(canvas);
    block.append(wrap);

    const show = (svg: string): void => {
      canvas.innerHTML = svg;
      view.requestMeasure({
        read: () => block.offsetHeight,
        write: (height) => {
          if (height > 0) diagramHeights.set(this.code, height);
        },
      });
    };
    const cached = diagramCache.get(this.code);
    if (cached) {
      show(cached);
    } else {
      canvas.textContent = "Rendering diagram…";
      canvas.classList.add("cm-md-diagram-pending");
      renderDiagram(this.code)
        .then((svg) => {
          canvas.classList.remove("cm-md-diagram-pending");
          show(svg);
        })
        .catch((error: unknown) => {
          canvas.classList.remove("cm-md-diagram-pending");
          canvas.classList.add("cm-md-diagram-error");
          canvas.textContent = error instanceof Error ? error.message : "Couldn't render diagram";
        });
    }

    if (!this.preview) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "cm-md-block-button";
      edit.textContent = "Edit";
      edit.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const fence = view.state.doc.lineAt(view.posAtDOM(block));
        const anchor = Math.min(fence.to + 1, view.state.doc.length);
        view.dispatch({ selection: { anchor }, scrollIntoView: true });
        view.focus();
      });
      wrap.append(edit);
    }
    return block;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const mathHeights = new Map<string, number>();

/** TeX rendered with KaTeX. Shows the source until KaTeX has loaded, then redraws. */
export class MathWidget extends WidgetType {
  private readonly loaded = isMathLoaded();

  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly preview = false,
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return (
      other.tex === this.tex &&
      other.display === this.display &&
      other.preview === this.preview &&
      other.loaded === this.loaded
    );
  }

  get estimatedHeight(): number {
    return this.display ? (mathHeights.get(this.tex) ?? 48) : -1;
  }

  toDOM(view: EditorView): HTMLElement {
    const node = document.createElement(this.display ? "div" : "span");
    node.className = this.display
      ? `cm-md-math-block${this.preview ? " cm-md-math-preview" : ""}`
      : "cm-md-math";
    const html = renderMath(this.tex, this.display);
    if (html === null) {
      node.textContent = this.tex;
      node.classList.add("cm-md-math-pending");
      void loadMath().then((loaded) => {
        if (loaded && view.dom.isConnected) view.dispatch({ effects: mathLoaded.of(null) });
      });
    } else {
      node.innerHTML = html;
    }
    if (this.display) {
      view.requestMeasure({
        read: () => node.offsetHeight,
        write: (height) => {
          if (height > 0) mathHeights.set(this.tex, height);
        },
      });
    }
    return node;
  }
}

export class EmojiWidget extends WidgetType {
  constructor(readonly emoji: string) {
    super();
  }

  eq(other: EmojiWidget): boolean {
    return other.emoji === this.emoji;
  }

  toDOM(): HTMLElement {
    const node = document.createElement("span");
    node.className = "cm-md-emoji";
    node.textContent = this.emoji;
    return node;
  }
}

export class CalloutTitleWidget extends WidgetType {
  constructor(readonly title: string) {
    super();
  }

  eq(other: CalloutTitleWidget): boolean {
    return other.title === this.title;
  }

  toDOM(): HTMLElement {
    const node = document.createElement("span");
    node.className = "cm-md-callout-title";
    node.textContent = this.title;
    return node;
  }
}
