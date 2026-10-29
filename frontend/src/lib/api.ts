import { apiFetch } from "@/lib/auth";
import { managerApiFetch } from "@/lib/managerAuth";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function requestCode(phone: string) {
  const res = await fetch(`${API_URL}/auth/request-code?phone=${encodeURIComponent(phone)}`, {
    method: "POST",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail || "Не удалось запросить код");
  }
  return res.json();
}

export async function verifyCode(phone: string, code: string): Promise<{ ticket: string }> {
  const res = await fetch(
    `${API_URL}/auth/verify-code?phone=${encodeURIComponent(phone)}&code=${encodeURIComponent(code)}`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error("Неверный код");
  return res.json();
}

export async function setPassword(ticket: string, password: string) {
  const res = await fetch(
    `${API_URL}/auth/set-password?ticket=${encodeURIComponent(ticket)}&password=${encodeURIComponent(password)}`,
    { method: "POST", credentials: "include" }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail || "Не удалось задать пароль");
  }
  return res.json();
}

export async function login(phone: string, password: string) {
  const res = await fetch(
    `${API_URL}/auth/login?phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}`,
    { method: "POST", credentials: "include" }
  );
  if (!res.ok) {
    const err: { status: number; detail: string } = {
      status: res.status,
      detail: "Ошибка входа",
    };
    const data = await res.json().catch(() => null);
    if (data?.detail) err.detail = data.detail;
    throw err;
  }
  return res.json();
}

export async function logout() {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
}

export type Me = {
  id: string;
  phone: string | null;
  full_name: string | null;
  role: string;
};

export async function getMe(): Promise<Me | null> {
  const res = await apiFetch("/users/me");
  if (!res.ok) return null;
  return res.json();
}

export async function updateMyName(fullName: string): Promise<boolean> {
  const res = await apiFetch("/users/me/name", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: fullName }),
  });
  return res.ok;
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

export async function updateCar(id: string, payload: Omit<Car, "id">): Promise<Car | null> {
  const res = await apiFetch(`/users/me/cars/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return null;
  return res.json();
}

export type HistoryItem = {
  id: string;
  date: string;
  start_time: string;
  duration_minutes: number;
  services: string[];
  comment: string | null;
};

export async function getCarHistory(carId: string): Promise<HistoryItem[]> {
  const res = await apiFetch(`/bookings/history?car_id=${encodeURIComponent(carId)}`);
  if (!res.ok) return [];
  return res.json();
}

export async function deleteCar(id: string): Promise<boolean> {
  const res = await apiFetch(`/users/me/cars/${id}`, { method: "DELETE" });
  return res.ok;
}

export type Service = { id: string; name: string; duration_minutes: number; category?: string | null };

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

// Свободные окна на дату; excludeId: своя запись при переносе не считается занятой
export async function getAvailabilityExcluding(date: string, excludeId: string | null): Promise<PostAvailability[]> {
  const extra = excludeId ? `&exclude_booking_id=${encodeURIComponent(excludeId)}` : "";
  const res = await fetch(`${API_URL}/availability/slots?target_date=${date}${extra}`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  return data.posts as PostAvailability[];
}

export type MyBookingItem = {
  id: string;
  date: string;
  start_time: string;
  duration_minutes: number;
  status: string;
  comment: string | null;
  services: string[];
  car: string | null;
  carry_over: boolean;
  total_minutes: number;
};

export async function getMyBookings(): Promise<MyBookingItem[]> {
  const res = await apiFetch("/bookings/mine");
  if (!res.ok) return [];
  return res.json();
}

async function actionResult(res: Response, fallback: string): Promise<{ ok: boolean; error?: string }> {
  if (res.ok) return { ok: true };
  let error = fallback;
  try {
    const j = await res.json();
    if (typeof j.detail === "string") error = j.detail;
  } catch {}
  return { ok: false, error };
}

export async function cancelMyBooking(id: string) {
  return actionResult(await apiFetch(`/bookings/${id}/cancel-mine`, { method: "POST" }), "Не удалось отменить запись");
}

export async function rescheduleMyBooking(id: string, date: string, startTime: string) {
  return actionResult(
    await apiFetch(`/bookings/${id}/reschedule-mine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, start_time: startTime }),
    }),
    "Не удалось перенести запись"
  );
}

