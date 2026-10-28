import { vi } from "vite-plus/test";

// jsdom has no layout. CodeMirror measures text through these, so give it empty rects.
const emptyRects = (): DOMRectList =>
  Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

// Pele measures text with a canvas, which jsdom doesn't implement.
vi.mock("pele/lazy", () => ({
  renderAsync: async (source: string) => ({ svg: `<svg data-source="${source.length}"></svg>` }),
}));
