import { apiFetch } from "@/lib/auth";
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

export async function logout() {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
}

export type Car = {
  id: string;
  make: string;
  model: string;
  color: string | null;
  vin: string | null;
  plate: string | null;
};

export async function getCars(): Promise<Car[]> {
  const res = await apiFetch("/users/me/cars");
  if (!res.ok) return [];
  return res.json();
}

export async function createCar(payload: Omit<Car, "id">): Promise<Car | null> {
  const res = await apiFetch("/users/me/cars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function deleteCar(id: string): Promise<boolean> {
  const res = await apiFetch(`/users/me/cars/${id}`, { method: "DELETE" });
  return res.ok;
}
