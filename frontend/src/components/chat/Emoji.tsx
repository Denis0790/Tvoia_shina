"use client";

import { useState } from "react";
import { emojiKey } from "@/lib/emojiData";

/** Эмодзи картинкой (Noto, лежит в /public/emoji). Если файла нет — обычный символ. */
export default function Emoji({
  char,
  size = 24,
  animated = false,
  className = "",
}: {
  char: string;
  size?: number;
  animated?: boolean;
  className?: string;
}) {
  const [stage, setStage] = useState(0);
  const key = emojiKey(char);
  const srcs = animated ? [`/emoji/${key}.webp`, `/emoji/${key}.svg`] : [`/emoji/${key}.svg`];
  if (stage >= srcs.length) {
    return (
      <span className={className} style={{ fontSize: size * 0.85, lineHeight: 1 }}>
        {char}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={srcs[stage]}
      alt={char}
      width={size}
      height={size}
      draggable={false}
      loading="lazy"
      onError={() => setStage((s) => s + 1)}
      className={`inline-block select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
