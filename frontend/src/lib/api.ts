const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function requestCode(phone: string) {
  const res = await fetch(`${API_URL}/auth/request-code?phone=${encodeURIComponent(phone)}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Не удалось запросить код");
  return res.json();
}

export async function verifyCode(phone: string, code: string) {
  const res = await fetch(
    `${API_URL}/auth/verify-code?phone=${encodeURIComponent(phone)}&code=${encodeURIComponent(code)}`,
    { method: "POST", credentials: "include" }
  );
  if (!res.ok) throw new Error("Неверный код");
  return res.json();
}
