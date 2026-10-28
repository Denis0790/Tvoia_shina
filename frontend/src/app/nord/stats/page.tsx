"use client";

import { useEffect, useState } from "react";
import { getStats, Stats } from "@/lib/api";

type Period = "all" | "month" | "3months" | "custom";
type Gran = "day" | "week" | "month";

const PERIODS: { id: Period; label: string }[] = [
  { id: "all", label: "Всё время" },
  { id: "month", label: "Этот месяц" },
  { id: "3months", label: "3 месяца" },
  { id: "custom", label: "Свой период" },
];

const card = "bg-white rounded-2xl border border-gray-100 shadow-sm p-4 md:p-5";
const field = "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-blue";

const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
const dayYearFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("ru-RU", { month: "short", year: "numeric", timeZone: "UTC" });

function label(iso: string, gran: Gran) {
  const d = new Date(iso + "T00:00:00Z");
  if (gran === "month") return monthFmt.format(d);
  return (gran === "week" ? "нед. с " : "") + dayFmt.format(d);
}

const num = (n: number) => String(n).replace(".", ",");
const pct = (n: number | null) => (n === null ? "—" : `${num(n)}%`);
const hrs = (n: number) => `${num(n)} ч`;

function Tile({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className={card}>
      <div className="text-xs text-gray-500">{title}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-400">{hint}</div>}
    </div>
  );
}

