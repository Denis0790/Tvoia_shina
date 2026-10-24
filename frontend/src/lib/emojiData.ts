export const EMOJI_CATS = [
  {
    id: "smile",
    icon: "😀",
    title: "Смайлы",
    items:
      "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫡 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕".split(" "),
  },
  {
    id: "hands",
    icon: "👍",
    title: "Жесты",
    items:
      "👍 👎 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👋 🤚 🖐️ ✋ 🖖 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💪 🦾 👀 👂 🧠".split(" "),
  },
  {
    id: "auto",
    icon: "🚗",
    title: "Авто и сервис",
    items:
      "🚗 🚕 🚙 🚌 🏎️ 🚓 🚑 🚒 🚚 🚛 🛻 🏍️ 🛵 🚲 🛞 🔧 🔩 ⚙️ 🛠️ 🪛 🪚 🧰 ⛽ 🛢️ 🔋 🔌 💡 🚦 🚥 🛑 ⚠️ 🅿️ 🧽 🧴 🪣 🧼 ❄️ ☀️ 🌧️ ⛄ 🛣️ 🏁 📍 🗓️ ⏰ 🕙 ✅ ❌ 📞 💬 📷".split(" "),
  },
  {
    id: "symbols",
    icon: "❤️",
    title: "Сердца и символы",
    items:
      "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 ✨ ⭐ 🌟 💫 🔥 💯 ✔️ ❗ ❓ ‼️ ⁉️ 💥 💢 💤 🎉 🎊 🎁 🏆 🥇 🍀 🌈 ☕ 🍕 🍔 🍺".split(" "),
  },
];

export const RECENT_ICON = "🕘";

/** Ключ файла эмодзи: коды символов через «_», без селектора FE0F (например 2764). */
export function emojiKey(e: string): string {
  return Array.from(e)
    .map((c) => c.codePointAt(0)!.toString(16))
    .filter((h) => h !== "fe0f")
    .join("_");
}

// пиктограмма + возможные модификаторы / склейки (ZWJ)
const EMOJI_RE = /(\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic})*)/u;

export type TextPart = { v: string; emoji: boolean };

export function splitEmoji(text: string): TextPart[] {
  return text
    .split(EMOJI_RE)
    .map((v, i) => ({ v, emoji: i % 2 === 1 && (v.codePointAt(0) ?? 0) >= 0x203c }))
    .reduce<TextPart[]>((acc, p) => {
      if (!p.v) return acc;
      const last = acc[acc.length - 1];
      if (last && !last.emoji && !p.emoji) last.v += p.v;
      else acc.push(p);
      return acc;
    }, []);
}

/** Сообщение только из 1–3 эмодзи (и пробелов) — показываем крупно и с анимацией. */
export function isEmojiOnly(text: string): boolean {
  const parts = splitEmoji(text).filter((p) => p.emoji || p.v.trim() !== "");
  return parts.length >= 1 && parts.length <= 3 && parts.every((p) => p.emoji);
}
