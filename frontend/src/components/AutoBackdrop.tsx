// Тематический фон: эскизы из /icons, разложенные по экрану (белым, еле заметно).
// Нет файла иконки — она просто не отображается. Свои SVG кладите в public/icons.
const ITEMS: { icon: string; x: number; y: number; size: number; rot: number }[] = [
  { icon: "car", x: 6, y: 9, size: 96, rot: -8 },
  { icon: "lift", x: 78, y: 6, size: 104, rot: 6 },
  { icon: "oil", x: 30, y: 4, size: 64, rot: 14 },
  { icon: "filter", x: 58, y: 14, size: 56, rot: -12 },
  { icon: "tire", x: 90, y: 34, size: 88, rot: 10 },
  { icon: "repair", x: 4, y: 40, size: 72, rot: 18 },
  { icon: "battery", x: 16, y: 62, size: 68, rot: -10 },
  { icon: "brake", x: 84, y: 66, size: 72, rot: -6 },
  { icon: "spark", x: 44, y: 84, size: 56, rot: 12 },
  { icon: "car", x: 70, y: 86, size: 92, rot: 7 },
  { icon: "tire", x: 6, y: 84, size: 80, rot: -14 },
  { icon: "oil", x: 92, y: 90, size: 56, rot: 16 },
  { icon: "filter", x: 24, y: 24, size: 48, rot: 8 },
  { icon: "repair", x: 66, y: 46, size: 52, rot: -18 },
];

export default function AutoBackdrop({ opacity = 0.09 }: { opacity?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden text-white" style={{ opacity }}>
      {ITEMS.map((it, i) => {
        const src = `/icons/${it.icon}.svg`;
        return (
          <span
            key={i}
            className="absolute inline-block bg-current"
            style={{
              left: `${it.x}%`,
              top: `${it.y}%`,
              width: it.size,
              height: it.size,
              transform: `translate(-50%, -50%) rotate(${it.rot}deg)`,
              WebkitMaskImage: `url(${src})`,
              maskImage: `url(${src})`,
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              maskPosition: "center",
              WebkitMaskSize: "contain",
              maskSize: "contain",
            }}
          />
        );
      })}
    </div>
  );
}
