"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getPosts,
  createPost,
  updatePost,
  deletePost,
  getScheduleExceptions,
  setScheduleExceptionRange,
  deleteScheduleExceptionPeriod,
  type PostInfo,
  type ScheduleException,
  type ExceptionKind,
} from "@/lib/api";

const DAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const KINDS: { key: ExceptionKind; label: string; icon: string; chip: string }[] = [
  { key: "vacation", label: "Отпуск", icon: "/icons/vacation.svg", chip: "bg-brand-yellow/25 text-brand-blue-dark" },
  { key: "sick", label: "Больничный", icon: "/icons/sick.svg", chip: "bg-red-50 text-red-600" },
];

function kindMeta(kind: ExceptionKind) {
  return (
    KINDS.find((k) => k.key === kind) ?? {
      key: kind,
      label: "Выходной",
      icon: "/icons/other.svg",
      chip: "bg-gray-100 text-gray-700",
    }
  );
}

// Иконка из /public/icons: рисуется маской, поэтому берёт цвет текста
function Icon({ src, className = "" }: { src: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
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

function daysStringToArray(s: string): boolean[] {
  return s.split("").map((c) => c === "1");
}

function daysArrayToString(a: boolean[]): string {
  return a.map((v) => (v ? "1" : "0")).join("");
}

function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toDate(s: string) {
  return new Date(`${s}T12:00:00`);
}

function formatRange(from: string, to: string) {
  const a = toDate(from);
  const b = toDate(to);
  const yearNow = new Date().getFullYear();
  const withYear = (d: Date) => (d.getFullYear() !== yearNow ? ` ${d.getFullYear()}` : "");
  const dm = (d: Date) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  if (from === to) return `${dm(a)}${withYear(a)}`;
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()}–${dm(b)}${withYear(b)}`;
  }
  return `${dm(a)}${withYear(a)} – ${dm(b)}${withYear(b)}`;
}

type Period = { from: string; to: string; days: number; item: ScheduleException };

// Подряд идущие дни с одинаковыми параметрами склеиваем в один период
function groupExceptions(list: ScheduleException[]): Period[] {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  const out: Period[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    const same =
      last &&
      last.item.is_working === e.is_working &&
      last.item.kind === e.kind &&
      (last.item.note || "") === (e.note || "") &&
      last.item.work_start === e.work_start &&
      last.item.work_end === e.work_end;
    const consecutive =
      last && Math.round((toDate(e.date).getTime() - toDate(last.to).getTime()) / 86400000) === 1;
    if (last && same && consecutive) {
      last.to = e.date;
      last.days += 1;
    } else {
      out.push({ from: e.date, to: e.date, days: 1, item: e });
    }
  }
  return out;
}

function WorkDaysEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const days = daysStringToArray(value);
  return (
    <div className="flex gap-1.5">
      {DAY_LABELS.map((label, i) => (
        <button
          key={i}
          type="button"
          onClick={() => {
            const next = [...days];
            next[i] = !next[i];
            onChange(daysArrayToString(next));
          }}
          className={`w-9 h-9 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            days[i]
              ? "bg-brand-blue text-white hover:bg-brand-blue/90"
              : "bg-gray-100 text-gray-400 hover:bg-gray-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const inputCls =
  "border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-brand-blue transition-colors";

function AbsencesPanel({
  post,
  periods,
  onChanged,
}: {
  post: PostInfo;
  periods: Period[];
  onChanged: () => void;
}) {
  const [kind, setKind] = useState<ExceptionKind>("vacation");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [special, setSpecial] = useState(false);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  const [warning, setWarning] = useState<string | null>(null);

  const todayISO = toISO(new Date());
  const upcoming = periods.filter((p) => p.to >= todayISO);
  const invalid = !from || (!!to && to < from);

  async function handleAdd() {
    if (invalid) return;
    const res = await setScheduleExceptionRange(post.id, {
      date_from: from,
      date_to: to || from,
      is_working: special,
      work_start: special ? start : null,
      work_end: special ? end : null,
      kind: special ? "other" : kind,
      note: note.trim() || null,
    });
    if (!res) {
      alert("Не удалось сохранить период");
      return;
    }
    setWarning(
      res.conflicts > 0 ? `На этот период уже есть записей: ${res.conflicts} — перенесите их в календаре` : null
    );
    setFrom("");
    setTo("");
    setNote("");
    onChanged();
  }

  async function handleDelete(p: Period) {
    const ok = await deleteScheduleExceptionPeriod(post.id, p.from, p.to);
    if (ok) onChanged();
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      {upcoming.length === 0 ? (
        <p className="text-sm text-gray-400 mb-4">Отсутствий не запланировано</p>
      ) : (
        <div className="flex flex-col gap-2 mb-4">
          {upcoming.map((p) => {
            const meta = p.item.is_working
              ? { label: "Особые часы", icon: "/icons/clock.svg", chip: "bg-brand-blue/10 text-brand-blue-dark" }
              : kindMeta(p.item.kind);
            return (
              <div key={`${p.from}-${p.to}`} className="flex items-center gap-3 rounded-xl bg-gray-50 px-3 py-2.5">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${meta.chip}`}>
                  <Icon src={meta.icon} className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">
                    <span className="font-medium">{meta.label}</span> · {formatRange(p.from, p.to)}
                    {p.item.is_working ? ` · ${p.item.work_start}–${p.item.work_end}` : ` · ${p.days} дн.`}
                  </p>
                  {p.item.note && <p className="text-xs text-gray-400 truncate">{p.item.note}</p>}
                </div>
                <button
                  onClick={() => handleDelete(p)}
                  title="Удалить период"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors cursor-pointer"
                >
                  <Icon src="/icons/trash.svg" className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {warning && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">{warning}</p>
      )}

      <div className="rounded-xl border border-gray-100 p-3">
        {!special && (
          <div className="flex flex-wrap gap-2 mb-3">
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => setKind(k.key)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  kind === k.key
                    ? "border-brand-blue bg-brand-blue/10 text-brand-blue-dark"
                    : "border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}
              >
                <Icon src={k.icon} className="w-4 h-4" />
                {k.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs text-gray-500">С</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          <span className="text-xs text-gray-500">по</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className={inputCls}
          />
          <span className="text-[11px] text-gray-400">«по» можно не заполнять — это один день</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Заметка для себя (необязательно)"
            className={`${inputCls} flex-1 min-w-[200px]`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={special} onChange={(e) => setSpecial(e.target.checked)} />
            Рабочий день с особыми часами
          </label>
          {special && (
            <>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
              <span className="text-xs text-gray-400">—</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
            </>
          )}
          <button
            onClick={handleAdd}
            disabled={invalid}
            className="ml-auto text-xs bg-brand-blue text-white font-medium rounded-lg px-4 py-2 hover:bg-brand-blue/90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            Добавить
          </button>
        </div>
      </div>
    </div>
  );
}

function PostCard({
  post,
  onUpdated,
  onDeleted,
}: {
  post: PostInfo;
  onUpdated: (p: PostInfo) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PostInfo>(post);
  const [open, setOpen] = useState(false);
  const [exceptions, setExceptions] = useState<ScheduleException[]>([]);

  function loadExceptions() {
    getScheduleExceptions(post.id).then(setExceptions);
  }

  useEffect(() => {
    loadExceptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  const periods = useMemo(() => groupExceptions(exceptions), [exceptions]);
  const todayISO = toISO(new Date());
  const upcomingCount = periods.filter((p) => p.to >= todayISO).length;
  const current = periods.find((p) => !p.item.is_working && p.from <= todayISO && todayISO <= p.to);

  async function saveEdit() {
    const updated = await updatePost(post.id, {
      name: draft.name,
      work_start: draft.work_start,
      work_end: draft.work_end,
      work_days: draft.work_days,
    });
    if (updated) {
      onUpdated(updated);
      setEditing(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Удалить мастера? Это нельзя отменить.")) return;
    const ok = await deletePost(post.id);
    if (ok) onDeleted(post.id);
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-brand-blue/10 text-brand-blue flex items-center justify-center shrink-0">
          <Icon src="/icons/master.svg" className="w-6 h-6" />
        </div>

        {editing ? (
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className={inputCls}
              />
              <input
                type="time"
                value={draft.work_start}
                onChange={(e) => setDraft({ ...draft, work_start: e.target.value })}
                className={inputCls}
              />
              <span className="text-xs text-gray-400">—</span>
              <input
                type="time"
                value={draft.work_end}
                onChange={(e) => setDraft({ ...draft, work_end: e.target.value })}
                className={inputCls}
              />
            </div>
            <div className="mb-3">
              <WorkDaysEditor value={draft.work_days} onChange={(v) => setDraft({ ...draft, work_days: v })} />
            </div>
            <div className="flex gap-2">
              <button
                onClick={saveEdit}
                className="text-xs bg-brand-blue text-white font-medium rounded-lg px-4 py-2 hover:bg-brand-blue/90 active:scale-[0.98] transition cursor-pointer"
              >
                Сохранить
              </button>
              <button
                onClick={() => setEditing(false)}
                className="text-xs text-gray-500 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-gray-900">{post.name}</p>
                {current && (
                  <span className="text-[11px] font-medium bg-amber-50 text-amber-700 rounded-full px-2.5 py-0.5">
                    {kindMeta(current.item.kind).label} до {formatRange(current.to, current.to)}
                  </span>
                )}
              </div>
              <p className="flex items-center gap-1.5 text-xs text-gray-500 mt-1">
                <Icon src="/icons/clock.svg" className="w-3.5 h-3.5" />
                {post.work_start}–{post.work_end}
              </p>
              <div className="flex gap-1 mt-2.5">
                {DAY_LABELS.map((label, i) => (
                  <span
                    key={i}
                    className={`text-[10px] w-7 h-7 rounded-md flex items-center justify-center font-medium ${
                      post.work_days[i] === "1" ? "bg-brand-blue/10 text-brand-blue-dark" : "bg-gray-100 text-gray-300"
                    }`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => {
                  setDraft(post);
                  setEditing(true);
                }}
                title="Изменить"
                className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:bg-brand-blue/10 hover:text-brand-blue transition-colors cursor-pointer"
              >
                <Icon src="/icons/edit.svg" className="w-[18px] h-[18px]" />
              </button>
              <button
                onClick={handleDelete}
                title="Удалить мастера"
                className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors cursor-pointer"
              >
                <Icon src="/icons/trash.svg" className="w-[18px] h-[18px]" />
              </button>
            </div>
          </>
        )}
      </div>

      {!editing && (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-4 flex items-center gap-1.5 text-xs font-medium text-brand-blue hover:text-brand-blue-dark transition-colors cursor-pointer"
          >
            Отсутствия и особые дни
            {upcomingCount > 0 && (
              <span className="bg-brand-blue/10 text-brand-blue-dark rounded-full px-1.5 py-0.5 text-[10px]">
                {upcomingCount}
              </span>
            )}
            <Icon src="/icons/chevron-down.svg" className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && <AbsencesPanel post={post} periods={periods} onChanged={loadExceptions} />}
        </>
      )}
    </div>
  );
}

export default function PostsPage() {
  const [posts, setPosts] = useState<PostInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("18:00");
  const [newDays, setNewDays] = useState("1111100");

  useEffect(() => {
    getPosts()
      .then(setPosts)
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    const created = await createPost({
      name: newName.trim(),
      work_start: newStart,
      work_end: newEnd,
      work_days: newDays,
    });
    if (created) {
      setPosts((prev) => [...prev, created]);
      setNewName("");
      setNewStart("09:00");
      setNewEnd("18:00");
      setNewDays("1111100");
      setShowNewForm(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-400">Загрузка…</p>;

  return (
    <div className="-m-6 md:-m-10 p-3 md:p-10 md:rounded-[12px] bg-[#e8eaf0] min-h-[100dvh] md:min-h-[calc(100dvh-2rem)]">
      <div className="flex items-center justify-between mb-6">
        <h1 className="hidden md:block text-xl font-semibold text-gray-900">Посты</h1>
        <button
          onClick={() => setShowNewForm((v) => !v)}
          className="flex items-center gap-1.5 text-xs bg-brand-yellow text-brand-blue-dark font-medium rounded-lg px-3.5 py-2 hover:brightness-95 active:scale-[0.98] transition cursor-pointer"
        >
          {!showNewForm && <Icon src="/icons/plus.svg" className="w-4 h-4" />}
          {showNewForm ? "Отмена" : "Добавить мастера"}
        </button>
      </div>

      {showNewForm && (
        <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
          <p className="text-sm font-medium text-gray-800 mb-3">Новый мастер</p>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Имя мастера"
              className={inputCls}
            />
            <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} className={inputCls} />
            <span className="text-xs text-gray-400">—</span>
            <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} className={inputCls} />
          </div>
          <div className="mb-4">
            <WorkDaysEditor value={newDays} onChange={setNewDays} />
          </div>
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="text-xs bg-brand-blue disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-lg px-4 py-2 hover:bg-brand-blue/90 active:scale-[0.98] transition cursor-pointer"
          >
            Создать
          </button>
        </div>
      )}

      {posts.length === 0 && !showNewForm && <p className="text-sm text-gray-400">Мастеров пока нет</p>}

      <div className="flex flex-col gap-3">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onUpdated={(u) => setPosts((prev) => prev.map((p) => (p.id === u.id ? u : p)))}
            onDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
          />
        ))}
      </div>
    </div>
  );
}
