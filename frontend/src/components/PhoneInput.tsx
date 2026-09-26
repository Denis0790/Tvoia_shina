"use client";

function formatPhone(digits: string): string {
  const d = digits.slice(0, 10);
  let out = "+7";
  if (d.length > 0) out += ` (${d.slice(0, 3)}`;
  if (d.length >= 3) out += `) ${d.slice(3, 6)}`;
  if (d.length >= 6) out += `-${d.slice(6, 8)}`;
  if (d.length >= 8) out += `-${d.slice(8, 10)}`;
  return out;
}

export function phoneToDigits(display: string): string {
  const raw = display.replace(/\D/g, "");
  return raw.startsWith("7") || raw.startsWith("8") ? raw.slice(1) : raw;
}

export default function PhoneInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (digits: string) => void;
  className?: string;
}) {
  const display = formatPhone(value);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = phoneToDigits(e.target.value);
    onChange(digits);
  }

  return (
    <input
      type="tel"
      inputMode="numeric"
      value={display}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder="+7 (999) 123-45-67"
      className={className}
    />
  );
}
