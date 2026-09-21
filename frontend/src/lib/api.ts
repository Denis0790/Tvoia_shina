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

export type Service = { id: string; name: string; duration_minutes: number };

export async function getServices(): Promise<Service[]> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const res = await fetch(`${API_URL}/services`);
  if (!res.ok) return [];
  return res.json();
}

export type PostSlot = { time: string; free: boolean };
export type PostAvailability = { post_id: string; name: string; working: boolean; slots: PostSlot[] };

export async function getAvailability(targetDate: string): Promise<PostAvailability[]> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const res = await fetch(`${API_URL}/availability/slots?target_date=${targetDate}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.posts;
}

export type MyBooking = {
  id: string;
  date: string;
  start_time: string;
  duration_minutes: number;
  status: string;
  post_id: string | null;
  comment: string | null;
} | null;

export async function getMyBooking(): Promise<MyBooking> {
  const res = await apiFetch("/bookings/me");
  if (!res.ok) return null;
  return res.json();
}

export async function createBooking(payload: {
  car_id: string | null;
  date: string;
  start_time: string;
  service_ids: string[];
  comment: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch("/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    return { ok: false, error: data?.detail || "Не удалось создать запись" };
  }
  return { ok: true };
}

export async function managerLogin(login: string, password: string) {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const res = await fetch(
    `${API_URL}/auth/manager-login?login=${encodeURIComponent(login)}&password=${encodeURIComponent(password)}`,
    { method: "POST", credentials: "include" }
  );
  if (!res.ok) throw new Error("Неверный логин или пароль");
  return res.json();
}
