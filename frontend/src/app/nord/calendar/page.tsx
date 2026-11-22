"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";

import { getPendingDays } from "@/lib/api";

import { useMemo, useState, useEffect, useLayoutEffect, useRef } from "react";
import Link from "next/link";
import {
  getCalendar,
  confirmBooking,
  declineBooking,
  rescheduleBooking,
  changeBookingDuration,
  cancelBooking,
  movePendingBooking,
  createManualBooking,
  getClients,
  searchClientsForBooking,
  getServices,
  type Service,
  type BookingClientMatch,
  type CalendarPost,
  type CalendarBooking,
} from "@/lib/api";

const SLOT_PX = 34; // px per 30-minute slot
const PX_PER_MIN = SLOT_PX / 30;
const GAP = 6; // visible background strip between two different bookings, in px

function formatDateHuman(d: Date) {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", weekday: "short" });
}

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timeToMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(total: number) {
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function addMinutes(time: string, minutes: number) {
  return minutesToTime(timeToMinutes(time) + minutes);
}

function firstName(fullName: string) {
  return fullName.split(" ")[0];
}

// Иконка из /public: рисуется маской, поэтому берёт цвет текста (currentColor)
function Icon({ src, className = "" }: { src: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block bg-current ${className}`}
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

type Placing = {
  bookingId: string;
  action: "move" | "reschedule";
  clientName: string;
};

function BookingPopover({
  booking,
  status,
  visible,
  draftDuration,
  onDraftDurationChange,
  onConfirm,
  onMoveOrReschedule,
  onCancelAction,
  onDurationChange,
  onCopy,
}: {
  booking: CalendarBooking;
  status: "pending" | "confirmed";
  visible: boolean;
  draftDuration?: number;
  onDraftDurationChange?: (v: number) => void;
  onConfirm?: () => void;
  onMoveOrReschedule: () => void;
  onCancelAction: () => void;
  onDurationChange?: (delta: number) => void;
  onCopy: (text: string) => void;
}) {
  const duration = draftDuration ?? booking.duration_minutes;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: -9999, left: 0, above: false });

  // Карточка поверх всего (fixed): под записью, а если снизу нет места — над ней
  useLayoutEffect(() => {
    if (!visible) return;
    function place() {
      const el = ref.current;
      const anchor = el?.parentElement;
      if (!el || !anchor) return;
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const m = 8;
      const above = r.bottom + h > window.innerHeight - m && r.top - h > m;
      let top = above ? r.top - h : r.bottom;
      top = Math.max(m, Math.min(top, window.innerHeight - h - m));
      let left = r.left + r.width / 2 - w / 2;
      left = Math.max(m, Math.min(left, window.innerWidth - w - m));
      setPos({ top, left, above });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [visible, duration]);

  return (
    <div
      ref={ref}
      className={`${visible ? "block" : "hidden"} fixed z-50 w-64 cursor-default ${pos.above ? "pb-1.5" : "pt-1.5"}`}
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
    <div className="bg-gray-900 text-white rounded-xl px-4 py-3 text-xs shadow-xl">
      <div className="flex items-start justify-between gap-2">
        {booking.is_guest ? (
          <span className="font-semibold text-sm">{booking.client_name || "Гость"}</span>
        ) : (
          <Link
            href={`/nord/clients?expand=${booking.user_id}`}
            className="font-semibold text-sm hover:underline"
          >
            {booking.client_name} →
          </Link>
        )}
        {!booking.is_guest && (
          <Link
            href={`/nord/chat?user=${booking.user_id}`}
            className="shrink-0 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors"
          >
            Чат
          </Link>
        )}
      </div>

      {booking.phone && (
        <div className="flex items-center gap-3 mt-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopy(booking.phone || "");
            }}
            title="Нажмите, чтобы скопировать"
            className="text-gray-300 hover:text-white hover:bg-white/10 rounded px-1 -mx-1 transition-colors cursor-pointer"
          >
            {booking.phone}
          </button>
          <a
            href={`tel:${booking.phone}`}
            onClick={(e) => e.stopPropagation()}
            className="text-brand-yellow hover:underline text-[11px]"
          >
            Позвонить
          </a>
        </div>
      )}

      <p className="text-gray-300 mt-1.5">
        {booking.start_time}–{addMinutes(booking.start_time, duration)} · {formatDuration(duration)}
      </p>
      {status === "pending" && <p className="text-amber-300 mt-0.5">Ждёт подтверждения</p>}

      <div className="mt-2 pt-2 border-t border-gray-700">
        {booking.services.length > 0 || booking.services_text ? (
          <p className="text-gray-200">
            {[booking.services.map((s) => s.name).join(", "), booking.services_text].filter(Boolean).join(" · ")}
          </p>
        ) : (
          <p className="text-gray-500">Услуга не указана</p>
        )}
      </div>

      <div className="mt-2 pt-2 border-t border-gray-700">
        {booking.car ? (
          <>
            <p className="text-gray-200">
              {booking.car.make} {booking.car.model}{booking.car.plate ? ` · ${booking.car.plate}` : ""}
            </p>
            {booking.car.vin && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCopy(booking.car?.vin || "");
                }}
                title="Нажмите, чтобы скопировать"
                className="text-gray-400 hover:text-white hover:bg-white/10 rounded px-1 -mx-1 font-mono transition-colors cursor-pointer"
              >
                VIN: {booking.car.vin}
              </button>
            )}
          </>
        ) : (
          <p className="text-gray-500">Машина не указана</p>
        )}
      </div>

      {booking.comment && (
        <p className="text-gray-400 mt-2 pt-2 border-t border-gray-700">{booking.comment}</p>
      )}

      {status === "pending" && (
        <div className="mt-2 pt-2 border-t border-gray-700 flex items-center gap-2">
          <span className="text-gray-400">Длительность:</span>
          <div className="inline-flex items-center rounded bg-gray-800 overflow-hidden">
            <button
              type="button"
              aria-label="Короче на 30 минут"
              onClick={(e) => {
                e.stopPropagation();
                onDraftDurationChange?.(Math.max(30, Math.ceil(duration / 30) * 30 - 30));
              }}
              className="px-2 py-0.5 text-sm text-gray-300 hover:bg-gray-700 cursor-pointer select-none"
            >
              −
            </button>
            <span className="px-1.5 text-xs tabular-nums text-white min-w-[4.5rem] text-center">{formatDuration(duration)}</span>
            <button
              type="button"
              aria-label="Дольше на 30 минут"
              onClick={(e) => {
                e.stopPropagation();
                onDraftDurationChange?.(Math.min(MAX_DURATION, Math.floor(duration / 30) * 30 + 30));
              }}
              className="px-2 py-0.5 text-sm text-gray-300 hover:bg-gray-700 cursor-pointer select-none"
            >
              +
            </button>
          </div>
        </div>
      )}

      {status !== "pending" && onDurationChange && (
        <div className="mt-2 pt-2 border-t border-gray-700 flex items-center gap-2">
          <span className="text-gray-400">Время:</span>
          <button
            type="button"
            disabled={duration <= 30}
            onClick={(e) => {
              e.stopPropagation();
              onDurationChange(-30);
            }}
            className="px-2.5 py-1 rounded bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-40 cursor-pointer select-none"
          >
            −30 мин
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDurationChange(30);
            }}
            className="px-2.5 py-1 rounded bg-gray-800 text-gray-200 hover:bg-gray-700 cursor-pointer select-none"
          >
            +30 мин
          </button>
        </div>
      )}

      <div className="mt-3 pt-2 border-t border-gray-700 flex gap-2 flex-wrap items-center">
        {status === "pending" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onConfirm?.();
            }}
            className="flex-1 bg-brand-yellow text-brand-blue-dark font-medium rounded-lg py-1.5 hover:brightness-95 active:scale-[0.98] transition cursor-pointer"
          >
            Подтвердить
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMoveOrReschedule();
          }}
          className="flex-1 bg-gray-700 text-white font-medium rounded-lg py-1.5 hover:bg-gray-600 active:scale-[0.98] transition cursor-pointer"
        >
          Перенести
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCancelAction();
          }}
          className="text-red-400 hover:text-red-300 hover:bg-white/10 rounded-lg px-2 py-1.5 transition-colors cursor-pointer"
        >
          Отменить
        </button>
      </div>
    </div>
    </div>
  );
}

const fieldCls =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-brand-blue transition-colors";

const DURATION_CHIPS = [
  { min: 30, label: "30 мин" },
  { min: 60, label: "1 ч" },
  { min: 90, label: "1,5 ч" },
  { min: 120, label: "2 ч" },
  { min: 180, label: "3 ч" },
];

type NewBookingForm = {
  user_id: string | null;
  car_plate: string | null;
  start_time: string;
  duration_minutes: number;
  phone: string | null;
  client_name: string | null;
  car_id: string | null;
  car_make: string | null;
  car_model: string | null;
  vin: string | null;
  services_text: string | null;
  service_ids: string[];
};

// Из любого ввода/вставки (+7…, 8…, со скобками и пробелами) достаём 10 цифр номера после +7
function extractNational(raw: string) {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("7") || d.startsWith("8")) d = d.slice(1);
  return d.slice(0, 10);
}

function formatNational(d: string) {
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 8);
  const e = d.slice(8, 10);
  let out = "";
  if (a) out += `(${a}${a.length === 3 ? ")" : ""}`;
  if (b) out += ` ${b}`;
  if (c) out += `-${c}`;
  if (e) out += `-${e}`;
  return out;
}

function formatFullPhone(phone: string) {
  return `+7 ${formatNational(phone.replace(/^\+7/, ""))}`;
}

function formatDayShort(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function chipClass(active: boolean) {
  return `rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
    active ? "border-brand-blue bg-brand-blue/10 text-brand-blue-dark" : "border-gray-200 text-gray-600 hover:bg-gray-50"
  }`;
}

function carLabel(car: { make: string; model: string; vin: string | null }) {
  const base = `${car.make} ${car.model}`.trim();
  return car.vin ? `${base} · …${car.vin.slice(-6)}` : base;
}

const MAX_DURATION = 4800; // минут (80 ч); остаток переносится на следующие рабочие дни

function formatDuration(m: number) {
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h} ч ${r} мин`;
  return h ? `${h} ч` : `${r} мин`;
}

function carText(c: { make: string; model: string; plate?: string | null }) {
  const base = [c.make, c.model].filter(Boolean).join(" ");
  return c.plate ? `${base} · ${c.plate}` : base;
}

function NewBookingModal({
  postName,
  dateLabel,
  dateISO,
  initialTime,
  initialClient,
  onClose,
  onSubmit,
}: {
  postName: string;
  dateLabel: string;
  dateISO: string;
  initialTime: string;
  initialClient?: BookingClientMatch | null;
  onClose: () => void;
  onSubmit: (form: NewBookingForm) => Promise<string | null>;
}) {
  const [time, setTime] = useState(initialTime);
  const [duration, setDuration] = useState(60);
  const [digits, setDigits] = useState("");
  const [textMode, setTextMode] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<BookingClientMatch[]>([]);
  const [searchedFor, setSearchedFor] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const [selected, setSelected] = useState<BookingClientMatch | null>(null);
  const [carChoice, setCarChoice] = useState<string>("new");
  const [name, setName] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [vin, setVin] = useState("");
  const [servicesText, setServicesText] = useState("");
  const [catalog, setCatalog] = useState<Service[]>([]);
  const [picked, setPicked] = useState<Service[]>([]);
  const [svcFocus, setSvcFocus] = useState(false);
  const [others, setOthers] = useState<string[]>([]); // «Другое» — услуги не из справочника

  useEffect(() => {
    getServices().then(setCatalog).catch(() => setCatalog([]));
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // клиент выбран заранее (переход из чата или карточки клиента) — подставляем сразу
  useEffect(() => {
    if (initialClient) selectClient(initialClient);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectClient(m: BookingClientMatch) {
    setSelected(m);
    if (m.phone) {
      setTextMode(false);
      setDigits(m.phone.replace(/^\+7/, ""));
      setQuery("");
    } else {
      setTextMode(true);
      setDigits("");
      setQuery(m.full_name ?? "");
    }
    setName(m.kind === "org" ? "" : m.full_name ?? "");
    setCarChoice(m.cars[0]?.id ?? "new");
    setShowSuggest(false);
  }

  function clearSelected() {
    setSelected(null);
    setCarChoice("new");
    setName("");
  }

  // Подбор клиентов: цифры — по началу номера, буквы — по имени / организации / машине / гос. номеру
  const searchKey = textMode ? query.trim() : digits;
  const searchReady = textMode ? searchKey.length >= 2 : searchKey.length >= 3;
  useEffect(() => {
    if (selected || !searchReady) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      searchClientsForBooking(searchKey).then((list) => {
        if (cancelled) return;
        setMatches(list);
        setSearchedFor(searchKey);
        if (!textMode && digits.length === 10) {
          const exact = list.find((m) => m.phone === `+7${digits}`);
          if (exact) selectClient(exact);
        }
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, textMode, selected]);

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setShowSuggest(true);
    if (textMode) {
      setQuery(raw);
      if (selected && raw !== (selected.full_name ?? "")) clearSelected();
      if (raw === "") setTextMode(false);
      return;
    }
    // первая же буква переключает поле в поиск по имени / организации / гос. номеру
    if (digits === "" && /[A-Za-zА-Яа-яЁё]/.test(raw)) {
      setTextMode(true);
      setQuery(raw.replace(/[()]/g, ""));
      return;
    }
    let next = extractNational(raw);
    // удалили только «служебный» символ (скобку/дефис) — убираем последнюю цифру
    if (next === digits && raw.length < formatNational(digits).length) next = digits.slice(0, -1);
    setDigits(next);
    if (selected && `+7${next}` !== selected.phone) clearSelected();
  }

  const isOrg = selected?.kind === "org";
  const searching = textMode && !selected; // ищем клиента по тексту, но ещё не выбрали
  const hasCars = !!selected && selected.cars.length > 0;
  const useNewCar = !hasCars || carChoice === "new";
  const chosenCar = hasCars && !useNewCar ? selected!.cars.find((c) => c.id === carChoice) : undefined;
  const sameDay = !!selected && selected.upcoming.some((u) => u.date === dateISO);
  const allCars = selected?.cars ?? [];
  const phoneMode = !textMode && digits.length > 0; // маска телефона включается с первой цифры
  const phoneIncomplete = phoneMode && digits.length < 10;
  // подсказки из справочника услуг: по тексту после последней запятой / точки с запятой / перевода строки
  const svcFragment = (servicesText.split(/[,;\n]/).pop() ?? "").trim().toLowerCase();
  const svcSuggestions = catalog
    .filter((x) => !picked.some((p) => p.id === x.id) && svcFragment !== "" && x.name.toLowerCase().includes(svcFragment))
    .slice(0, 4);

  function applyPicked(next: Service[]) {
    setPicked(next);
    // длительность — по нормативам выбранных услуг (потом её можно поправить стрелками)
    if (next.length > 0) setDuration(Math.min(MAX_DURATION, next.reduce((sum, x) => sum + x.duration_minutes, 0)));
  }

  const rawFragment = (servicesText.split(/[,;\n]/).pop() ?? "").trim();
  // в справочнике нет ничего похожего — предлагаем «Другое»
  const showOther = svcFragment.length >= 2 && !catalog.some((x) => x.name.toLowerCase().includes(svcFragment));

  function pickOther() {
    if (!rawFragment) return;
    const text = rawFragment;
    const cut = Math.max(servicesText.lastIndexOf(","), servicesText.lastIndexOf(";"), servicesText.lastIndexOf("\n"));
    setServicesText(cut >= 0 ? servicesText.slice(0, cut).replace(/[\s,;]+$/, "") : "");
    setOthers((o) => (o.includes(text) ? o : [...o, text]));
  }

  function pickService(x: Service) {
    const cut = Math.max(servicesText.lastIndexOf(","), servicesText.lastIndexOf(";"), servicesText.lastIndexOf("\n"));
    setServicesText(cut >= 0 ? servicesText.slice(0, cut).replace(/[\s,;]+$/, "") : "");
    applyPicked([...picked, x]);
  }

  const nameLocked = !!selected?.full_name;
  const canSave = !phoneIncomplete && !searching && duration >= 15 && !!time && !saving;

  async function submit() {
    if (!canSave) return;
    // слова, оставшиеся в поле без выбора подсказки: совпали с названием услуги — берём, иначе просим выбрать из списка
    const parts = servicesText.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    const all = [...picked];
    const unknown: string[] = [];
    for (const part of parts) {
      const hit = catalog.find((x) => x.name.trim().toLowerCase() === part.toLowerCase());
      if (!hit) unknown.push(part);
      else if (!all.some((x) => x.id === hit.id)) all.push(hit);
    }
    if (unknown.length > 0) {
      setError(`Выберите подсказку или «Другое»: «${unknown.join("», «")}»`);
      return;
    }
    const finalDuration = all.length > picked.length ? Math.min(MAX_DURATION, all.reduce((sum, x) => sum + x.duration_minutes, 0)) : duration;
    setSaving(true);
    setError(null);
    const err = await onSubmit({
      start_time: time,
      duration_minutes: finalDuration,
      user_id: selected?.user_id ?? null,
      phone: selected?.phone ?? (digits.length === 10 ? `+7${digits}` : null),
      client_name: isOrg ? null : name.trim() || null,
      car_id: hasCars && !useNewCar ? carChoice : null,
      car_make: useNewCar ? make.trim() || null : null,
      car_model: useNewCar ? model.trim() || null : null,
      car_plate: useNewCar ? plate.trim() || null : null,
      vin: useNewCar ? vin.trim() || null : null,
      services_text: others.length > 0 ? others.join(", ").slice(0, 500) : null, // «Другое» хранится отдельно от справочных услуг
      service_ids: all.map((x) => x.id),
    });
    if (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900">Новая запись</h2>
        <p className="text-xs text-gray-500 mt-0.5 capitalize">
          {postName} · {dateLabel}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <div className="relative">
              <div
                className={`flex items-center border rounded-lg bg-white transition-colors focus-within:border-brand-blue ${
                  phoneIncomplete ? "border-amber-300" : "border-gray-200"
                }`}
              >
                {phoneMode && <span className="pl-3 pr-1 text-sm text-gray-500 select-none">+7</span>}
                <input
                  autoFocus
                  type={phoneMode ? "tel" : "text"}
                  inputMode={phoneMode ? "numeric" : "text"}
                  value={textMode ? query : formatNational(digits)}
                  onChange={onInputChange}
                  onFocus={() => setShowSuggest(true)}
                  onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                  placeholder={textMode ? "Имя, организация или гос. номер" : "Телефон, имя, организация или гос. номер"}
                  className={`flex-1 min-w-0 py-2 text-sm bg-transparent focus:outline-none ${
                    phoneMode ? "px-1" : "px-3"
                  }`}
                />
              </div>

              {showSuggest && !selected && matches.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                  {matches.map((m) => (
                    <button
                      key={m.user_id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectClient(m);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-brand-blue/5 transition-colors cursor-pointer border-b border-gray-100 last:border-b-0"
                    >
                      {m.kind === "org" ? (
                        <p className="text-sm text-gray-900 flex items-center gap-1.5">
                          {m.full_name || "Организация"}
                          <span className="text-[10px] bg-brand-yellow/30 text-brand-blue-dark rounded-full px-1.5 py-0.5">
                            орг.
                          </span>
                          {m.inn && <span className="text-[11px] text-gray-400">ИНН {m.inn}</span>}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-900">
                          {m.phone ? formatFullPhone(m.phone) : ""}
                          <span className="text-gray-500"> · {m.full_name || "без имени"}</span>
                        </p>
                      )}
                      {m.cars.length > 0 && (
                        <p className="text-[11px] text-gray-400 truncate">{m.cars.map(carText).join(", ")}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selected ? (
              <>
                <p className="text-[11px] text-emerald-600 mt-1">
                  ✓{" "}
                  {isOrg
                    ? `Организация найдена${selected.inn ? ` · ИНН ${selected.inn}` : ""}`
                    : `Клиент найден${selected.full_name ? "" : " — имени в карточке пока нет"}`}
                </p>
                {selected.upcoming_total > 0 && (
                  <div
                    className={`mt-2 rounded-lg px-3 py-2 text-xs ${
                      sameDay
                        ? "bg-amber-100 text-amber-800 border border-amber-300"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    <p className="font-medium">
                      {sameDay ? "Уже записан на этот день" : "У клиента уже есть запись"}
                    </p>
                    {selected.upcoming.map((u, idx) => (
                      <p key={idx}>
                        {formatDayShort(u.date)}, {u.start_time}
                        {u.post_name ? ` · ${u.post_name}` : ""}
                        {u.status === "pending" ? " · ждёт подтверждения" : ""}
                      </p>
                    ))}
                    {selected.upcoming_total > selected.upcoming.length && (
                      <p>и ещё {selected.upcoming_total - selected.upcoming.length}</p>
                    )}
                  </div>
                )}
              </>
            ) : textMode ? (
              searchedFor === query.trim() && matches.length === 0 && query.trim().length >= 2 ? (
                <p className="text-[11px] text-amber-600 mt-1">
                  Никого не нашли. Организацию сначала добавьте в разделе «Клиенты»
                </p>
              ) : (
                <p className="text-[11px] text-gray-400 mt-1">Выберите клиента из списка</p>
              )
            ) : phoneIncomplete ? (
              <p className="text-[11px] text-amber-600 mt-1">Введите номер полностью — 10 цифр</p>
            ) : (
              <p className="text-[11px] text-gray-400 mt-1">
                Цифры — номер телефона, буквы — имя, организация или гос. номер. Без клиента запись сохранится как
                гость
              </p>
            )}
          </div>

          {!textMode && (
            <input
              value={name}
              readOnly={nameLocked}
              onChange={(e) => setName(e.target.value)}
              placeholder={selected && !selected.full_name ? "Имя — сохранится в карточке клиента" : "Имя (необязательно)"}
              className={`${fieldCls} ${nameLocked ? "bg-gray-50 text-gray-500" : ""}`}
            />
          )}

          {!searching && (
            <div>
              {hasCars && (
                <>
                  <p className="text-xs text-gray-500 mb-1.5">{isOrg ? "Машина организации" : "Машина клиента"}</p>
                  {allCars.length > 4 ? (
                    <select
                      value={carChoice}
                      onChange={(e) => setCarChoice(e.target.value)}
                      className={`${fieldCls} mb-2 cursor-pointer`}
                    >
                      {allCars.map((car) => (
                        <option key={car.id} value={car.id}>
                          {carText(car)}
                        </option>
                      ))}
                      <option value="new">+ Другая машина</option>
                    </select>
                  ) : (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {allCars.map((car) => (
                        <button
                          key={car.id}
                          type="button"
                          onClick={() => setCarChoice(car.id)}
                          className={chipClass(carChoice === car.id)}
                        >
                          {carText(car)}
                        </button>
                      ))}
                      <button type="button" onClick={() => setCarChoice("new")} className={chipClass(carChoice === "new")}>
                        + Другая машина
                      </button>
                    </div>
                  )}
                  {chosenCar?.vin && <p className="text-[11px] text-gray-400 font-mono mb-1">VIN: {chosenCar.vin}</p>}
                </>
              )}

              {useNewCar && (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Марка" className={fieldCls} />
                    <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Модель" className={fieldCls} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={plate}
                      maxLength={20}
                      onChange={(e) => setPlate(e.target.value.toUpperCase())}
                      placeholder="Гос. номер"
                      className={`${fieldCls} font-mono`}
                    />
                    <input
                      value={vin}
                      maxLength={17}
                      onChange={(e) => setVin(e.target.value.toUpperCase())}
                      placeholder="VIN (необязательно)"
                      className={`${fieldCls} font-mono`}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <p className="text-xs text-gray-500 mb-1.5">Время и длительность</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="time"
                value={time}
                step={300}
                onChange={(e) => setTime(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-brand-blue"
              />
              {DURATION_CHIPS.map((d) => (
                <button
                  key={d.min}
                  type="button"
                  onClick={() => setDuration(d.min)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                    duration === d.min
                      ? "border-brand-blue bg-brand-blue/10 text-brand-blue-dark"
                      : "border-gray-200 text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  {d.label}
                </button>
              ))}
              <div className="inline-flex items-stretch border border-gray-200 rounded-lg overflow-hidden bg-white">
                <span className="px-3 py-1.5 text-sm tabular-nums min-w-[6rem] text-center self-center">
                  {formatDuration(duration)}
                </span>
                <div className="flex flex-col border-l border-gray-200">
                  <button
                    type="button"
                    aria-label="Дольше на 30 минут"
                    onClick={() => setDuration((d) => Math.min(MAX_DURATION, Math.floor(d / 30) * 30 + 30))}
                    className="flex-1 px-2.5 flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-brand-blue active:bg-gray-200 transition-colors cursor-pointer"
                  >
                    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 15l6-6 6 6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label="Короче на 30 минут"
                    onClick={() => setDuration((d) => Math.max(30, Math.ceil(d / 30) * 30 - 30))}
                    className="flex-1 px-2.5 border-t border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-brand-blue active:bg-gray-200 transition-colors cursor-pointer"
                  >
                    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-1.5">Услуги</p>
            {picked.length + others.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {picked.map((x) => (
                  <span
                    key={x.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand-blue/10 text-brand-blue-dark text-xs font-medium pl-2.5 pr-1.5 py-1"
                  >
                    {x.name} · {formatDuration(x.duration_minutes)}
                    <button
                      type="button"
                      aria-label="Убрать услугу"
                      onClick={() => applyPicked(picked.filter((p) => p.id !== x.id))}
                      className="w-4 h-4 rounded-full hover:bg-brand-blue/20 flex items-center justify-center cursor-pointer leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {others.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand-yellow/30 text-brand-blue-dark text-xs font-medium pl-2.5 pr-1.5 py-1"
                  >
                    Другое: {t}
                    <button
                      type="button"
                      aria-label="Убрать"
                      onClick={() => setOthers((o) => o.filter((v) => v !== t))}
                      className="w-4 h-4 rounded-full hover:bg-brand-yellow/50 flex items-center justify-center cursor-pointer leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <textarea
                value={servicesText}
                maxLength={500}
                onChange={(e) => setServicesText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && (svcSuggestions.length > 0 || showOther)) {
                    e.preventDefault();
                    if (svcSuggestions.length > 0) pickService(svcSuggestions[0]);
                    else pickOther();
                  }
                }}
                onFocus={() => setSvcFocus(true)}
                onBlur={() => setTimeout(() => setSvcFocus(false), 150)}
                placeholder="Начните вводить услугу и выберите из списка"
                rows={3}
                className={`${fieldCls} resize-none`}
              />
              {svcFocus && (svcSuggestions.length > 0 || showOther) && (
                <div className="absolute z-10 bottom-full left-0 right-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                  {svcSuggestions.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickService(x);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-brand-blue/5 transition-colors cursor-pointer border-b border-gray-100 last:border-b-0 flex items-center justify-between gap-3"
                    >
                      <span className="text-sm text-gray-900 truncate">{x.name}</span>
                      <span className="text-xs text-gray-400 whitespace-nowrap">{formatDuration(x.duration_minutes)}</span>
                    </button>
                  ))}
                  {svcSuggestions.length === 0 && showOther && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickOther();
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-brand-yellow/20 transition-colors cursor-pointer flex items-center justify-between gap-3"
                    >
                      <span className="text-sm text-gray-900 truncate">Другое: «{rawFragment}»</span>
                      <span className="text-xs text-gray-400 whitespace-nowrap">нет в справочнике</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-3">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={submit}
            disabled={!canSave}
            className="flex-1 bg-brand-blue text-white text-sm font-medium rounded-lg py-2.5 hover:bg-brand-blue/90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            {saving ? "Сохраняю…" : "Записать"}
          </button>
          <button
            onClick={onClose}
            className="text-sm text-gray-500 px-4 py-2.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

function NoteDialog({
  title,
  placeholder,
  confirmLabel,
  danger,
  onSubmit,
  onClose,
}: {
  title: string;
  placeholder: string;
  confirmLabel: string;
  danger?: boolean;
  onSubmit: (note: string) => Promise<void>;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-500 mt-0.5">Комментарий клиенту — необязательно. Он придёт сообщением в чат.</p>
        <textarea
          autoFocus
          value={note}
          maxLength={500}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          placeholder={placeholder}
          className="mt-3 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-brand-blue"
        />
        <div className="mt-4 flex items-center gap-2">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onSubmit(note);
              setBusy(false);
            }}
            className={`flex-1 text-white text-sm font-medium rounded-lg py-2.5 active:scale-[0.98] disabled:opacity-40 transition cursor-pointer ${
              danger ? "bg-red-600 hover:bg-red-600/90" : "bg-brand-blue hover:bg-brand-blue/90"
            }`}
          >
            {busy ? "Отправляю…" : confirmLabel}
          </button>
          <button
            onClick={onClose}
            className="text-sm text-gray-500 px-4 py-2.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
          >
            Назад
          </button>
        </div>
      </div>
    </div>
  );
}

/** Лист для печати: расписание выбранного дня, посты — колонками. Показывается только при печати. */
function PrintSheet({ date, posts }: { date: Date; posts: CalendarPost[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const cols = posts.filter((p) => p.working && p.slots.length > 0);
  const title = date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  let startMin = 24 * 60;
  let endMin = 0;
  for (const p of cols) {
    startMin = Math.min(startMin, timeToMinutes(p.slots[0].time));
    endMin = Math.max(endMin, timeToMinutes(p.slots[p.slots.length - 1].time) + 30);
  }
  const total = Math.max(60, endMin - startMin);
  const scale = Math.min(0.9, 235 / total); // мм на минуту: весь день помещается на один лист А4
  const mm = (min: number) => `${(min - startMin) * scale}mm`;
  const ticks: number[] = [];
  for (let m = startMin; m < endMin; m += 30) ticks.push(m);

  const content = (
    <div id="print-root" style={{ fontFamily: "Arial, Helvetica, sans-serif", color: "#000" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "3mm" }}>
        <div style={{ fontSize: "14pt", fontWeight: 700 }}>Расписание · {title}</div>
        <div style={{ fontSize: "8pt", color: "#555" }}>Твоя Шина</div>
      </div>
      {cols.length === 0 ? (
        <div style={{ fontSize: "11pt", color: "#555", padding: "10mm 0" }}>В этот день посты не работают</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `12mm repeat(${cols.length}, minmax(0, 1fr))`, columnGap: "1.5mm" }}>
          <div />
          {cols.map((p) => (
            <div key={p.post_id} style={{ textAlign: "center", fontWeight: 700, fontSize: "10pt", borderBottom: "0.4mm solid #000", paddingBottom: "1mm", marginBottom: "1mm" }}>
              {p.name}
            </div>
          ))}
          <div style={{ position: "relative", height: `${total * scale}mm` }}>
            {ticks
              .filter((m) => m % 60 === 0)
              .map((m) => (
                <div key={m} style={{ position: "absolute", top: mm(m), right: "1mm", fontSize: "8pt", fontWeight: 700, lineHeight: 1, transform: "translateY(-0.5em)" }}>
                  {minutesToTime(m)}
                </div>
              ))}
          </div>
          {cols.map((p) => (
            <div key={p.post_id} style={{ position: "relative", height: `${total * scale}mm`, borderLeft: "0.2mm solid #999", borderRight: "0.2mm solid #999" }}>
              {ticks.map((m) => (
                <div key={m} style={{ position: "absolute", left: 0, right: 0, top: mm(m), borderTop: m % 60 === 0 ? "0.2mm solid #999" : "0.2mm dotted #ccc" }} />
              ))}
              {p.slots
                .filter((sl) => sl.booking && sl.is_start)
                .map((sl) => {
                  const b = sl.booking!;
                  const st = timeToMinutes(b.start_time);
                  const dur = Math.max(15, Math.min(b.duration_minutes, endMin - st));
                  const pending = sl.status === "pending";
                  const name = b.is_org || b.is_guest ? b.client_name || "Гость" : firstName(b.client_name || "Гость");
                  const car = b.car ? `${b.car.make} ${b.car.model}${b.car.plate ? " " + b.car.plate : ""}` : "";
                  const work = [...b.services.map((x) => x.name), b.services_text].filter(Boolean).join(", ");
                  return (
                    <div
                      key={b.id}
                      style={{
                        position: "absolute",
                        left: "0.4mm",
                        right: "0.4mm",
                        top: mm(st),
                        height: `${dur * scale - 0.6}mm`,
                        boxSizing: "border-box",
                        overflow: "hidden",
                        padding: "0.6mm 1mm",
                        fontSize: "7.5pt",
                        lineHeight: 1.15,
                        background: pending ? "#fff" : "#e6e6e6",
                        border: pending ? "0.35mm dashed #000" : "0.35mm solid #000",
                        borderRadius: "0.8mm",
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>
                        {b.start_time}–{addMinutes(b.start_time, b.duration_minutes)}
                        {pending ? " · не подтв." : ""}
                        {b.part > 0 ? " · продолжение" : ""}
                      </div>
                      <div>{[name, car].filter(Boolean).join(" · ")}</div>
                      {work && <div>{work}</div>}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: "2mm", fontSize: "7pt", color: "#555" }}>
        Серые блоки — подтверждённые записи, пунктир — ожидают подтверждения. Напечатано {new Date().toLocaleString("ru-RU")}
      </div>
    </div>
  );
  return createPortal(content, document.body);
}

function CalendarPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientParam = searchParams.get("client");
  const [bookFor, setBookFor] = useState<BookingClientMatch | null>(null);
  const [bookForError, setBookForError] = useState<string | null>(null);

  // переход «Записать» из чата / карточки клиента: подтягиваем данные клиента
  useEffect(() => {
    setBookFor(null);
    setBookForError(null);
    if (!clientParam) return;
    let cancelled = false;
    (async () => {
      try {
        const c = (await getClients()).find((x) => x.id === clientParam);
        if (!c) {
          if (!cancelled) setBookForError("клиент не найден");
          return;
        }
        const q = c.phone ? extractNational(c.phone) : (c.full_name ?? "").trim();
        const found = q.length >= 2 ? (await searchClientsForBooking(q)).find((x) => x.user_id === clientParam) : undefined;
        const m: BookingClientMatch = found ?? {
          user_id: c.id,
          phone: c.phone,
          kind: c.kind,
          inn: c.inn,
          full_name: c.full_name,
          cars: [],
          upcoming: [],
          upcoming_total: 0,
        };
        if (!cancelled) setBookFor(m);
      } catch {
        if (!cancelled) setBookForError("не удалось загрузить клиента");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientParam]);

  const [date, setDate] = useState(() => new Date());
  const [posts, setPosts] = useState<CalendarPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [durationDrafts, setDurationDrafts] = useState<Record<string, number>>({});
  const [hoveredBooking, setHoveredBooking] = useState<CalendarBooking | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ postId: string; start: number } | null>(null);
  const [newBooking, setNewBooking] = useState<{ postId: string; postName: string; time: string } | null>(null);

  // Номер последнего запроса: устаревший ответ (после смены дня) игнорируем
  const reqId = useRef(0);

  // silent = true — обновить данные на месте, без «Загрузка…» (после действий и при фоновом опросе)
  function load(silent = true) {
    const id = ++reqId.current;
    if (!silent) setLoading(true);
    getCalendar(toISODate(date))
      .then((data) => {
        if (id !== reqId.current) return;
        setPosts((prev) => (JSON.stringify(prev) === JSON.stringify(data.posts) ? prev : data.posts));
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Живое обновление: раз в 10 секунд и при возврате на вкладку (только пока вкладка видна)
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") load(true);
    };
    const t = setInterval(tick, 10000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Запись, на которую навели, пропала после обновления — снимаем подсветку и карточку
  useEffect(() => {
    if (!hoveredBooking) return;
    const exists = posts.some((p) => p.slots.some((s) => s.booking?.id === hoveredBooking.id));
    if (!exists) setHoveredBooking(null);
  }, [posts, hoveredBooking]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(t);
  }, [toast]);

  function copyText(text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => setToast("Скопировано"))
      .catch(() => setToast("Не удалось скопировать"));
  }

  function shiftWeek(delta: number) {
    const next = new Date(monday);
    next.setDate(next.getDate() + delta * 7);
    setDate(next);
  }

  function shiftDay(delta: number) {
    const next = new Date(date);
    do {
      next.setDate(next.getDate() + delta);
    } while ((next.getDay() === 6 && !weekend?.sat) || (next.getDay() === 0 && !weekend?.sun));
    setDate(next);
  }

  const monday = useMemo(() => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [date]);

  const mondayISO = toISODate(monday);

  // сколько заявок ждут подтверждения по дням недели — пометки на датах
  const [pendingDays, setPendingDays] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    const run = () =>
      getPendingDays(mondayISO, 7)
        .then((d) => {
          if (!cancelled) setPendingDays(d);
        })
        .catch(() => {});
    run();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [mondayISO, posts]);

  // Суббота и воскресенье показываются только если в этот день работает хотя бы один пост
  const [weekend, setWeekend] = useState<{ monday: string; sat: boolean; sun: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sat = new Date(monday);
    sat.setDate(sat.getDate() + 5);
    const sun = new Date(monday);
    sun.setDate(sun.getDate() + 6);
    const hasWork = (list: CalendarPost[]) => list.some((p) => p.working && p.slots.length > 0);
    Promise.all([getCalendar(toISODate(sat)), getCalendar(toISODate(sun))])
      .then(([a, b]) => {
        if (!cancelled) setWeekend({ monday: mondayISO, sat: hasWork(a.posts), sun: hasWork(b.posts) });
      })
      .catch(() => {
        if (!cancelled) setWeekend({ monday: mondayISO, sat: false, sun: false });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mondayISO]);

  const weekDays = useMemo(() => {
    const idx = [0, 1, 2, 3, 4];
    if (weekend && weekend.monday === mondayISO) {
      if (weekend.sat) idx.push(5);
      if (weekend.sun) idx.push(6);
    }
    return idx.map((i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [monday, mondayISO, weekend]);

  // Если открыта суббота/воскресенье, а в этот день никто не работает — идём вперёд
  // до ближайшего рабочего дня (воскресенье, если оно рабочее, иначе понедельник следующей недели)
  useEffect(() => {
    if (!weekend || weekend.monday !== mondayISO) return;
    const day = date.getDay();
    if ((day === 6 && !weekend.sat) || (day === 0 && !weekend.sun)) {
      const next = new Date(monday);
      next.setDate(next.getDate() + (day === 6 && weekend.sun ? 6 : 7));
      setDate(next);
    }
  }, [weekend, mondayISO, date, monday]);

  // колонку мастера в выходной/отпуск оставляем, если в ней есть записи: их нужно перенести
  const workingPosts = posts.filter((p) => (p.working || p.day_off) && p.slots.length > 0);

  const postRanges = useMemo(() => {
    const ranges: Record<string, { start: number; end: number }> = {};
    for (const post of workingPosts) {
      const start = timeToMinutes(post.slots[0].time);
      const end = timeToMinutes(post.slots[post.slots.length - 1].time) + 30;
      ranges[post.post_id] = { start, end };
    }
    return ranges;
  }, [workingPosts]);

  const globalStart = workingPosts.length
    ? Math.min(...workingPosts.map((p) => postRanges[p.post_id].start))
    : 0;
  const globalEnd = workingPosts.length
    ? Math.max(...workingPosts.map((p) => postRanges[p.post_id].end))
    : 0;
  const totalHeight = (globalEnd - globalStart) * PX_PER_MIN;

  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    const first = Math.ceil(globalStart / 60) * 60;
    for (let m = first; m <= globalEnd; m += 60) marks.push(m);
    return marks;
  }, [globalStart, globalEnd]);

  const halfHourMarks = useMemo(() => {
    const marks: number[] = [];
    const first = Math.ceil(globalStart / 30) * 30;
    for (let m = first; m <= globalEnd; m += 30) if (m % 60 !== 0) marks.push(m);
    return marks;
  }, [globalStart, globalEnd]);

  const postBookings = useMemo(() => {
    const map: Record<string, { booking: CalendarBooking; status: "pending" | "confirmed" }[]> = {};
    for (const post of workingPosts) {
      const seen = new Set<string>();
      const list: { booking: CalendarBooking; status: "pending" | "confirmed" }[] = [];
      for (const slot of post.slots) {
        if (slot.status === "free" || !slot.booking) continue;
        if (seen.has(slot.booking.id)) continue;
        seen.add(slot.booking.id);
        list.push({ booking: slot.booking, status: slot.status as "pending" | "confirmed" });
      }
      map[post.post_id] = list;
    }
    return map;
  }, [workingPosts]);

  const hoveredRange = hoveredBooking
    ? ([
        timeToMinutes(hoveredBooking.start_time),
        timeToMinutes(hoveredBooking.start_time) + hoveredBooking.duration_minutes,
      ] as const)
    : null;

  async function handlePlaceClick(postId: string, time: string) {
    if (!placing) return;
    const targetDate = toISODate(date); // перенос идёт на ту дату, которая сейчас открыта
    const ok =
      placing.action === "move"
        ? await movePendingBooking(placing.bookingId, postId, time, targetDate)
        : await rescheduleBooking(placing.bookingId, postId, time, targetDate);
    if (ok) {
      setPlacing(null);
      load();
    } else {
      alert("Это время уже занято на выбранном посту");
    }
  }

  function slotAt(e: React.MouseEvent<HTMLDivElement>, rangeStart: number) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const minutes = rangeStart + relY / PX_PER_MIN;
    return Math.floor(minutes / 30) * 30;
  }

  // прошедшие дни — только просмотр: ни записать, ни перенести
  function isPastDay() {
    return toISODate(date) < toISODate(new Date());
  }

  function handleBackgroundMove(e: React.MouseEvent<HTMLDivElement>, postId: string, rangeStart: number) {
    if (isPastDay()) {
      setGhost(null);
      return;
    }
    const start = slotAt(e, rangeStart);
    setGhost((prev) => (prev && prev.postId === postId && prev.start === start ? prev : { postId, start }));
  }

  function handleBackgroundClick(e: React.MouseEvent<HTMLDivElement>, postId: string, rangeStart: number) {
    if (isPastDay()) return;
    const time = minutesToTime(slotAt(e, rangeStart));
    if (placing) {
      handlePlaceClick(postId, time);
      return;
    }
    const postName = workingPosts.find((p) => p.post_id === postId)?.name ?? "";
    setHoveredBooking(null);
    setNewBooking({ postId, postName, time });
  }

  // подтверждение, отклонение и отмена идут с необязательным комментарием: клиент получит его сообщением в чат
  const [noteAsk, setNoteAsk] = useState<{ kind: "confirm" | "decline" | "cancel"; booking: CalendarBooking; duration?: number } | null>(null);

  function findBooking(id: string): CalendarBooking | null {
    return posts.flatMap((p) => p.slots).find((s) => s.booking?.id === id)?.booking ?? null;
  }

  function handleConfirmInPlace(booking: CalendarBooking, duration: number) {
    setNoteAsk({ kind: "confirm", booking, duration });
  }

  function handleDeclinePending(id: string) {
    const b = findBooking(id);
    if (b) setNoteAsk({ kind: "decline", booking: b });
  }

  async function handleDuration(id: string, delta: number) {
    const ok = await changeBookingDuration(id, delta);
    if (ok) {
      setToast(delta > 0 ? "Время увеличено" : "Время уменьшено");
      load();
    } else {
      alert("Не удалось изменить время — похоже, место занято");
    }
  }

  function handleCancelConfirmed(id: string) {
    const b = findBooking(id);
    if (b) setNoteAsk({ kind: "cancel", booking: b });
  }

  async function runNote(note: string) {
    const a = noteAsk;
    if (!a) return;
    const text = note.trim() || undefined;
    let ok = false;
    if (a.kind === "confirm") ok = await confirmBooking(a.booking.id, a.booking.post_id, a.duration, a.booking.start_time, text);
    else if (a.kind === "decline") ok = await declineBooking(a.booking.id, text);
    else ok = await cancelBooking(a.booking.id, text);
    if (ok) {
      setNoteAsk(null);
      setToast(a.kind === "confirm" ? "Запись подтверждена" : a.kind === "decline" ? "Заявка отклонена" : "Запись отменена");
      load();
    } else {
      alert(a.kind === "confirm" ? "Не удалось подтвердить — похоже, время уже занято" : "Не удалось выполнить действие");
    }
  }

  return (
    <div className="-m-6 md:-m-10 p-3 md:p-10 md:rounded-[12px] bg-[#e8eaf0] min-h-[100dvh] md:min-h-[calc(100dvh-2rem)]">
      <div className="hidden md:flex items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Календарь</h1>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 h-9 px-3.5 rounded-xl bg-white shadow-sm text-sm text-gray-700 hover:bg-brand-blue/10 hover:text-brand-blue-dark active:scale-95 transition cursor-pointer"
        >
          <Icon src="/icons/printer.svg" className="w-4 h-4" />
          Распечатать день
        </button>
      </div>

      <div className="md:hidden flex items-center gap-2 mb-3">
        <button
          onClick={() => shiftDay(-1)}
          aria-label="Предыдущий день"
          className="w-11 h-11 rounded-xl bg-white shadow-sm text-gray-500 active:scale-95 flex items-center justify-center shrink-0 transition"
        >
          <Icon src="/icons/arrow-left.svg" className="w-4 h-4" />
        </button>
        <button
          onClick={() => setDate(new Date())}
          aria-label="Перейти на сегодня"
          className="relative flex-1 h-11 rounded-xl bg-white shadow-sm text-sm font-semibold text-gray-900 capitalize"
        >
          {formatDateHuman(date)}
          {(pendingDays[toISODate(date)] ?? 0) > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-brand-yellow text-brand-blue-dark text-[11px] font-bold flex items-center justify-center shadow-sm">
              {pendingDays[toISODate(date)]}
            </span>
          )}
        </button>
        <button
          onClick={() => shiftDay(1)}
          aria-label="Следующий день"
          className="w-11 h-11 rounded-xl bg-white shadow-sm text-gray-500 active:scale-95 flex items-center justify-center shrink-0 transition"
        >
          <Icon src="/icons/arrow-right.svg" className="w-4 h-4" />
        </button>
      </div>
      <div className="hidden md:flex items-center gap-2 mb-2">
        <button
          onClick={() => shiftWeek(-1)}
          aria-label="Предыдущая неделя"
          className="w-9 h-9 rounded-xl bg-white shadow-sm text-gray-500 hover:bg-brand-blue/10 hover:text-brand-blue active:scale-95 flex items-center justify-center shrink-0 transition cursor-pointer"
        >
          <Icon src="/icons/arrow-left.svg" className="w-4 h-4" />
        </button>

        <div className="grid gap-2 flex-1" style={{ gridTemplateColumns: `repeat(${weekDays.length}, minmax(0, 1fr))` }}>
          {weekDays.map((d) => {
            const iso = toISODate(d);
            const isSelected = iso === toISODate(date);
            const isToday = iso === toISODate(new Date());
            return (
              <button
                key={iso}
                onClick={() => setDate(d)}
                className={`relative flex flex-col items-center py-3 rounded-xl font-medium transition-colors cursor-pointer min-w-0 ${
                  isSelected
                    ? "bg-brand-blue text-white shadow-sm"
                    : isToday
                    ? "bg-brand-yellow/20 text-brand-blue-dark hover:bg-brand-yellow/30"
                    : "bg-white text-gray-600 hover:bg-brand-blue/10 hover:text-brand-blue-dark shadow-sm"
                }`}
              >
                <span className="text-sm font-semibold max-w-full truncate px-1">
                  {d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                </span>
                <span className="text-[11px] opacity-70 capitalize max-w-full truncate px-1">
                  {d.toLocaleDateString("ru-RU", { weekday: "long" })}
                </span>
                {(pendingDays[iso] ?? 0) > 0 && (
                  <span
                    title="Ждут подтверждения"
                    className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-brand-yellow text-brand-blue-dark text-[11px] font-bold flex items-center justify-center shadow-sm"
                  >
                    {pendingDays[iso]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => shiftWeek(1)}
          aria-label="Следующая неделя"
          className="w-9 h-9 rounded-xl bg-white shadow-sm text-gray-500 hover:bg-brand-blue/10 hover:text-brand-blue active:scale-95 flex items-center justify-center shrink-0 transition cursor-pointer"
        >
          <Icon src="/icons/arrow-right.svg" className="w-4 h-4" />
        </button>
        <button
          onClick={() => setDate(new Date())}
          className="text-xs text-brand-blue font-medium ml-2 px-2 py-1.5 rounded-lg hover:bg-brand-blue/10 transition-colors cursor-pointer"
        >
          Сегодня
        </button>
      </div>
      <p className="hidden md:block text-sm text-gray-500 mb-4 capitalize">{formatDateHuman(date)}</p>

      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-white border border-gray-300" />
          <span className="text-xs text-gray-500">Свободно</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-brand-blue/30 border border-brand-blue" />
          <span className="text-xs text-gray-500">Занято</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-[#FBEFD6] border border-[#E8B84B]" />
          <span className="text-xs text-gray-500">Ждёт подтверждения</span>
        </div>
      </div>

      {placing && (
        <div className="mb-4 bg-brand-yellow/20 border border-brand-yellow rounded-xl px-4 py-2 flex items-center justify-between">
          <p className="text-sm text-brand-blue-dark">
            Перенос записи «{placing.clientName}» — выберите день вверху и кликните на свободное место в колонке мастера
          </p>
          <button
            onClick={() => setPlacing(null)}
            className="text-xs text-gray-500 hover:text-gray-800 font-medium px-2 py-1 rounded-lg hover:bg-white/60 transition-colors cursor-pointer"
          >
            Отмена
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Загрузка…</p>
      ) : workingPosts.length === 0 ? (
        <p className="text-sm text-gray-400">В этот день нет рабочих постов</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-x-auto p-2 md:p-4">
          <div className="flex md:min-w-fit">
            <div className="shrink-0 w-10 md:w-[52px]" />
            {workingPosts.map((p) => (
              <div
                key={p.post_id}
                className="flex-1 min-w-0 md:min-w-[150px] text-xs text-gray-600 font-medium truncate px-1 pb-2"
              >
                {p.name}
                {p.day_off && (
                  <span className="ml-1.5 rounded-full bg-gray-200 text-gray-500 text-[10px] px-1.5 py-0.5 font-normal">
                    не работает
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="flex md:min-w-fit">
            <div style={{ height: totalHeight }} className="relative shrink-0 w-10 md:w-[52px]">
              {hourMarks.map((m) => (
                <span
                  key={m}
                  className="absolute right-2 -translate-y-1/2 text-xs text-gray-400"
                  style={{ top: (m - globalStart) * PX_PER_MIN }}
                >
                  {minutesToTime(m)}
                </span>
              ))}
              {halfHourMarks.map((m) => (
                <span
                  key={m}
                  className="absolute right-2 -translate-y-1/2 text-xs text-gray-400"
                  style={{ top: (m - globalStart) * PX_PER_MIN }}
                >
                  {minutesToTime(m)}
                </span>
              ))}
              {hoveredRange && (
                <div
                  className="absolute left-0 right-0 bg-brand-yellow/20 border-r-2 border-brand-yellow pointer-events-none"
                  style={{
                    top: (hoveredRange[0] - globalStart) * PX_PER_MIN,
                    height: (hoveredRange[1] - hoveredRange[0]) * PX_PER_MIN,
                  }}
                />
              )}
            </div>

            {workingPosts.map((p) => {
              const range = postRanges[p.post_id];
              return (
                <div
                  key={p.post_id}
                  className="flex-1 min-w-0 md:min-w-[150px] relative border-l border-gray-100 px-1"
                  style={{ height: totalHeight }}
                >
                  {range.start > globalStart && (
                    <div
                      className="absolute inset-x-0 top-0 bg-gray-50"
                      style={{ height: (range.start - globalStart) * PX_PER_MIN }}
                    />
                  )}
                  <div
                    onClick={p.day_off ? undefined : (e) => handleBackgroundClick(e, p.post_id, range.start)}
                    onMouseMove={p.day_off ? undefined : (e) => handleBackgroundMove(e, p.post_id, range.start)}
                    onMouseLeave={() => setGhost(null)}
                    className={`absolute inset-x-0 ${
                      p.day_off ? "bg-gray-100 cursor-not-allowed" : `bg-white ${placing ? "cursor-cell" : "cursor-pointer"}`
                    }`}
                    style={{
                      top: (range.start - globalStart) * PX_PER_MIN,
                      height: (range.end - range.start) * PX_PER_MIN,
                    }}
                  />
                  {range.end < globalEnd && (
                    <div
                      className="absolute inset-x-0 bg-gray-50"
                      style={{
                        top: (range.end - globalStart) * PX_PER_MIN,
                        height: (globalEnd - range.end) * PX_PER_MIN,
                      }}
                    />
                  )}

                  {halfHourMarks.map((m) => (
                    <div
                      key={m}
                      className="absolute inset-x-0 border-t border-black/10 pointer-events-none"
                      style={{ top: (m - globalStart) * PX_PER_MIN }}
                    />
                  ))}
                  {hourMarks.map((m) => (
                    <div
                      key={m}
                      className="absolute inset-x-0 border-t border-black/10 pointer-events-none"
                      style={{ top: (m - globalStart) * PX_PER_MIN }}
                    />
                  ))}

                  {ghost && ghost.postId === p.post_id && (
                    <div
                      className="absolute inset-x-1 rounded-md border border-dashed border-brand-blue/60 bg-brand-blue/10 pointer-events-none flex items-center justify-center text-[11px] font-medium text-brand-blue-dark"
                      style={{
                        top: (ghost.start - globalStart) * PX_PER_MIN + GAP / 2,
                        height: SLOT_PX - GAP,
                      }}
                    >
                      {placing ? "Перенести сюда" : "+ Записать"} · {minutesToTime(ghost.start)}
                    </div>
                  )}

                  {postBookings[p.post_id].map(({ booking, status }) => {
                    const isPending = status === "pending";
                    const isHovered = hoveredBooking?.id === booking.id;
                    const draft = isPending
                      ? durationDrafts[booking.id] ?? booking.duration_minutes
                      : booking.duration_minutes;
                    const start = timeToMinutes(booking.start_time);
                    const top = (start - globalStart) * PX_PER_MIN + GAP / 2;
                    const height = booking.duration_minutes * PX_PER_MIN - GAP;
                    const serviceLabel =
                      [booking.services.map((s) => s.name).join(", "), booking.services_text]
                        .filter(Boolean)
                        .join(" · ") || null;
                    const carLabel = booking.car
                      ? [`${booking.car.make} ${booking.car.model}`.trim(), booking.car.plate].filter(Boolean).join(" · ")
                      : null;
                    return (
                      <div
                        key={booking.id}
                        onMouseEnter={() => setHoveredBooking(booking)}
                        onMouseLeave={() => setHoveredBooking(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setHoveredBooking(booking);
                        }}
                        className={`absolute inset-x-1 rounded-md border cursor-pointer transition-colors flex flex-col justify-center px-2 py-1 gap-0.5 shadow-sm ${
                          isPending
                            ? isHovered
                              ? "bg-[#F5E3B8] border-[#E8B84B]"
                              : "bg-[#FBEFD6] border-[#E8B84B]"
                            : isHovered
                            ? "bg-brand-blue/40 border-brand-blue"
                            : "bg-brand-blue/30 border-brand-blue"
                        }`}
                        style={{ top, height }}
                      >
                        <span
                          className={`text-[11px] font-semibold truncate leading-tight ${
                            isPending ? "text-[#8A6212]" : "text-brand-blue-dark"
                          }`}
                        >
                          {booking.is_org ? booking.client_name : firstName(booking.client_name)}{booking.part > 0 ? " · продолжение" : ""}
                        </span>
                        {serviceLabel && (
                          <span
                            className={`text-[10px] truncate leading-tight ${
                              isPending ? "text-[#8A6212]/80" : "text-brand-blue-dark/80"
                            }`}
                          >
                            {serviceLabel}
                          </span>
                        )}
                        {carLabel && (
                          <span
                            className={`text-[10px] truncate leading-tight ${
                              isPending ? "text-[#8A6212]/70" : "text-brand-blue-dark/70"
                            }`}
                          >
                            {carLabel}
                          </span>
                        )}
                        <BookingPopover
                          booking={booking}
                          status={status}
                          visible={isHovered}
                          draftDuration={isPending ? draft : undefined}
                          onDraftDurationChange={
                            isPending
                              ? (v) => setDurationDrafts((prev) => ({ ...prev, [booking.id]: v }))
                              : undefined
                          }
                          onConfirm={isPending ? () => handleConfirmInPlace(booking, draft) : undefined}
                          onMoveOrReschedule={() =>
                            setPlacing({
                              bookingId: booking.id,
                              action: isPending ? "move" : "reschedule",
                              clientName: booking.client_name,
                            })
                          }
                          onCancelAction={() =>
                            isPending ? handleDeclinePending(booking.id) : handleCancelConfirmed(booking.id)
                          }
                          onDurationChange={isPending ? undefined : (delta) => handleDuration(booking.id, delta)}
                          onCopy={copyText}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {newBooking && (
        <NewBookingModal
          postName={newBooking.postName}
          dateLabel={formatDateHuman(date)}
          dateISO={toISODate(date)}
          initialTime={newBooking.time}
          initialClient={bookFor}
          onClose={() => setNewBooking(null)}
          onSubmit={async (form) => {
            const res = await createManualBooking({
              post_id: newBooking.postId,
              date: toISODate(date),
              ...form,
            });
            if (!res.ok) return res.error;
            setNewBooking(null);
            if (clientParam) router.replace("/nord/calendar");
            setToast("Запись создана");
            load();
            return null;
          }}
        />
      )}

      {noteAsk && (
        <NoteDialog
          title={noteAsk.kind === "confirm" ? "Подтвердить запись" : noteAsk.kind === "decline" ? "Отклонить заявку" : "Отменить запись"}
          placeholder={
            noteAsk.kind === "confirm"
              ? "Например: привезите, пожалуйста, ключи от секреток"
              : "Например: в это время мы закрыты, давайте подберём другое"
          }
          confirmLabel={noteAsk.kind === "confirm" ? "Подтвердить" : noteAsk.kind === "decline" ? "Отклонить" : "Отменить запись"}
          danger={noteAsk.kind !== "confirm"}
          onSubmit={runNote}
          onClose={() => setNoteAsk(null)}
        />
      )}

      <PrintSheet date={date} posts={posts} />

      {clientParam && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100vw-2rem)] flex items-center gap-3 rounded-2xl bg-white border border-brand-yellow shadow-lg pl-4 pr-2 py-2.5">
          <span className="w-1.5 h-8 rounded-full bg-brand-yellow flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">
              Запись для: {bookFor ? bookFor.full_name || (bookFor.phone ? formatFullPhone(bookFor.phone) : "клиента") : bookForError ?? "загрузка…"}
            </div>
            <div className="text-xs text-gray-500">Нажмите на свободное время — данные клиента подставятся</div>
          </div>
          <button
            type="button"
            onClick={() => router.replace("/nord/calendar")}
            aria-label="Отменить"
            className="w-8 h-8 rounded-full text-gray-400 hover:bg-gray-100 flex items-center justify-center flex-shrink-0"
          >
            <Icon src="/icons/close.svg" className="w-4 h-4" />
          </button>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-xs px-4 py-2 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarPageInner />
    </Suspense>
  );
}