function Bars({ points, gran }: { points: Stats["series"]["points"]; gran: Gran }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <div>
      <div className="flex items-end gap-[2px] h-40">
        {points.map((p) => (
          <div key={p.label} className="flex-1 min-w-[3px] h-full flex items-end" title={`${label(p.label, gran)}: записей ${p.count}, ${hrs(p.hours)}`}>
            <div
              className="w-full rounded-t bg-brand-blue/80 hover:bg-brand-blue transition-colors"
              style={{ height: p.count ? `${Math.max(4, (p.count / max) * 100)}%` : "0%" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-gray-400">
        <span>{label(points[0].label, gran)}</span>
        <span>{label(points[points.length - 1].label, gran)}</span>
      </div>
    </div>
  );
}

function byCategory(list: Stats["services"]): Stats["services"] {
  const m = new Map<string, Stats["services"][number]>();
  for (const x of list) {
    const name = x.category || "Без категории";
    const e = m.get(name) ?? { id: name, name, category: null, count: 0, hours: 0, share: 0 };
    e.count += x.count;
    e.hours = Math.round((e.hours + x.hours) * 10) / 10;
    e.share = Math.round((e.share + x.share) * 10) / 10;
    m.set(name, e);
  }
  return Array.from(m.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"));
}

const TOP = 10;

export default function StatsPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [postId, setPostId] = useState("");
  const [data, setData] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [svcView, setSvcView] = useState<"services" | "categories">("services");
  const [svcAll, setSvcAll] = useState(false);
  const [svcQ, setSvcQ] = useState("");
  const [otherAll, setOtherAll] = useState(false);

  const ready = period !== "custom" || (!!from && !!to && from <= to);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getStats({ period, from, to, post_id: postId || undefined }).then((r) => {
      if (cancelled) return;
      if (r.ok) setData(r.data);
      else setError(r.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [period, from, to, postId, ready]);

  const posts = data?.posts ?? [];
  const scopeName = postId ? posts.find((p) => p.id === postId)?.name ?? "Пост" : "Все посты";
  const o = data?.overview;
  const empty = !!o && o.confirmed + o.pending + o.cancelled === 0;
  const range = data ? `${dayYearFmt.format(new Date(data.range.from + "T00:00:00Z"))} — ${dayYearFmt.format(new Date(data.range.to + "T00:00:00Z"))}` : "";

  const svcRows = data ? (svcView === "services" ? data.services : byCategory(data.services)) : [];
  const svcQn = svcQ.trim().toLowerCase();
  const svcFiltered = svcQn ? svcRows.filter((x) => x.name.toLowerCase().includes(svcQn)) : svcRows;
  const svcShown = svcAll || svcQn ? svcFiltered : svcFiltered.slice(0, TOP);

  return (
    <div className="-m-6 md:-m-10 p-6 md:p-10 md:rounded-[12px] bg-[#e8eaf0] min-h-[100dvh] md:min-h-[calc(100dvh-2rem)] flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Статистика</h1>
        <p className="text-xs text-gray-500 mt-0.5">{range || "Посты и услуги за период"}</p>
      </div>

      <div className={`${card} flex flex-wrap items-center gap-3`}>
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm transition ${
                period === p.id ? "bg-brand-yellow text-brand-blue-dark font-medium" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={field} />
            —
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={field} />
          </div>
        )}
        <select value={postId} onChange={(e) => setPostId(e.target.value)} className={`${field} md:ml-auto`}>
          <option value="">Все посты</option>
          {posts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {period === "custom" && !ready && <p className="text-sm text-gray-500">Выберите даты «с» и «по».</p>}
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>}
      {loading && !data && ready && <p className="text-sm text-gray-400">Загрузка…</p>}

      {data && o && (
        <div className={`flex flex-col gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {empty ? (
            <div className={`${card} text-center text-sm text-gray-500 py-10`}>За выбранный период записей нет</div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Tile title="Записей" value={String(o.confirmed)} hint="подтверждённых" />
                <Tile title="Часов работы" value={hrs(o.hours)} />
                <Tile title="Загрузка" value={pct(o.load)} hint="от рабочего времени" />
                <Tile title="Отмены" value={String(o.cancelled)} hint={o.cancel_rate === null ? undefined : `${pct(o.cancel_rate)} от всех записей`} />
                <Tile title="Ожидают" value={String(o.pending)} hint="не подтверждены" />
                <Tile title="Новых клиентов" value={String(o.new_clients)} />
              </div>

              <div className={card}>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-sm font-semibold text-gray-900">Записи по {data.series.granularity === "day" ? "дням" : data.series.granularity === "week" ? "неделям" : "месяцам"}</h2>
                  <span className="text-xs text-gray-400">{scopeName}</span>
                </div>
                <Bars points={data.series.points} gran={data.series.granularity} />
              </div>
            </>
          )}

          <div className={card}>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Посты</h2>
            {posts.length === 0 && <p className="text-sm text-gray-500">Постов пока нет</p>}
            <div className="flex flex-col gap-2">
              {posts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPostId(p.id === postId ? "" : p.id)}
                  className={`text-left rounded-xl border px-4 py-3 transition ${
                    p.id === postId ? "border-brand-blue bg-brand-blue/5" : "border-gray-100 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <span className="font-medium text-gray-900">{p.name}</span>
                    <span className="text-xs text-gray-500">
                      записей {p.bookings} · {hrs(p.hours)} · отмен {p.cancelled}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full bg-brand-blue" style={{ width: `${p.load ?? 0}%` }} />
                    </div>
                    <span className="w-14 text-right text-xs font-medium text-gray-700">{pct(p.load)}</span>
                  </div>
                  {p.top_services.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {p.top_services.map((s) => (
                        <span key={s.name} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
                          {s.name} · {s.count}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold text-gray-900">{svcView === "services" ? "Услуги" : "Категории услуг"}</h2>
              <div className="flex items-center gap-2">
                <div className="flex rounded-full bg-gray-100 p-0.5 text-xs">
                  {(["services", "categories"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        setSvcView(v);
                        setSvcAll(false);
                        setSvcQ("");
                      }}
                      className={`rounded-full px-3 py-1 transition ${svcView === v ? "bg-white shadow-sm text-gray-900 font-medium" : "text-gray-500"}`}
                    >
                      {v === "services" ? "Услуги" : "Категории"}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-gray-400">{scopeName}</span>
              </div>
            </div>
            {svcRows.length === 0 ? (
              <p className="text-sm text-gray-500">Подтверждённых записей с услугами из справочника нет</p>
            ) : (
              <>
                {svcRows.length > TOP && (
                  <input
                    value={svcQ}
                    onChange={(e) => setSvcQ(e.target.value)}
                    placeholder={svcView === "services" ? "Найти услугу" : "Найти категорию"}
                    className={`${field} w-full mb-3`}
                  />
                )}
                {svcShown.length === 0 && <p className="text-sm text-gray-500">Ничего не найдено</p>}
                <div className="flex flex-col gap-3">
                  {svcShown.map((x) => (
                    <div key={x.id}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                        <span className="text-sm text-gray-900">
                          {x.name}
                          {svcView === "services" && x.category && <span className="ml-2 text-xs text-gray-400">{x.category}</span>}
                        </span>
                        <span className="text-xs text-gray-500">
                          {x.count} раз · {hrs(x.hours)} · {pct(x.share)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full bg-brand-blue" style={{ width: `${x.share}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                {!svcQn && svcRows.length > TOP && (
                  <button type="button" onClick={() => setSvcAll((v) => !v)} className="mt-3 text-sm font-medium text-brand-blue hover:underline">
                    {svcAll ? "Свернуть" : `Показать все (${svcRows.length})`}
                  </button>
                )}
              </>
            )}
          </div>

          <div className={card}>
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="text-sm font-semibold text-gray-900">Другое</h2>
              <span className="text-xs text-gray-400">{scopeName}</span>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Услуги, которых нет в справочнике. Если что-то повторяется часто — стоит добавить в справочник.
            </p>
            {data.other.items.length === 0 ? (
              <p className="text-sm text-gray-500">Таких записей нет</p>
            ) : (
              <div className="flex flex-col divide-y divide-gray-100">
                {(otherAll ? data.other.items : data.other.items.slice(0, TOP)).map((it) => (
                  <div key={it.text} className="flex items-center justify-between gap-4 py-2 text-sm">
                    <span className="text-gray-900 break-words min-w-0">{it.text}</span>
                    <span className="rounded-full bg-brand-yellow/30 px-2.5 py-0.5 text-xs font-medium text-brand-blue-dark flex-shrink-0">{it.count}</span>
                  </div>
                ))}
              </div>
            )}
            {data.other.items.length > TOP && (
              <button type="button" onClick={() => setOtherAll((v) => !v)} className="mt-2 text-sm font-medium text-brand-blue hover:underline">
                {otherAll ? "Свернуть" : `Показать все (${data.other.items.length})`}
              </button>
            )}
            <p className="mt-3 text-xs text-gray-400">Записей вообще без услуг: {data.other.no_services}</p>
          </div>
        </div>
      )}
    </div>
  );
}
