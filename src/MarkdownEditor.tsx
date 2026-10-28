import {
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type Ref,
  type RefObject,
} from "react";

import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { openLink, type MarkdownEditorConfig, type WikiLinkOptions } from "./config";
import { markdownEditorExtensions } from "./extensions";
import {
  createStreamWriter,
  externalChange,
  replaceDocument,
  setStreamingActive,
  type StreamWriter,
} from "./streaming";
import { invalidateWikiLinks } from "./wikiLinks";

export interface MarkdownEditorHandle {
  readonly view: EditorView | null;
  getValue(): string;
  /** Replaces the content without adding an undo step. */
  setValue(value: string): void;
  /** Queues a streamed chunk; chunks are applied once per frame. Starts streaming mode. */
  append(chunk: string): void;
  /** Applies queued chunks and leaves streaming mode. */
  finishStream(): void;
  /** Resolves every wiki link again, for example after a page was created. */
  refreshWikiLinks(): void;
  focus(): void;
}

export interface MarkdownEditorProps extends MarkdownEditorConfig {
  ref?: Ref<MarkdownEditorHandle>;
  /** Controlled content. Updates are applied as the smallest change, so streaming via props works. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Sets `data-theme`. Leave unset to inherit the theme from an ancestor's `data-theme`. */
  theme?: "dark" | "light";
  readOnly?: boolean;
  /** Content is still arriving: unfinished blocks at the end stay as source. */
  streaming?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Extra extensions, such as `markdownDiff()` from `memora-markdown-editor/diff`. */
  extensions?: Extension;
  className?: string;
  style?: CSSProperties;
  onReady?: (view: EditorView) => void;
}

export function MarkdownEditor({ ref, theme, className, style, ...options }: MarkdownEditorProps) {
  const hostRef = useMarkdownEditor(ref, options);
  return (
    <div
      ref={hostRef}
      className={className ? `mde ${className}` : "mde"}
      data-theme={theme}
      style={style}
    />
  );
}

type EditorOptions = Omit<MarkdownEditorProps, "ref" | "theme" | "className" | "style">;

/** Creates the editor in the returned host element and keeps it in sync with the options. */
function useMarkdownEditor(
  ref: Ref<MarkdownEditorHandle> | undefined,
  {
    value,
    defaultValue,
    onChange,
    readOnly = false,
    streaming = false,
    placeholder,
    autoFocus = false,
    extensions,
    onReady,
    ...config
  }: EditorOptions,
): RefObject<HTMLDivElement | null> {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const writerRef = useRef<StreamWriter | null>(null);
  const compartments = useRef({
    readOnly: new Compartment(),
    extra: new Compartment(),
  });

  // Callbacks are read through a ref so the editor is created once.
  const latest = useRef<LatestProps>({ onChange, onReady, config });
  latest.current = { onChange, onReady, config };
  // Editable unless the props say otherwise or a stream from the handle is running.
  const locked = readOnly || streaming;

  useEffect(() => {
    const view = mountView(hostRef.current, {
      value,
      defaultValue,
      placeholder,
      mermaid: config.mermaid,
      locked,
      streaming,
      autoFocus,
      extensions,
      compartments: compartments.current,
      latest,
    });
    viewRef.current = view;
    return () => {
      writerRef.current = null;
      viewRef.current = null;
      view?.destroy();
    };
    // The editor is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view && value !== undefined) replaceDocument(view, value);
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) applyLock(view, writerRef, compartments.current.readOnly, { locked, streaming });
  }, [locked, streaming]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.extra.reconfigure(extensions ?? []),
    });
  }, [extensions]);

  useImperativeHandle(
    ref,
    () => createHandle(viewRef, writerRef, compartments.current.readOnly, { locked, streaming }),
    [locked, streaming],
  );

  return hostRef;
}

interface LatestProps {
  onChange?: (value: string) => void;
  onReady?: (view: EditorView) => void;
  config: MarkdownEditorConfig;
}

