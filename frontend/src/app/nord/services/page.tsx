"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAllServices, createService, updateService, hideService, type CatalogService } from "@/lib/api";

const CHIPS = [30, 60, 90, 120, 180, 240];

function formatDuration(min: number) {
  if (min % 30 === 0) return `${String(min / 60).replace(".", ",")} ч`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h ? `${h} ч` : ""}${h && m ? " " : ""}${m ? `${m} мин` : ""}` || "0 мин";
}

const STEP = 30;
const MIN_NORM = 30;
const MAX_NORM = 4800;

// норматив в часах с шагом в полчаса
function HoursStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const dec = () => onChange(Math.max(MIN_NORM, Math.ceil(value / STEP) * STEP - STEP));
  const inc = () => onChange(Math.min(MAX_NORM, Math.floor(value / STEP) * STEP + STEP));
  const btn = "w-9 h-9 text-lg leading-none text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer select-none";
  return (
    <div className="flex items-center rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button type="button" aria-label="Меньше" onClick={dec} className={btn}>
        −
      </button>
      <span className="flex-1 text-center text-sm font-medium text-gray-900 whitespace-nowrap px-1">{formatDuration(value)}</span>
      <button type="button" aria-label="Больше" onClick={inc} className={btn}>
        +
      </button>
    </div>
  );
}

function Icon({ name, className = "w-4 h-4" }: { name: string; className?: string }) {
  const src = `/icons/${name}.svg`;
  return (
    <span
      aria-hidden
      className={`${className} inline-block bg-current flex-shrink-0`}
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

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20";
const primaryBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-dark disabled:opacity-50 transition-colors";
const ghostBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer";

// категория со своими подсказками: максимум 4 ближайших (сначала по первым буквам, потом по вхождению)
function CategoryInput({ value, onChange, categories }: { value: string; onChange: (v: string) => void; categories: string[] }) {
  const [focus, setFocus] = useState(false);
  const q = value.trim().toLowerCase();
  const list = categories
    .filter((c) => c.toLowerCase() !== q && (q === "" || c.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q)))
    .slice(0, 4);
  return (
    <div className="relative">
      <input
        className={inputCls}
        placeholder="Категория"
        value={value}
        maxLength={60}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
      />
      {focus && list.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          {list.map((c) => (
            <button
              key={c}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(c);
                setFocus(false);
              }}
              className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-brand-blue/5 transition-colors cursor-pointer border-b border-gray-100 last:border-b-0"
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Draft = { name: string; category: string; duration: number };
const EMPTY: Draft = { name: "", category: "", duration: 60 };

export default function NordServicesPage() {
  const [items, setItems] = useState<CatalogService[] | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<(Draft & { id: string }) | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    try {
      setItems(await getAllServices());
    } catch {
      notify("Не удалось загрузить услуги", true);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<void>, okText?: string) {
    setBusy(true);
    try {
      await action();
      if (okText) notify(okText);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Ошибка", true);
    } finally {
      setBusy(false);
    }
  }

  // категории по убыванию частоты — самые используемые подсказываются первыми
  const categories = useMemo(() => {
    const count = new Map<string, number>();
    for (const x of items ?? []) if (x.category) count.set(x.category, (count.get(x.category) ?? 0) + 1);
    return Array.from(count.entries()).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [items]);

  const { groups, hidden } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: CatalogService) => !q || s.name.toLowerCase().includes(q) || (s.category ?? "").toLowerCase().includes(q);
    const map = new Map<string, CatalogService[]>();
    const hiddenList: CatalogService[] = [];
    for (const s of items ?? []) {
      if (!match(s)) continue;
      if (!s.is_active) {
        hiddenList.push(s);
        continue;
      }
      const key = s.category ?? "Без категории";
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return { groups: Array.from(map.entries()), hidden: hiddenList };
  }, [items, query]);

  function replace(item: CatalogService) {
    setItems((list) => (list ? list.map((x) => (x.id === item.id ? item : x)) : list));
  }

  async function add() {
    if (!draft.name.trim()) return notify("Введите название услуги", true);
    await run(async () => {
      const created = await createService({ name: draft.name, category: draft.category.trim() || null, duration_minutes: draft.duration });
      setItems((list) => [...(list ?? []), created]);
      setDraft({ ...EMPTY, category: draft.category });
    }, "Услуга добавлена");
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editing.name.trim()) return notify("Введите название услуги", true);
    await run(async () => {
      replace(await updateService(editing.id, { name: editing.name, category: editing.category.trim() || null, duration_minutes: editing.duration }));
      setEditing(null);
    }, "Сохранено");
  }

  async function hide(s: CatalogService) {
    if (!window.confirm(`Скрыть «${s.name}»? В истории записей она сохранится.`)) return;
    await run(async () => {
      await hideService(s.id);
      replace({ ...s, is_active: false });
    });
  }

  async function restore(s: CatalogService) {
    await run(async () => {
      replace(await updateService(s.id, { name: s.name, category: s.category, duration_minutes: s.duration_minutes, is_active: true }));
    }, "Услуга возвращена");
  }

  if (!items) return <div className="p-6 text-sm text-gray-500">Загрузка…</div>;

  return (
    <div className="-m-6 md:-m-10 p-3 md:p-10 min-h-[100dvh] md:min-h-[calc(100dvh-2rem)] md:rounded-[12px] bg-[#e8eaf0] space-y-4">
      <div>
        <h1 className="hidden md:block text-lg font-bold text-gray-900">Услуги и нормативы</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Норматив — сколько времени занимает услуга. Эти услуги подсказываются при записи и у менеджера, и у клиента.
        </p>
      </div>

      <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Новая услуга</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem_10rem]">
          <input className={inputCls} placeholder="Название, например: Замена масла" value={draft.name} maxLength={150} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <CategoryInput value={draft.category} categories={categories} onChange={(v) => setDraft({ ...draft, category: v })} />
          <HoursStepper value={draft.duration} onChange={(v) => setDraft({ ...draft, duration: v })} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {CHIPS.map((m) => (
            <button key={m} type="button" onClick={() => setDraft({ ...draft, duration: m })} className={`${ghostBtn} ${draft.duration === m ? "!border-brand-blue !text-brand-blue" : ""}`}>
              {formatDuration(m)}
            </button>
          ))}
          <button type="button" className={`${primaryBtn} ml-auto`} disabled={busy} onClick={add}>
            <Icon name="plus" />
            Добавить
          </button>
        </div>
      </section>

      <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-sm font-semibold text-gray-900">Каталог</h2>
          <div className="relative ml-auto w-full max-w-xs">
            <input className={`${inputCls} pl-9`} placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>
        </div>

        {groups.length === 0 && <p className="text-sm text-gray-400 py-4">{query ? "Ничего не найдено." : "Пока нет услуг — добавьте первую выше."}</p>}

        {groups.map(([category, list]) => (
          <div key={category} className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">{category}</div>
            <ul>
              {list.map((s) => (
                <li key={s.id} className="border-b border-gray-100 last:border-0 py-2">
                  {editing?.id === s.id ? (
                    <div className="grid gap-2 sm:grid-cols-[1fr_12rem_10rem_auto] items-center">
                      <input className={inputCls} value={editing.name} maxLength={150} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                      <CategoryInput value={editing.category} categories={categories} onChange={(v) => setEditing({ ...editing, category: v })} />
                      <HoursStepper value={editing.duration} onChange={(v) => setEditing({ ...editing, duration: v })} />
                      <div className="flex gap-2">
                        <button type="button" className={primaryBtn} disabled={busy} onClick={saveEdit}>
                          Сохранить
                        </button>
                        <button type="button" className={ghostBtn} onClick={() => setEditing(null)}>
                          Отмена
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="flex-1 min-w-0 text-sm text-gray-900 truncate">{s.name}</span>
                      <span className="rounded-full bg-brand-blue/10 text-brand-blue-dark text-xs font-medium px-2.5 py-1 whitespace-nowrap">{formatDuration(s.duration_minutes)}</span>
                      <button type="button" className={ghostBtn} aria-label="Изменить" onClick={() => setEditing({ id: s.id, name: s.name, category: s.category ?? "", duration: s.duration_minutes })}>
                        <Icon name="edit" />
                      </button>
                      <button type="button" className={`${ghostBtn} hover:text-red-600`} aria-label="Скрыть" disabled={busy} onClick={() => hide(s)}>
                        <Icon name="trash" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}

        {hidden.length > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-100">
            <button type="button" className="text-xs text-gray-500 hover:text-gray-800" onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? "Скрыть список" : `Скрытые услуги (${hidden.length})`}
            </button>
            {showHidden && (
              <ul className="mt-2">
                {hidden.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-1.5 text-sm text-gray-400">
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="text-xs">{formatDuration(s.duration_minutes)}</span>
                    <button type="button" className={ghostBtn} disabled={busy} onClick={() => restore(s)}>
                      Вернуть
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {toast && (
        <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${toast.error ? "bg-red-600 text-white" : "bg-gray-900 text-white"}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