export async function createBooking(payload: {
  car_id: string | null;
  post_id?: string | null;
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

export type PendingBooking = {
  id: string;
  user_id: string;
  car_id: string | null;
  date: string;
  start_time: string;
  duration_minutes: number;
  comment: string | null;
};

export async function getPendingBookings(): Promise<PendingBooking[]> {
  const res = await managerApiFetch("/bookings/pending");
  if (!res.ok) return [];
  return res.json();
}

export async function confirmBooking(
  id: string,
  postId: string,
  durationMinutes?: number,
  startTime?: string,
  comment?: string
) {
  const res = await managerApiFetch(`/bookings/${id}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ post_id: postId, duration_minutes: durationMinutes, start_time: startTime, comment: comment ?? null }),
  });
  return res.ok;
}

export async function declineBooking(id: string, comment?: string) {
  const res = await managerApiFetch(`/bookings/${id}/decline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comment: comment ?? null }),
  });
  return res.ok;
}

export async function rescheduleBooking(id: string, postId: string, startTime: string, date?: string) {
  const res = await managerApiFetch(`/bookings/${id}/reschedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ post_id: postId, start_time: startTime, ...(date ? { date } : {}) }),
  });
  return res.ok;
}

export type ManualBookingInput = {
  post_id: string;
  date: string;
  start_time: string;
  duration_minutes: number;
  phone?: string | null;
  car_id?: string | null;
  client_name?: string | null;
  car_make?: string | null;
  car_model?: string | null;
  vin?: string | null;
  comment?: string | null;
  service_ids?: string[];
  services_text?: string | null;
  user_id?: string | null;
  car_plate?: string | null;
};

// Запись, которую менеджер вносит сам (клиент пришёл без регистрации). Клиент ищется по телефону
// или создаётся; когда он позже зарегистрируется по этому номеру, запись окажется у него.
export async function createManualBooking(
  data: ManualBookingInput
): Promise<{ ok: true; id: string; user_id: string; created_user: boolean } | { ok: false; error: string }> {
  const res = await managerApiFetch("/bookings/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body && typeof body.detail === "string" ? body.detail : "Не удалось создать запись";
    return { ok: false, error: detail };
  }
  const body = await res.json();
  return { ok: true, ...body };
}

export type BookingClientMatch = {
  user_id: string;
  phone: string | null;
  kind: "person" | "org";
  inn: string | null;
  full_name: string | null;
  cars: { id: string; make: string; model: string; vin: string | null; plate: string | null }[];
  upcoming: { date: string; start_time: string; post_name: string | null; status: "pending" | "confirmed" }[];
  upcoming_total: number;
};

// Подсказки по началу номера (цифры после +7, от 3 штук) для формы «Новая запись»
export async function searchClientsForBooking(digits: string): Promise<BookingClientMatch[]> {
  const res = await managerApiFetch(`/bookings/manual/clients?q=${encodeURIComponent(digits)}`);
  if (!res.ok) return [];
  return res.json();
}

export async function cancelBooking(id: string, comment?: string) {
  const res = await managerApiFetch(`/bookings/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comment: comment ?? null }),
  });
  return res.ok;
}

export type PostInfo = { id: string; name: string; work_start: string; work_end: string; work_days: string };

export async function getPosts(): Promise<PostInfo[]> {
  const res = await managerApiFetch("/posts");
  if (!res.ok) return [];
  return res.json();
}

export type PostInput = { name: string; work_start: string; work_end: string; work_days: string };