interface ViewOptions {
  placeholder?: string;
  mermaid: MarkdownEditorConfig["mermaid"];
  locked: boolean;
  extensions?: Extension;
  compartments: { readOnly: Compartment; extra: Compartment };
  latest: RefObject<LatestProps>;
}

interface MountOptions extends ViewOptions {
  value?: string;
  defaultValue?: string;
  streaming: boolean;
  autoFocus: boolean;
}

function mountView(host: HTMLElement | null, options: MountOptions): EditorView | null {
  if (!host) return null;
  const view = createView(host, options.value ?? options.defaultValue ?? "", options);
  if (options.streaming) setStreamingActive(view, true);
  if (options.autoFocus) view.focus();
  options.latest.current.onReady?.(view);
  return view;
}

function createView(parent: HTMLElement, doc: string, options: ViewOptions): EditorView {
  const { compartments, latest } = options;
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdownEditorExtensions({
          placeholder: options.placeholder,
          ...delegatingConfig(() => latest.current.config),
          mermaid: options.mermaid,
        }),
        compartments.readOnly.of(readOnlyExtensions(options.locked)),
        compartments.extra.of(options.extensions ?? []),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (update.transactions.every((tr) => tr.annotation(externalChange))) return;
          latest.current.onChange?.(update.state.doc.toString());
        }),
      ],
    }),
  });
}

/** Flushes a finished stream and applies the read-only and streaming state. */
function applyLock(
  view: EditorView,
  writerRef: RefObject<StreamWriter | null>,
  compartment: Compartment,
  { locked, streaming }: { locked: boolean; streaming: boolean },
): void {
  if (!streaming) {
    writerRef.current?.flush();
    writerRef.current = null;
  }
  setStreamingActive(view, streaming);
  setReadOnly(view, compartment, locked);
}

function readOnlyExtensions(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

function setReadOnly(view: EditorView, compartment: Compartment, readOnly: boolean): void {
  view.dispatch({ effects: compartment.reconfigure(readOnlyExtensions(readOnly)) });
}

/** Options whose callbacks always call the latest props, so they never need reconfiguring. */
function delegatingConfig(read: () => MarkdownEditorConfig): MarkdownEditorConfig {
  const wikiLinks: WikiLinkOptions = {
    resolve: (target) => read().wikiLinks?.resolve?.(target) ?? true,
    suggest: (query) => read().wikiLinks?.suggest?.(query) ?? [],
    onOpen: (target, event) => read().wikiLinks?.onOpen?.(target, event),
  };
  return {
    wikiLinks,
    onOpenLink: (href, event) => openLink({ onOpenLink: read().onOpenLink }, href, event),
    resolveImageUrl: (src) => read().resolveImageUrl?.(src) ?? src,
  };
}

function createHandle(
  viewRef: RefObject<EditorView | null>,
  writerRef: RefObject<StreamWriter | null>,
  readOnlyCompartment: Compartment,
  props: { locked: boolean; streaming: boolean },
): MarkdownEditorHandle {
  const withView = (run: (view: EditorView) => void): void => {
    if (viewRef.current) run(viewRef.current);
  };
  return {
    get view() {
      return viewRef.current;
    },
    getValue: () => viewRef.current?.state.doc.toString() ?? "",
    setValue: (next) => withView((view) => replaceDocument(view, next)),
    append: (chunk) =>
      withView((view) => {
        if (!writerRef.current) {
          writerRef.current = createStreamWriter(view);
          setReadOnly(view, readOnlyCompartment, true);
        }
        writerRef.current.write(chunk);
      }),
    finishStream: () =>
      withView((view) => {
        writerRef.current?.close();
        writerRef.current = null;
        setStreamingActive(view, props.streaming);
        setReadOnly(view, readOnlyCompartment, props.locked);
      }),
    refreshWikiLinks: () => withView(invalidateWikiLinks),
    focus: () => viewRef.current?.focus(),
  };
}
