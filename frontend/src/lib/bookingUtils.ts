import type { PostAvailability } from "@/lib/api";

export const DAYS_AHEAD = 21;

export function formatDuration(min: number) {
  if (min % 30 === 0) return `${String(min / 60).replace(".", ",")} ч`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h ? `${h} ч` : ""}${h && m ? " " : ""}${m ? `${m} мин` : ""}` || "0 мин";
}

// даты считаем по Москве: сервер работает по московскому времени
export function mskToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayParts(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return {
    wd: d.toLocaleDateString("ru-RU", { weekday: "short", timeZone: "UTC" }),
    num: d.getUTCDate(),
    mon: d.toLocaleDateString("ru-RU", { month: "short", timeZone: "UTC" }).replace(".", ""),
  };
}

export function longDay(iso: string) {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
    timeZone: "UTC",
  });
}

export function fitsInfo(post: PostAvailability, time: string, need: number): { spill: boolean } | null {
  const idx = post.slots.findIndex((s) => s.time === time);
  if (idx === -1) return null;
  for (let k = 0; k < need; k++) {
    const slot = post.slots[idx + k];
    if (!slot) return { spill: true }; // работы не помещаются до конца дня — продолжатся на следующий
    if (!slot.free) return null;
  }
  return { spill: false };
}