export async function createPost(data: PostInput): Promise<PostInfo | null> {
  const res = await managerApiFetch("/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function updatePost(id: string, data: Partial<PostInput>): Promise<PostInfo | null> {
  const res = await managerApiFetch(`/posts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function deletePost(id: string) {
  const res = await managerApiFetch(`/posts/${id}`, { method: "DELETE" });
  return res.ok;
}

export type ExceptionKind = "dayoff" | "vacation" | "sick" | "repair" | "other";

export type ScheduleException = {
  id: string;
  date: string;
  is_working: boolean;
  work_start: string | null;
  work_end: string | null;
  kind: ExceptionKind;
  note: string | null;
};

export async function getScheduleExceptions(postId: string): Promise<ScheduleException[]> {
  const res = await managerApiFetch(`/posts/${postId}/exceptions`);
  if (!res.ok) return [];
  return res.json();
}

export async function setScheduleException(
  postId: string,
  data: { date: string; is_working: boolean; work_start?: string | null; work_end?: string | null }
): Promise<ScheduleException | null> {
  const res = await managerApiFetch(`/posts/${postId}/exceptions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function deleteScheduleException(postId: string, date: string) {
  const res = await managerApiFetch(`/posts/${postId}/exceptions/${date}`, { method: "DELETE" });
  return res.ok;
}

// Период недоступности (отпуск, больничный, ремонт) или нестандартных часов на несколько дней.
// В ответе conflicts — сколько живых записей клиентов уже стоит на посту в этот период.
export async function setScheduleExceptionRange(
  postId: string,
  data: {
    date_from: string;
    date_to: string;
    is_working?: boolean;
    work_start?: string | null;
    work_end?: string | null;
    kind: ExceptionKind;
    note?: string | null;
  }
): Promise<{ days: number; conflicts: number } | null> {
  const res = await managerApiFetch(`/posts/${postId}/exceptions/range`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function deleteScheduleExceptionPeriod(postId: string, dateFrom: string, dateTo: string) {
  const res = await managerApiFetch(
    `/posts/${postId}/exceptions/period?date_from=${dateFrom}&date_to=${dateTo}`,
    { method: "DELETE" }
  );
  return res.ok;
}

export type ClientCarSummary = { make: string; model: string; vin: string | null };

export type ClientRow = {
  id: string;
  phone: string | null;
  full_name: string | null;
  manager_note: string | null;
  kind: "person" | "org";
  inn: string | null;
  login: string | null;
  created_at: string;
  bookings_count: number;
  car: ClientCarSummary | null;
};

export async function getClients(): Promise<ClientRow[]> {
  const res = await managerApiFetch("/users/clients");
  if (!res.ok) return [];
  return res.json();
}

export async function updateClientNote(userId: string, note: string) {
  const res = await managerApiFetch(`/users/clients/${userId}/note`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  return res.ok;
}

export type ClientCar = {
  id: string;
  make: string;
  model: string;
  color: string | null;
  vin: string | null;
  plate: string | null;
};

export async function getCarsByUser(userId: string): Promise<ClientCar[]> {
  const res = await managerApiFetch(`/users/me/cars/by-user/${userId}`);
  if (!res.ok) return [];
  return res.json();
}

export type ClientBooking = {
  id: string;
  date: string; // YYYY-MM-DD
  start_time: string;
  duration_minutes: number;
  status: string;
  comment: string | null;
  services_text: string | null;
  post_name: string | null;
  car: { id: string; make: string; model: string; plate: string | null; vin: string | null } | null;
  services: { id: string; name: string }[];
};

export async function getBookingsByUser(userId: string): Promise<ClientBooking[]> {
  const res = await managerApiFetch(`/users/clients/${userId}/bookings`);
  if (!res.ok) return [];
  return res.json();
}

export type CalendarCar = {
  make: string;
  model: string;
  vin: string | null;
  plate?: string | null;
};

export type CalendarService = {
  id: string;
  name: string;
  duration_minutes: number;
};

export type CalendarBooking = {
  id: string;
  user_id: string;
  is_guest: boolean; // запись «с улицы» без номера — клиента в базе нет
  is_org?: boolean;
  post_id: string;
  client_name: string;
  phone: string | null;
  start_time: string;
  duration_minutes: number;
  comment: string | null;
  services_text: string | null;
  group_id: string | null; // длинная запись, разбитая по дням
  part: number; // 0 — первая часть, >0 — продолжение на следующий день
  car: CalendarCar | null;
  services: CalendarService[];
};

export type CalendarSlot = {
  time: string;
  status: "free" | "pending" | "confirmed";
  is_start: boolean;
  booking: CalendarBooking | null;
};

export type CalendarPost = {
  post_id: string;
  name: string;
  working: boolean;
  day_off?: boolean;
  slots: CalendarSlot[];
};

export type CalendarResponse = {
  date: string;
  posts: CalendarPost[];
};

export async function getCalendar(targetDate: string): Promise<CalendarResponse> {
  const res = await managerApiFetch(`/bookings/calendar?target_date=${targetDate}`);
  if (!res.ok) return { date: targetDate, posts: [] };
  return res.json();
}

export async function movePendingBooking(id: string, postId: string, startTime: string, date?: string) {
  const res = await managerApiFetch(`/bookings/${id}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ post_id: postId, start_time: startTime, ...(date ? { date } : {}) }),
  });
  return res.ok;
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof body?.detail === "string" ? body.detail : fallback;
    throw new Error(detail);
  }
  return body as T;
}

export type OrgCredentials = { login: string; password: string };

export async function createOrg(data: {
  name: string;
  inn: string;
  note?: string;
}): Promise<OrgCredentials & { id: string }> {
  const res = await managerApiFetch("/users/clients/org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow(res, "Не удалось создать организацию");
}

export async function resetOrgPassword(userId: string): Promise<OrgCredentials> {
  const res = await managerApiFetch(`/users/clients/${userId}/reset-password`, { method: "POST" });
  return jsonOrThrow(res, "Не удалось сбросить пароль");
}

export type CarInput = {
  make: string;
  model: string;
  color?: string | null;
  vin?: string | null;
  plate?: string | null;
};

export async function createCarForUser(userId: string, data: CarInput): Promise<ClientCar> {
  const res = await managerApiFetch(`/users/me/cars/by-user/${userId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow(res, "Не удалось добавить машину");
}

export async function updateCarForUser(userId: string, carId: string, data: CarInput): Promise<ClientCar> {
  const res = await managerApiFetch(`/users/me/cars/by-user/${userId}/${carId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow(res, "Не удалось сохранить машину");
}


// ---------- Главная: профиль сервиса, галерея, новости ----------

export type StatItem = { value: string; label: string };
export type TextItem = { title: string; text: string | null };
export type ReviewItem = { name: string; text: string; rating: number; car: string | null };

export type ServiceProfile = {
  name: string;
  tagline: string | null;
  description: string | null;
  phone: string | null;
  address: string | null;
  work_hours: string | null;
  lat: number | null;
  lng: number | null;
  logo_url: string | null;
  cover_url: string | null;
  max_link: string | null;
  hero_title: string | null;
  stats: StatItem[];
  advantages: TextItem[];
  steps: TextItem[];
  reviews: ReviewItem[];
};
export type ProfilePhoto = { id: string; url: string };
export type NewsItem = { id: string; title: string; body: string | null; image_url: string | null; created_at: string | null };
export type ProfileData = { profile: ServiceProfile; photos: ProfilePhoto[]; news: NewsItem[] };

export function imageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith("http") ? url : `${API_URL}${url}`;
}

async function profileJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const d = await res.json().catch(() => null);
    throw new Error(typeof d?.detail === "string" ? d.detail : "Не удалось выполнить действие");
  }
  return res.json();
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function rawImage(file: File) {
  return { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } };
}

export async function getProfile(): Promise<ProfileData> {
  return profileJson(await managerApiFetch("/profile"));
}

export async function updateProfile(patch: Partial<ServiceProfile>): Promise<ServiceProfile> {
  return profileJson(await managerApiFetch("/profile", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(patch) }));
}

export async function uploadProfileImage(slot: "logo" | "cover", file: File): Promise<ServiceProfile> {
  return profileJson(await managerApiFetch(`/profile/image/${slot}`, rawImage(file)));
}

export async function deleteProfileImage(slot: "logo" | "cover"): Promise<ServiceProfile> {
  return profileJson(await managerApiFetch(`/profile/image/${slot}`, { method: "DELETE" }));
}

export async function addProfilePhoto(file: File): Promise<ProfilePhoto> {
  return profileJson(await managerApiFetch("/profile/photos", rawImage(file)));
}

export async function deleteProfilePhoto(id: string): Promise<void> {
  await profileJson(await managerApiFetch(`/profile/photos/${id}`, { method: "DELETE" }));
}

export async function createNews(title: string, body: string): Promise<NewsItem> {
  return profileJson(await managerApiFetch("/profile/news", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ title, body }) }));
}

export async function updateNews(id: string, title: string, body: string): Promise<NewsItem> {
  return profileJson(await managerApiFetch(`/profile/news/${id}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ title, body }) }));
}

export async function uploadNewsImage(id: string, file: File): Promise<NewsItem> {
  return profileJson(await managerApiFetch(`/profile/news/${id}/image`, rawImage(file)));
}

export async function deleteNews(id: string): Promise<void> {
  await profileJson(await managerApiFetch(`/profile/news/${id}`, { method: "DELETE" }));
}


// ---------- Справочник услуг (менеджер) ----------

export type CatalogService = { id: string; name: string; duration_minutes: number; category: string | null; is_active: boolean };
export type ServiceInput = { name: string; duration_minutes: number; category: string | null; is_active?: boolean };

export async function getAllServices(): Promise<CatalogService[]> {
  return profileJson(await managerApiFetch("/services/all"));
}

export async function createService(input: ServiceInput): Promise<CatalogService> {
  return profileJson(await managerApiFetch("/services", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(input) }));
}

export async function updateService(id: string, input: ServiceInput): Promise<CatalogService> {
  return profileJson(await managerApiFetch(`/services/${id}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(input) }));
}

export async function hideService(id: string): Promise<void> {
  await profileJson(await managerApiFetch(`/services/${id}`, { method: "DELETE" }));
}


// Публичная карточка сервиса — без авторизации (видят и гости, и клиенты)
export async function getPublicProfile(): Promise<ProfileData> {
  return profileJson(await fetch(`${API_URL}/profile`, { cache: "no-store" }));
}


// Вход организации по логину и паролю (без телефона)
export async function orgLogin(login: string, password: string): Promise<{ access_token: string }> {
  const res = await fetch(`${API_URL}/auth/org-login?login=${encodeURIComponent(login)}&password=${encodeURIComponent(password)}`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    let detail = "Неверный логин или пароль";
    try {
      const j = await res.json();
      if (typeof j.detail === "string") detail = j.detail;
    } catch {}
    throw { status: res.status, detail };
  }
  return res.json();
}

export async function getPendingDays(start: string, days = 7): Promise<Record<string, number>> {
  const res = await managerApiFetch(`/bookings/pending-days?start=${start}&days=${days}`);
  if (!res.ok) return {};
  return res.json();
}

// ---------- статистика ----------
export type StatsPost = {
  id: string;
  name: string;
  bookings: number;
  hours: number;
  load: number | null;
  cancelled: number;
  top_services: { name: string; count: number }[];
};

export type Stats = {
  range: { from: string; to: string; period: string };
  overview: {
    confirmed: number;
    pending: number;
    cancelled: number;
    cancel_rate: number | null;
    hours: number;
    load: number | null;
    new_clients: number;
  };
  posts: StatsPost[];
  services: { id: string; name: string; category: string | null; count: number; hours: number; share: number }[];
  other: { count: number; no_services: number; items: { text: string; count: number }[] };
  series: { granularity: "day" | "week" | "month"; points: { label: string; count: number; hours: number }[] };
};

export async function getStats(q: {
  period: string;
  from?: string;
  to?: string;
  post_id?: string;
}): Promise<{ ok: true; data: Stats } | { ok: false; error: string }> {
  const qs = new URLSearchParams({ period: q.period });
  if (q.period === "custom" && q.from && q.to) {
    qs.set("date_from", q.from);
    qs.set("date_to", q.to);
  }
  if (q.post_id) qs.set("post_id", q.post_id);
  const res = await managerApiFetch(`/stats?${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    return { ok: false, error: body && typeof body.detail === "string" ? body.detail : "Не удалось загрузить статистику" };
  }
  return { ok: true, data: await res.json() };
}
