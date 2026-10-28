import type { MarkdownConfig } from "@lezer/markdown";

const COLON = 58;

// Common GitHub shortcodes. Unknown ones stay as text.
export const EMOJI: Readonly<Record<string, string>> = {
  smile: "😄",
  smiley: "😃",
  grin: "😁",
  laughing: "😆",
  joy: "😂",
  wink: "😉",
  blush: "😊",
  heart_eyes: "😍",
  thinking: "🤔",
  neutral_face: "😐",
  confused: "😕",
  cry: "😢",
  sob: "😭",
  angry: "😠",
  scream: "😱",
  sunglasses: "😎",
  sweat_smile: "😅",
  upside_down_face: "🙃",
  "+1": "👍",
  thumbsup: "👍",
  "-1": "👎",
  thumbsdown: "👎",
  clap: "👏",
  pray: "🙏",
  wave: "👋",
  ok_hand: "👌",
  muscle: "💪",
  raised_hands: "🙌",
  point_right: "👉",
  eyes: "👀",
  heart: "❤️",
  broken_heart: "💔",
  sparkles: "✨",
  star: "⭐",
  fire: "🔥",
  zap: "⚡",
  boom: "💥",
  tada: "🎉",
  rocket: "🚀",
  bulb: "💡",
  memo: "📝",
  book: "📖",
  books: "📚",
  link: "🔗",
  lock: "🔒",
  key: "🔑",
  bug: "🐛",
  wrench: "🔧",
  hammer: "🔨",
  gear: "⚙️",
  package: "📦",
  warning: "⚠️",
  x: "❌",
  white_check_mark: "✅",
  heavy_check_mark: "✔️",
  question: "❓",
  exclamation: "❗",
  information_source: "ℹ️",
  100: "💯",
  coffee: "☕",
  computer: "💻",
  calendar: "📅",
  chart_with_upwards_trend: "📈",
  globe_with_meridians: "🌐",
  hourglass: "⌛",
  mag: "🔍",
  pushpin: "📌",
  construction: "🚧",
  art: "🎨",
};

/** `:name:` shortcodes from the table above. */
export const Emoji: MarkdownConfig = {
  defineNodes: ["Emoji"],
  parseInline: [
    {
      name: "Emoji",
      parse(cx, next, pos) {
        if (next !== COLON) return -1;
        const match = /^:([\w+-]+):/.exec(cx.slice(pos, Math.min(cx.end, pos + 40)));
        if (!match || !(match[1] in EMOJI)) return -1;
        return cx.addElement(cx.elt("Emoji", pos, pos + match[0].length));
      },
    },
  ],
};
