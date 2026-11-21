"use client";

import { setClientEmail } from "@/lib/api";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  getClients,
  updateClientNote,
  getCarsByUser,
  getBookingsByUser,
  createOrg,
  resetOrgPassword,
  createCarForUser,
  updateCarForUser,
  type ClientRow,
  type ClientCar,
  type ClientBooking,
  type CarInput,
} from "@/lib/api";

/* ───────────── helpers ───────────── */

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseISO(s: string) {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDateLong(s: string) {
  const d = parseISO(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${WEEKDAYS[d.getDay()]}`;
}

function endTime(start: string, duration: number) {
  const [h, m] = start.split(":").map(Number);
  const t = h * 60 + m + duration;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function formatPhone(p: string | null) {
  if (!p) return "";
  const m = p.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+7 (${m[1]}) ${m[2]}-${m[3]}-${m[4]}` : p;
}

function serviceLabel(b: ClientBooking) {
  return [b.services.map((s) => s.name).join(", "), b.services_text].filter(Boolean).join(" · ");
}

function clientName(c: ClientRow) {
  return c.full_name || formatPhone(c.phone) || "Без имени";
}

function statusOf(b: ClientBooking, today: string): { label: string; cls: string; upcoming: boolean } {
  const future = b.date >= today;
  switch (b.status) {
    case "pending":
      return future
        ? { label: "Ждёт подтверждения", cls: "bg-amber-50 text-amber-700 border-amber-200", upcoming: true }
        : { label: "Не подтверждена", cls: "bg-gray-50 text-gray-500 border-gray-200", upcoming: false };
    case "confirmed":
      return future
        ? { label: "Подтверждена", cls: "bg-brand-blue/10 text-brand-blue-dark border-brand-blue/30", upcoming: true }
        : { label: "Выполнено", cls: "bg-green-50 text-green-700 border-green-200", upcoming: false };
    case "declined":
      return { label: "Отклонена", cls: "bg-red-50 text-red-600 border-red-200", upcoming: false };
    case "cancelled":
      return { label: "Отменена", cls: "bg-gray-50 text-gray-500 border-gray-200", upcoming: false };
    default:
      return { label: b.status, cls: "bg-gray-50 text-gray-500 border-gray-200", upcoming: false };
  }
}

const INPUT =
  "w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 transition";
const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 bg-brand-yellow text-brand-blue-dark text-sm font-medium rounded-xl px-4 py-2.5 hover:brightness-95 active:scale-[0.98] transition disabled:opacity-50 disabled:pointer-events-none";
const BTN_GHOST =
  "inline-flex items-center justify-center gap-1.5 text-sm text-gray-600 rounded-xl px-4 py-2.5 hover:bg-gray-100 active:bg-gray-200 transition-colors";

/* ───────────── small components ───────────── */

function Icon({ name, className = "w-4 h-4" }: { name: string; className?: string }) {
  const url = `url(/icons/${name}.svg)`;
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        WebkitMaskImage: url,
        maskImage: url,
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

function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="w-8 h-8 -mr-1 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs text-gray-500 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-red-500 mt-1">{hint}</span>}
    </label>
  );
}

function PlateBadge({ plate }: { plate: string | null }) {
  if (!plate) {
    return <span className="text-[11px] text-gray-400 border border-dashed border-gray-300 rounded-md px-2 py-0.5">без номера</span>;
  }
  return (
    <span className="font-mono text-xs font-semibold tracking-wider text-gray-800 border border-gray-400 rounded-md px-2 py-0.5 bg-white whitespace-nowrap">
      {plate}
    </span>
  );
}

function StatusChip({ label, cls }: { label: string; cls: string }) {
  return <span className={`text-[11px] font-medium border rounded-full px-2.5 py-0.5 whitespace-nowrap ${cls}`}>{label}</span>;
}

/* ───────────── modals ───────────── */

function NewOrgModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (r: { id: string; login: string; password: string }, name: string) => void;
}) {
  const [name, setName] = useState("");
  const [inn, setInn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const innOk = inn.length === 10 || inn.length === 12;

  async function submit() {
    if (!name.trim() || !innOk || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await createOrg({ name: name.trim(), inn, note: note.trim() || undefined });
      onCreated(r, name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать организацию");
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Новая организация">
      <Field label="Название">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ООО «Ромашка»" className={INPUT} />
      </Field>
      <Field label="ИНН" hint={inn.length > 0 && !innOk ? "ИНН — 10 цифр (организация) или 12 (ИП)" : undefined}>
        <input
          value={inn}
          onChange={(e) => setInn(e.target.value.replace(/\D/g, "").slice(0, 12))}
          inputMode="numeric"
          placeholder="10 или 12 цифр"
          className={`${INPUT} font-mono`}
        />
      </Field>
      <Field label="Заметка (необязательно)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Контактное лицо, телефон, условия"
          className={`${INPUT} resize-none`}
        />
      </Field>
      <p className="text-[11px] text-gray-400 mb-3">Логин создастся из названия, пароль — автоматически.</p>
      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={BTN_GHOST}>
          Отмена
        </button>
        <button onClick={submit} disabled={!name.trim() || !innOk || busy} className={BTN_PRIMARY}>
          {busy ? "Создаю…" : "Создать"}
        </button>
      </div>
    </Modal>
  );
}

function CredentialsModal({
  name,
  login,
  password,
  isNew,
  onClose,
  onCopy,
}: {
  name: string;
  login: string;
  password: string;
  isNew: boolean;
  onClose: () => void;
  onCopy: (text: string, message?: string) => void;
}) {
  return (
    <Modal onClose={onClose} title={isNew ? "Организация создана" : "Новый пароль"}>
      <p className="text-sm text-gray-600 mb-4">
        {name}. Передайте эти данные клиенту, с ними он войдёт в личный кабинет.
      </p>
      <div className="rounded-xl bg-gray-50 divide-y divide-gray-100 mb-3">
        <button
          onClick={() => onCopy(login, "Логин скопирован")}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-100 rounded-t-xl transition-colors"
        >
          <span>
            <span className="block text-[11px] text-gray-400">Логин</span>
            <span className="font-mono text-sm text-gray-900">{login}</span>
          </span>
          <Icon name="copy" className="w-4 h-4 text-gray-400" />
        </button>
        <button
          onClick={() => onCopy(password, "Пароль скопирован")}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-100 rounded-b-xl transition-colors"
        >
          <span>
            <span className="block text-[11px] text-gray-400">Пароль</span>
            <span className="font-mono text-sm text-gray-900">{password}</span>
          </span>
          <Icon name="copy" className="w-4 h-4 text-gray-400" />
        </button>
      </div>
      <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-4">
        Пароль виден только сейчас. Потом его можно будет лишь заменить кнопкой «Новый пароль».
      </p>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => onCopy(`Организация: ${name}\nЛогин: ${login}\nПароль: ${password}`, "Данные скопированы")}
          className={BTN_GHOST}
        >
          <Icon name="copy" /> Скопировать для отправки
        </button>
        <button onClick={onClose} className={BTN_PRIMARY}>
          Готово
        </button>
      </div>
    </Modal>
  );
}

function CarModal({
  car,
  onClose,
  onSave,
}: {
  car: ClientCar | null;
  onClose: () => void;
  onSave: (data: CarInput) => Promise<void>;
}) {
  const [make, setMake] = useState(car?.make ?? "");
  const [model, setModel] = useState(car?.model ?? "");
  const [plate, setPlate] = useState(car?.plate ?? "");
  const [vin, setVin] = useState(car?.vin ?? "");
  const [color, setColor] = useState(car?.color ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!make.trim() || !model.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave({ make, model, plate, vin, color });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title={car ? "Изменить машину" : "Добавить машину"}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Марка">
          <input autoFocus value={make} onChange={(e) => setMake(e.target.value)} placeholder="Лада" className={INPUT} />
        </Field>
        <Field label="Модель">
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Ларгус" className={INPUT} />
        </Field>
      </div>
      <Field label="Гос. номер">
        <input
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
          placeholder="А123ВС"
          className={`${INPUT} font-mono uppercase`}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Цвет">
          <input value={color} onChange={(e) => setColor(e.target.value)} className={INPUT} />
        </Field>
        <Field label="VIN">
          <input
            value={vin}
            onChange={(e) => setVin(e.target.value.slice(0, 17))}
            className={`${INPUT} font-mono uppercase`}
          />
        </Field>
      </div>
      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={BTN_GHOST}>
          Отмена
        </button>
        <button onClick={submit} disabled={!make.trim() || !model.trim() || busy} className={BTN_PRIMARY}>
          {busy ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </Modal>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-gray-100 last:border-0 flex gap-3">
      <p className="w-24 shrink-0 text-xs text-gray-400 pt-0.5">{label}</p>
      <div className="text-sm text-gray-800 min-w-0 flex-1">{children}</div>
    </div>
  );
}

function BookingModal({
  booking,
  today,
  onClose,
  onCopy,
}: {
  booking: ClientBooking;
  today: string;
  onClose: () => void;
  onCopy: (text: string, message?: string) => void;
}) {
  const st = statusOf(booking, today);
  return (
    <Modal onClose={onClose} title="Запись">
      <div className="mb-3">
        <StatusChip label={st.label} cls={st.cls} />
      </div>
      <div>
        <DetailRow label="Дата">{formatDateLong(booking.date)}</DetailRow>
        <DetailRow label="Время">
          {booking.start_time}–{endTime(booking.start_time, booking.duration_minutes)}{" "}
          <span className="text-gray-400">({booking.duration_minutes} мин)</span>
        </DetailRow>
        {booking.post_name && <DetailRow label="Пост">{booking.post_name}</DetailRow>}
        <DetailRow label="Машина">
          {booking.car ? (
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span>
                  {booking.car.make} {booking.car.model}
                </span>
                <PlateBadge plate={booking.car.plate} />
              </div>
              {booking.car.vin && (
                <button
                  onClick={() => onCopy(booking.car!.vin!, "VIN скопирован")}
                  className="font-mono text-xs text-brand-blue hover:underline mt-1"
                  title="Скопировать VIN"
                >
                  VIN {booking.car.vin}
                </button>
              )}
            </div>
          ) : (
            <span className="text-gray-400">не указана</span>
          )}
        </DetailRow>
        <DetailRow label="Услуги">
          {booking.services.length > 0 || booking.services_text ? (
            <>
              {booking.services.length > 0 && (
                <ul className="list-disc list-inside space-y-0.5">
                  {booking.services.map((s) => (
                    <li key={s.id}>{s.name}</li>
                  ))}
                </ul>
              )}
              {booking.services_text && <p className="whitespace-pre-wrap">{booking.services_text}</p>}
            </>
          ) : (
            <span className="text-gray-400">не указаны</span>
          )}
        </DetailRow>
        <DetailRow label="Комментарий">
          {booking.comment ? (
            <p className="whitespace-pre-wrap">{booking.comment}</p>
          ) : (
            <span className="text-gray-400">нет</span>
          )}
        </DetailRow>
      </div>
      <div className="flex justify-end mt-4">
        <button onClick={onClose} className={BTN_PRIMARY}>
          Закрыть
        </button>
      </div>
    </Modal>
  );
}

/* ───────────── client detail ───────────── */

type DetailData = { cars: ClientCar[]; bookings: ClientBooking[] };

function CarCard({
  car,
  selectable,
  selected,
  onSelect,
  onEdit,
  onCopy,
}: {
  car: ClientCar;
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onCopy: (text: string, message?: string) => void;
}) {
  return (
    <div
      onClick={selectable ? onSelect : undefined}
      className={`rounded-xl border p-3 flex items-start gap-3 transition-colors ${
        selectable ? "cursor-pointer hover:border-brand-blue hover:bg-brand-blue/5" : ""
      } ${selected ? "border-brand-blue bg-brand-blue/10 ring-1 ring-brand-blue" : "border-gray-200"}`}
    >
      <div className="w-10 h-10 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center shrink-0">
        <Icon name="car" className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-gray-800 break-words">
            {car.make} {car.model}
          </p>
          <PlateBadge plate={car.plate} />
        </div>
        <p className="text-xs text-gray-500 mt-1 break-words">{car.color || "цвет не указан"}</p>
        {car.vin ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopy(car.vin!, "VIN скопирован");
            }}
            title="Скопировать VIN"
            className="font-mono text-xs text-brand-blue hover:underline mt-0.5 break-all text-left"
          >
            VIN {car.vin}
          </button>
        ) : (
          <p className="text-xs text-gray-300 mt-0.5">VIN не указан</p>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        aria-label="Изменить машину"
        className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-brand-blue active:bg-gray-200 transition-colors shrink-0"
      >
        <Icon name="edit" className="w-4 h-4" />
      </button>
    </div>
  );
}

// привязанные в этой сессии почты (список клиентов сам не перечитывается)
const savedEmails: Record<string, string> = {};

function EmailRow({ clientId, email }: { clientId: string; email: string | null }) {
  const current = savedEmails[clientId] ?? email;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);

  async function save() {
    setBusy(true);
    setError("");
    const res = await setClientEmail(clientId, draft.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Не удалось сохранить");
      return;
    }
    savedEmails[clientId] = draft.trim().toLowerCase();
    setEditing(false);
    force((n) => n + 1);
  }

  if (editing) {
    return (
      <div className="mt-3">
        <input
          autoFocus
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Почта клиента"
          autoCapitalize="none"
          className={INPUT}
        />
        <p className="text-[11px] text-gray-400 mt-1">Клиент заходит в приложение по этой почте: «Забыли пароль?», код из письма, новый пароль.</p>
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        <div className="flex gap-2 mt-2">
          <button onClick={save} disabled={busy || !draft.trim()} className={`${BTN_PRIMARY} disabled:opacity-50`}>
            Сохранить
          </button>
          <button onClick={() => setEditing(false)} className={BTN_GHOST}>
            Отмена
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 flex-wrap">
      <span>Почта:</span>
      {current ? <span className="text-gray-800 break-all">{current}</span> : <span className="text-gray-400">не привязана</span>}
      <button
        onClick={() => {
          setDraft(current ?? "");
          setError("");
          setEditing(true);
        }}
        className="text-brand-blue font-medium hover:underline"
      >
        {current ? "Изменить" : "Привязать"}
      </button>
    </div>
  );
}

function ClientDetail({
  client,
  data,
  loading,
  onBack,
  onSaveNote,
  onAddCar,
  onEditCar,
  onOpenBooking,
  onResetPassword,
  onCopy,
}: {
  client: ClientRow;
  data: DetailData | undefined;
  loading: boolean;
  onBack: () => void;
  onSaveNote: (id: string, text: string) => Promise<void>;
  onAddCar: () => void;
  onEditCar: (car: ClientCar) => void;
  onOpenBooking: (b: ClientBooking) => void;
  onResetPassword: () => void;
  onCopy: (text: string, message?: string) => void;
}) {
  const [carFilter, setCarFilter] = useState("all");
  const [carQuery, setCarQuery] = useState("");
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  const today = toISO(new Date());
  const isOrg = client.kind === "org";
  const cars = data?.cars ?? [];
  const bookings = data?.bookings ?? [];
  const multi = cars.length > 1;
  const manyCars = cars.length > 4;
  const cq = carQuery.trim().toLowerCase();
  const listCars =
    manyCars && cq
      ? cars.filter((car) =>
          [car.make, car.model, car.plate, car.vin, car.color].filter(Boolean).join(" ").toLowerCase().includes(cq)
        )
      : cars;
  const activeCar = multi && carFilter !== "all" ? cars.find((c) => c.id === carFilter) ?? null : null;
  const shown = activeCar ? bookings.filter((b) => b.car?.id === activeCar.id) : bookings;
  const upcoming = shown.filter((b) => statusOf(b, today).upcoming).reverse();
  const past = shown.filter((b) => !statusOf(b, today).upcoming);
  const showCarChip = multi && !activeCar;
  const nowYear = new Date().getFullYear();

  function BookingRow({ b }: { b: ClientBooking }) {
    const d = parseISO(b.date);
    const st = statusOf(b, today);
    return (
      <button
        onClick={() => onOpenBooking(b)}
        className="w-full text-left flex items-center gap-3 rounded-xl border border-gray-100 hover:border-brand-blue/40 hover:bg-brand-blue/5 active:bg-brand-blue/10 px-3 py-2.5 transition-colors"
      >
        <div className="w-11 shrink-0 text-center">
          <p className="text-lg font-semibold leading-none text-gray-800">{d.getDate()}</p>
          <p className="text-[10px] uppercase text-gray-400 mt-1">
            {MONTHS_SHORT[d.getMonth()]}
            {d.getFullYear() !== nowYear ? ` ${String(d.getFullYear()).slice(2)}` : ""}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-800 truncate">
            {serviceLabel(b) || <span className="text-gray-400">Без услуг</span>}
          </p>
          <p className="text-xs text-gray-400 truncate">
            {b.start_time}–{endTime(b.start_time, b.duration_minutes)}
            {b.post_name ? ` · ${b.post_name}` : ""}
          </p>
        </div>
        {showCarChip && b.car && (
          <span className="hidden sm:inline-flex">
            <PlateBadge plate={b.car.plate || `${b.car.make} ${b.car.model}`} />
          </span>
        )}
        <StatusChip label={st.label} cls={st.cls} />
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="lg:hidden inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3 transition-colors"
      >
        <Icon name="arrow-left" /> Назад к списку
      </button>

      {/* шапка */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-start gap-3">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
              isOrg ? "bg-brand-yellow/30 text-brand-blue-dark" : "bg-brand-blue/10 text-brand-blue"
            }`}
          >
            <Icon name={isOrg ? "building" : "user"} className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900 break-words">{clientName(client)}</h2>
              {isOrg && (
                <span className="text-[11px] font-medium bg-brand-yellow/30 text-brand-blue-dark rounded-full px-2.5 py-0.5">
                  Организация
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400 mt-0.5">
              {isOrg ? `ИНН ${client.inn}` : formatPhone(client.phone)}
              {" · "}записей: {client.bookings_count}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {client.phone && (
              <a
                href={`tel:${client.phone}`}
                aria-label="Позвонить"
                title="Позвонить"
                className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-brand-blue active:bg-gray-200 transition-colors"
              >
                <Icon name="phone" className="w-[18px] h-[18px]" />
              </a>
            )}
            <Link
              href={`/nord/chat?user=${client.id}`}
              aria-label="Чат"
              title="Чат"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-brand-blue active:bg-gray-200 transition-colors"
            >
              <Icon name="chat" className="w-[18px] h-[18px]" />
            </Link>
            <Link
              href={`/nord/calendar?client=${client.id}`}
              className="ml-1 inline-flex items-center gap-1.5 h-9 rounded-xl bg-brand-yellow text-brand-blue-dark text-xs font-semibold px-3 hover:brightness-95 whitespace-nowrap"
            >
              <Icon name="calendar-plus" className="w-4 h-4" />
              Записать
            </Link>
          </div>
        </div>

        {!isOrg && <EmailRow clientId={client.id} email={client.email ?? null} />}

        {isOrg && client.login && (
          <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 flex items-center gap-3 flex-wrap">
            <Icon name="key" className="w-[18px] h-[18px] text-gray-400" />
            <div>
              <p className="text-[11px] text-gray-400">Логин для входа</p>
              <button
                onClick={() => onCopy(client.login!, "Логин скопирован")}
                className="font-mono text-sm text-gray-800 hover:text-brand-blue transition-colors"
                title="Скопировать логин"
              >
                {client.login}
              </button>
            </div>
            <button
              onClick={onResetPassword}
              className="ml-auto text-xs font-medium text-brand-blue border border-brand-blue/30 rounded-lg px-3 py-1.5 hover:bg-brand-blue/10 active:bg-brand-blue/20 transition-colors"
            >
              Новый пароль
            </button>
          </div>
        )}

        {/* заметка */}
        <div className="mt-4">
          {editingNote ? (
            <div>
              <textarea
                autoFocus
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Приватная заметка о клиенте"
                rows={3}
                className={`${INPUT} resize-none`}
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={async () => {
                    await onSaveNote(client.id, noteDraft);
                    setEditingNote(false);
                  }}
                  className={BTN_PRIMARY}
                >
                  Сохранить
                </button>
                <button onClick={() => setEditingNote(false)} className={BTN_GHOST}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              {client.manager_note ? (
                <p className="flex-1 text-sm text-gray-600 bg-gray-50 rounded-xl px-3 py-2 whitespace-pre-wrap">
                  {client.manager_note}
                </p>
              ) : (
                <p className="flex-1 text-sm text-gray-300 px-1 py-2">Без заметки</p>
              )}
              <button
                onClick={() => {
                  setNoteDraft(client.manager_note || "");
                  setEditingNote(true);
                }}
                aria-label="Изменить заметку"
                title={client.manager_note ? "Изменить заметку" : "Добавить заметку"}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-brand-blue active:bg-gray-200 transition-colors shrink-0"
              >
                <Icon name="edit" className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* машины */}
      <div className="bg-white rounded-2xl shadow-sm p-5 mt-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Машины{cars.length > 0 ? ` · ${cars.length}` : ""}</h3>
            {multi && <p className="text-xs text-gray-400 mt-0.5">Нажмите на машину, чтобы увидеть её историю</p>}
          </div>
          <button
            onClick={onAddCar}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue rounded-lg px-3 py-1.5 hover:bg-brand-blue/10 active:bg-brand-blue/20 transition-colors"
          >
            <Icon name="plus" className="w-3.5 h-3.5" /> Машина
          </button>
        </div>

        {loading && !data ? (
          <p className="text-sm text-gray-400">Загрузка…</p>
        ) : cars.length === 0 ? (
          <p className="text-sm text-gray-300">Машин пока нет</p>
        ) : (
          <div>
            {manyCars && (
              <div className="relative mb-2">
                <Icon name="search" className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={carQuery}
                  onChange={(e) => setCarQuery(e.target.value)}
                  placeholder="Найти по марке, номеру или VIN"
                  className={`${INPUT} pl-9`}
                />
              </div>
            )}
            <div className={`flex flex-col gap-2 ${manyCars ? "max-h-96 overflow-y-auto pr-1" : ""}`}>
              {listCars.map((car) => (
                <CarCard
                  key={car.id}
                  car={car}
                  selectable={multi}
                  selected={activeCar?.id === car.id}
                  onSelect={() => setCarFilter(activeCar?.id === car.id ? "all" : car.id)}
                  onEdit={() => onEditCar(car)}
                  onCopy={onCopy}
                />
              ))}
              {listCars.length === 0 && <p className="text-sm text-gray-300 px-1 py-3">Ничего не нашли</p>}
            </div>
          </div>
        )}
      </div>

      {/* история */}
      <div className="bg-white rounded-2xl shadow-sm p-5 mt-3">
        <div className="flex items-center justify-between mb-3 gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">История</h3>
            {activeCar && (
              <p className="text-xs text-gray-400 mt-0.5 truncate">
                {activeCar.make} {activeCar.model}
                {activeCar.plate ? ` · ${activeCar.plate}` : ""}
              </p>
            )}
          </div>
          {activeCar && (
            <button
              onClick={() => setCarFilter("all")}
              className="text-xs text-brand-blue rounded-lg px-3 py-1.5 hover:bg-brand-blue/10 transition-colors shrink-0"
            >
              Показать все
            </button>
          )}
        </div>

        {loading && !data ? (
          <p className="text-sm text-gray-400">Загрузка…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-gray-300">Записей пока нет</p>
        ) : (
          <div className="flex flex-col gap-4 max-h-[30rem] overflow-y-auto pr-1">
            {upcoming.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-2 sticky top-0 bg-white py-1 z-[1]">Предстоящие</p>
                <div className="flex flex-col gap-1.5">
                  {upcoming.map((b) => (
                    <BookingRow key={b.id} b={b} />
                  ))}
                </div>
              </div>
            )}
            {past.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-2 sticky top-0 bg-white py-1 z-[1]">Прошедшие</p>
                <div className="flex flex-col gap-1.5">
                  {past.map((b) => (
                    <BookingRow key={b.id} b={b} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────── page ───────────── */

export default function ClientsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400">Загрузка…</p>}>
      <ClientsPageInner />
    </Suspense>
  );
}

function ClientsPageInner() {
  const searchParams = useSearchParams();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "person" | "org">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, DetailData>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  const [orgModal, setOrgModal] = useState(false);
  const [creds, setCreds] = useState<{ name: string; login: string; password: string; isNew: boolean } | null>(null);
  const [carModal, setCarModal] = useState<{ car: ClientCar | null } | null>(null);
  const [bookingModal, setBookingModal] = useState<ClientBooking | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSelected = useRef(false);

  const today = toISO(new Date());

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }

  function copy(text: string, message = "Скопировано") {
    navigator.clipboard.writeText(text).then(
      () => showToast(message),
      () => showToast("Не удалось скопировать")
    );
  }

  async function reloadClients() {
    setClients(await getClients());
  }

  useEffect(() => {
    getClients()
      .then(setClients)
      .finally(() => setLoading(false));
  }, []);

  async function loadDetail(id: string, force = false) {
    if (!force && detail[id]) return;
    setDetailLoading(id);
    try {
      const [cars, bookings] = await Promise.all([getCarsByUser(id), getBookingsByUser(id)]);
      setDetail((prev) => ({ ...prev, [id]: { cars, bookings } }));
    } finally {
      setDetailLoading((cur) => (cur === id ? null : cur));
    }
  }

  function select(id: string) {
    setSelectedId(id);
    loadDetail(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // переход из календаря: /nord/clients?expand=<id>
  useEffect(() => {
    const id = searchParams.get("expand");
    if (id && clients.length > 0 && !autoSelected.current) {
      autoSelected.current = true;
      if (clients.some((c) => c.id === id)) select(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, clients]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return clients.filter((c) => {
      if (kindFilter !== "all" && c.kind !== kindFilter) return false;
      if (!q) return true;
      const text = [c.full_name, c.login, c.car?.make, c.car?.model, c.car?.vin, c.manager_note]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (text.includes(q)) return true;
      if (digits.length >= 2) {
        const phoneDigits = (c.phone || "").replace(/\D/g, "");
        if (phoneDigits.includes(digits) || (c.inn || "").includes(digits)) return true;
      }
      return false;
    });
  }, [clients, query, kindFilter]);

  const counts = useMemo(
    () => ({
      all: clients.length,
      person: clients.filter((c) => c.kind === "person").length,
      org: clients.filter((c) => c.kind === "org").length,
    }),
    [clients]
  );

  const selected = clients.find((c) => c.id === selectedId) ?? null;

  async function handleSaveNote(id: string, text: string) {
    const ok = await updateClientNote(id, text);
    if (ok) setClients((prev) => prev.map((c) => (c.id === id ? { ...c, manager_note: text } : c)));
    else showToast("Не удалось сохранить заметку");
  }

  async function handleOrgCreated(r: { id: string; login: string; password: string }, name: string) {
    setOrgModal(false);
    setCreds({ name, login: r.login, password: r.password, isNew: true });
    await reloadClients();
    select(r.id);
  }

  async function handleResetPassword(c: ClientRow) {
    const name = clientName(c);
    if (!window.confirm(`Выдать «${name}» новый пароль? Старый перестанет работать, а все входы в кабинет завершатся.`)) return;
    try {
      const r = await resetOrgPassword(c.id);
      setCreds({ name, login: r.login, password: r.password, isNew: false });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Не удалось сбросить пароль");
    }
  }

  async function handleSaveCar(data: CarInput) {
    if (!selected || !carModal) return;
    if (carModal.car) await updateCarForUser(selected.id, carModal.car.id, data);
    else await createCarForUser(selected.id, data);
    setCarModal(null);
    showToast("Сохранено");
    await Promise.all([loadDetail(selected.id, true), reloadClients()]);
  }

  if (loading) return <p className="text-sm text-gray-400">Загрузка…</p>;

  const chips: { key: "all" | "person" | "org"; label: string }[] = [
    { key: "all", label: "Все" },
    { key: "person", label: "Люди" },
    { key: "org", label: "Организации" },
  ];

  return (
    <div className="-m-6 md:-m-10 p-3 md:p-10 md:rounded-[12px] bg-[#e8eaf0] min-h-[100dvh] md:min-h-[calc(100dvh-2rem)]">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="hidden md:block text-xl font-semibold text-gray-900">Клиенты</h1>
          <p className="text-xs text-gray-400 mt-0.5">Всего: {clients.length}</p>
        </div>
        <button onClick={() => setOrgModal(true)} className={BTN_PRIMARY}>
          <Icon name="plus" /> Организация
        </button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)] gap-4 items-start">
        {/* список */}
        <div className={`${selected ? "hidden lg:block" : ""} bg-white rounded-2xl shadow-sm p-3`}>
          <div className="relative">
            <Icon name="search" className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Имя, телефон, ИНН, машина"
              className={`${INPUT} pl-9`}
            />
          </div>

          <div className="flex gap-1.5 mt-3 mb-2 flex-wrap">
            {chips.map((ch) => (
              <button
                key={ch.key}
                onClick={() => setKindFilter(ch.key)}
                className={`text-xs rounded-full px-3 py-1 border transition-colors ${
                  kindFilter === ch.key
                    ? "bg-brand-blue text-white border-brand-blue"
                    : "text-gray-500 border-gray-200 hover:bg-gray-50"
                }`}
              >
                {ch.label} · {counts[ch.key]}
              </button>
            ))}
          </div>

          <div className="lg:max-h-[70vh] overflow-y-auto flex flex-col gap-0.5">
            {filtered.length === 0 && <p className="text-sm text-gray-400 px-2 py-6 text-center">Никого не нашли</p>}
            {filtered.map((c) => {
              const isOrg = c.kind === "org";
              const active = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  onClick={() => select(c.id)}
                  className={`w-full text-left flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                    active ? "bg-brand-blue/10" : "hover:bg-gray-50 active:bg-gray-100"
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isOrg ? "bg-brand-yellow/30 text-brand-blue-dark" : "bg-brand-blue/10 text-brand-blue"
                    }`}
                  >
                    <Icon name={isOrg ? "building" : "user"} className="w-[18px] h-[18px]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">{clientName(c)}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {isOrg ? `ИНН ${c.inn}` : c.full_name ? formatPhone(c.phone) : c.car ? `${c.car.make} ${c.car.model}` : "—"}
                    </p>
                  </div>
                  <span className="text-[11px] text-gray-400 shrink-0" title="Записей">
                    {c.bookings_count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* карточка */}
        {selected ? (
          <ClientDetail
            key={selected.id}
            client={selected}
            data={detail[selected.id]}
            loading={detailLoading === selected.id}
            onBack={() => setSelectedId(null)}
            onSaveNote={handleSaveNote}
            onAddCar={() => setCarModal({ car: null })}
            onEditCar={(car) => setCarModal({ car })}
            onOpenBooking={setBookingModal}
            onResetPassword={() => handleResetPassword(selected)}
            onCopy={copy}
          />
        ) : (
          <div className="hidden lg:flex bg-white/60 rounded-2xl text-gray-400 text-sm items-center justify-center py-24">
            Выберите клиента слева
          </div>
        )}
      </div>

      {orgModal && <NewOrgModal onClose={() => setOrgModal(false)} onCreated={handleOrgCreated} />}
      {creds && (
        <CredentialsModal
          name={creds.name}
          login={creds.login}
          password={creds.password}
          isNew={creds.isNew}
          onClose={() => setCreds(null)}
          onCopy={copy}
        />
      )}
      {carModal && <CarModal car={carModal.car} onClose={() => setCarModal(null)} onSave={handleSaveCar} />}
      {bookingModal && (
        <BookingModal booking={bookingModal} today={today} onClose={() => setBookingModal(null)} onCopy={copy} />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-xs px-4 py-2 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
