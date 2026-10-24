export default function Ico({ name, className = "w-5 h-5" }: { name: string; className?: string }) {
  const src = `/icons/${name}.svg`;
  return (
    <span
      aria-hidden
      className={`inline-block flex-shrink-0 bg-current ${className}`}
      style={{
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
}
