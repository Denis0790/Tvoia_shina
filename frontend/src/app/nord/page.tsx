"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getProfile, updateProfile, uploadProfileImage, deleteProfileImage, addProfilePhoto, deleteProfilePhoto,
  createNews, updateNews, uploadNewsImage, deleteNews, imageUrl,
  type ProfileData, type ServiceProfile, type NewsItem,
} from "@/lib/api";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

function checkImage(file: File): string | null {
  if (!ALLOWED.includes(file.type)) return "Нужна картинка JPG, PNG или WebP";
  if (file.size > MAX_BYTES) return "Файл больше 5 МБ";
  return null;
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

type Form = {
  name: string; tagline: string; description: string; phone: string; max_link: string;
  address: string; work_hours: string; lat: string; lng: string;
};

function toForm(p: ServiceProfile): Form {
  return {
    name: p.name, tagline: p.tagline ?? "", description: p.description ?? "", phone: p.phone ?? "", max_link: p.max_link ?? "",
    address: p.address ?? "", work_hours: p.work_hours ?? "",
    lat: p.lat == null ? "" : String(p.lat), lng: p.lng == null ? "" : String(p.lng),
  };
}

function parseCoord(v: string): number | null {
  const t = v.trim().replace(",", ".");
  return t === "" ? null : Number(t);
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20";
const primaryBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-yellow px-4 py-2 text-sm font-semibold text-brand-blue-dark hover:brightness-95 disabled:opacity-50 transition";
const ghostBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer";

function Card({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

export default function NordHomePage() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [newsTitle, setNewsTitle] = useState("");
  const [newsBody, setNewsBody] = useState("");
  const [newsFile, setNewsFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string; body: string } | null>(null);

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await getProfile();
      setData(d);
      const f = toForm(d.profile);
      setForm(f);
      setSaved(f);
    } catch {
      notify("Не удалось загрузить профиль", true);
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

  function pickImage(e: React.ChangeEvent<HTMLInputElement>): File | null {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return null;
    const err = checkImage(file);
    if (err) {
      notify(err, true);
      return null;
    }
    return file;
  }

  function setProfile(p: ServiceProfile) {
    setData((d) => (d ? { ...d, profile: p } : d));
  }

  async function save() {
    if (!form) return;
    const lat = parseCoord(form.lat);
    const lng = parseCoord(form.lng);
    if ((lat !== null && Number.isNaN(lat)) || (lng !== null && Number.isNaN(lng))) {
      notify("Координаты — числа, например 55.7558 и 37.6173", true);
      return;
    }
    await run(async () => {
      const p = await updateProfile({
        name: form.name, tagline: form.tagline, description: form.description, phone: form.phone, max_link: form.max_link,
        address: form.address, work_hours: form.work_hours, lat, lng,
      });
      setProfile(p);
      const f = toForm(p);
      setForm(f);
      setSaved(f);
    }, "Сохранено");
  }

  async function onLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = pickImage(e);
    if (!file) return;
    await run(async () => setProfile(await uploadProfileImage("logo", file)), "Логотип загружен");
  }

  async function onLogoDelete() {
    await run(async () => setProfile(await deleteProfileImage("logo")));
  }

  async function onGalleryUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    await run(async () => {
      let added = 0;
      for (const file of files) {
        const err = checkImage(file);
        if (err) {
          notify(`${file.name}: ${err}`, true);
          continue;
        }
        const photo = await addProfilePhoto(file);
        setData((d) => (d ? { ...d, photos: [...d.photos, photo] } : d));
        added += 1;
      }
      if (added > 0) notify(added === 1 ? "Фото добавлено" : `Добавлено фото: ${added}`);
    });
  }

  async function onPhotoDelete(id: string) {
    if (!window.confirm("Удалить фото из карусели?")) return;
    await run(async () => {
      await deleteProfilePhoto(id);
      setData((d) => (d ? { ...d, photos: d.photos.filter((p) => p.id !== id) } : d));
    });
  }

  async function publish() {
    if (!newsTitle.trim()) {
      notify("Введите заголовок новости", true);
      return;
    }
    await run(async () => {
      let item = await createNews(newsTitle, newsBody);
      if (newsFile) item = await uploadNewsImage(item.id, newsFile);
      setData((d) => (d ? { ...d, news: [item, ...d.news] } : d));
      setNewsTitle("");
      setNewsBody("");
      setNewsFile(null);
    }, "Новость опубликована");
  }

  function replaceNews(item: NewsItem) {
    setData((d) => (d ? { ...d, news: d.news.map((n) => (n.id === item.id ? item : n)) } : d));
  }

  async function saveNews() {
    if (!editing) return;
    await run(async () => {
      replaceNews(await updateNews(editing.id, editing.title, editing.body));
      setEditing(null);
    }, "Новость обновлена");
  }

  async function onNewsImage(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = pickImage(e);
    if (!file) return;
    await run(async () => replaceNews(await uploadNewsImage(id, file)), "Фото загружено");
  }

  async function onNewsDelete(id: string) {
    if (!window.confirm("Удалить новость?")) return;
    await run(async () => {
      await deleteNews(id);
      setData((d) => (d ? { ...d, news: d.news.filter((n) => n.id !== id) } : d));
    });
  }

  if (!data || !form) {
    return <div className="p-6 text-sm text-gray-500">Загрузка…</div>;
  }

  const { profile, photos, news } = data;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const lat = parseCoord(form.lat);
  const lng = parseCoord(form.lng);
  const mapLink =
    lat !== null && lng !== null && !Number.isNaN(lat) && !Number.isNaN(lng)
      ? `https://yandex.ru/maps/?pt=${lng},${lat}&z=16&l=map`
      : null;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  return (
    <div className="-m-6 md:-m-10 p-6 md:p-10 md:rounded-[12px] bg-[#e8eaf0] min-h-[100dvh] md:min-h-[calc(100dvh-2rem)] space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Главная</h1>
          <p className="text-xs text-gray-500 mt-0.5">Так ваш сервис увидят клиенты. Блоки идут в том же порядке, что и на странице.</p>
        </div>
        <a href="/" target="_blank" rel="noreferrer" className={`${ghostBtn} whitespace-nowrap`}>
          Как у клиента
        </a>
      </div>

      {/* 1. Карусель */}
      <Card
        title="Фото на главной"
        hint="Клиент листает их каруселью сразу при входе. Первое фото самое заметное: поставьте лучшее. До 24 фото, JPG/PNG/WebP до 5 МБ."
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((ph, i) => (
            <div key={ph.id} className="relative aspect-[4/3] rounded-xl overflow-hidden bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(ph.url) ?? ""} alt="" className="w-full h-full object-cover" />
              <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 text-white text-[11px] font-medium px-2 py-0.5">
                {i === 0 ? "Первое" : i + 1}
              </span>
              <button
                type="button"
                aria-label="Удалить фото"
                disabled={busy}
                onClick={() => onPhotoDelete(ph.id)}
                className="absolute right-1.5 top-1.5 w-7 h-7 rounded-full bg-white/90 text-gray-700 hover:text-red-600 flex items-center justify-center shadow"
              >
                <Icon name="trash" className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <label className="aspect-[4/3] rounded-xl border-2 border-dashed border-brand-blue/30 text-brand-blue flex flex-col items-center justify-center gap-1 text-xs font-medium cursor-pointer hover:bg-brand-blue/5 transition-colors">
            <Icon name="plus" className="w-5 h-5" />
            Добавить фото
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy} onChange={onGalleryUpload} />
          </label>
        </div>
      </Card>

      {/* 2. Визитка */}
      <Card title="Название и логотип">
        <div className="flex flex-col sm:flex-row gap-5">
          <div className="flex sm:flex-col items-center gap-3 flex-shrink-0">
            <div className="w-20 h-20 rounded-full bg-brand-blue/10 overflow-hidden flex items-center justify-center text-brand-blue border border-gray-100">
              {profile.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl(profile.logo_url) ?? ""} alt="" className="w-full h-full object-cover" />
              ) : (
                <Icon name="home" className="w-8 h-8" />
              )}
            </div>
            <div className="flex sm:flex-col items-center gap-2">
              <label className={ghostBtn}>
                <Icon name="edit" />
                {profile.logo_url ? "Сменить" : "Загрузить"}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy} onChange={onLogoUpload} />
              </label>
              {profile.logo_url && (
                <button type="button" className="text-xs text-gray-500 hover:text-red-600" disabled={busy} onClick={onLogoDelete}>
                  Убрать
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 grid gap-3">
            <Field label="Название">
              <input className={inputCls} value={form.name} onChange={set("name")} maxLength={120} />
            </Field>
            <Field label="Короткий слоган">
              <input className={inputCls} value={form.tagline} onChange={set("tagline")} maxLength={200} placeholder="Например: шиномонтаж и ТО без очередей" />
            </Field>
          </div>
        </div>
      </Card>

      {/* 3. О сервисе */}
      <Card title="О сервисе" hint="Чем занимаетесь, чем гордитесь, что важно знать клиенту.">
        <textarea className={`${inputCls} min-h-32`} value={form.description} onChange={set("description")} maxLength={3000} />
        <p className="text-right text-[11px] text-gray-400 mt-1">{form.description.length} / 3000</p>
      </Card>

      {/* 4. Контакты */}
      <Card title="Контакты и карта">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Телефон">
            <input className={inputCls} value={form.phone} onChange={set("phone")} maxLength={40} placeholder="+7 900 000-00-00" />
          </Field>
          <Field label="Ссылка на Max">
            <input className={inputCls} value={form.max_link} onChange={set("max_link")} maxLength={300} placeholder="https://max.ru/..." />
          </Field>
          <Field label="Часы работы">
            <input className={inputCls} value={form.work_hours} onChange={set("work_hours")} maxLength={200} placeholder="Пн–Сб 9:00–19:00" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Адрес">
              <input className={inputCls} value={form.address} onChange={set("address")} maxLength={200} placeholder="Город, улица, дом" />
            </Field>
          </div>
          <Field label="Широта (для карты)">
            <input className={inputCls} value={form.lat} onChange={set("lat")} inputMode="decimal" placeholder="55.7558" />
          </Field>
          <Field label="Долгота (для карты)">
            <input className={inputCls} value={form.lng} onChange={set("lng")} inputMode="decimal" placeholder="37.6173" />
          </Field>
        </div>
        {mapLink && (
          <a href={mapLink} target="_blank" rel="noreferrer" className="inline-block mt-3 text-sm text-brand-blue hover:underline">
            Проверить точку на карте
          </a>
        )}
      </Card>

      {/* 5. Новости */}
      <Card title="Новости и акции" hint="Короткие объявления: акции, режим работы в праздники, новое оборудование.">
        <div className="rounded-xl bg-gray-50 p-3 space-y-2">
          <input className={inputCls} value={newsTitle} onChange={(e) => setNewsTitle(e.target.value)} maxLength={200} placeholder="Заголовок" />
          <textarea className={`${inputCls} min-h-20`} value={newsBody} onChange={(e) => setNewsBody(e.target.value)} maxLength={5000} placeholder="Текст (по желанию)" />
          <div className="flex flex-wrap items-center gap-2">
            <label className={ghostBtn}>
              <Icon name="plus" />
              {newsFile ? newsFile.name : "Фото"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = pickImage(e);
                  if (f) setNewsFile(f);
                }}
              />
            </label>
            {newsFile && (
              <button type="button" className="text-xs text-gray-500 hover:text-red-600" onClick={() => setNewsFile(null)}>
                Убрать фото
              </button>
            )}
            <button type="button" className={`${primaryBtn} ml-auto`} disabled={busy} onClick={publish}>
              Опубликовать
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {news.length === 0 && <p className="text-sm text-gray-400">Пока нет новостей.</p>}
          {news.map((n) => (
            <article key={n.id} className="rounded-xl border border-gray-100 p-3 flex gap-3">
              {n.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl(n.image_url) ?? ""} alt="" className="w-24 h-24 rounded-lg object-cover flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                {editing?.id === n.id ? (
                  <div className="space-y-2">
                    <input className={inputCls} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} maxLength={200} />
                    <textarea className={`${inputCls} min-h-20`} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} maxLength={5000} />
                    <div className="flex gap-2">
                      <button type="button" className={primaryBtn} disabled={busy} onClick={saveNews}>
                        Сохранить
                      </button>
                      <button type="button" className={ghostBtn} onClick={() => setEditing(null)}>
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="text-sm font-semibold text-gray-900">{n.title}</div>
                    <div className="text-xs text-gray-400 mb-1">{formatDate(n.created_at)}</div>
                    {n.body && <p className="text-sm text-gray-700 whitespace-pre-line">{n.body}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className={ghostBtn} onClick={() => setEditing({ id: n.id, title: n.title, body: n.body ?? "" })}>
                        <Icon name="edit" />
                        Изменить
                      </button>
                      <label className={ghostBtn}>
                        {n.image_url ? "Сменить фото" : "Добавить фото"}
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy} onChange={(e) => onNewsImage(n.id, e)} />
                      </label>
                      <button type="button" className={`${ghostBtn} hover:text-red-600`} disabled={busy} onClick={() => onNewsDelete(n.id)}>
                        <Icon name="trash" />
                        Удалить
                      </button>
                    </div>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </Card>

      {/* Плавающая панель сохранения текста */}
      {dirty && (
        <div className="sticky bottom-4 z-30 flex items-center justify-between gap-3 rounded-2xl bg-white border border-gray-200 shadow-lg px-4 py-3">
          <span className="text-sm text-gray-600">Есть несохранённые изменения</span>
          <div className="flex items-center gap-2">
            <button type="button" className={ghostBtn} disabled={busy} onClick={() => setForm(saved)}>
              Отменить
            </button>
            <button type="button" className={primaryBtn} disabled={busy} onClick={save}>
              <Icon name="check" />
              Сохранить
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${toast.error ? "bg-red-600 text-white" : "bg-gray-900 text-white"}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
