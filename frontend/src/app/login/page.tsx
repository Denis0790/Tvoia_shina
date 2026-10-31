"use client";

import { useState } from "react";
import { login, orgLogin, managerLogin, requestCode, verifyCode, setPassword } from "@/lib/api";
import { setAccessToken } from "@/lib/auth";
import { setManagerAccessToken } from "@/lib/managerAuth";
import AutoBackdrop from "@/components/AutoBackdrop";
import LegalFooter from "@/components/LegalFooter";

type Screen = "login" | "code" | "newPassword";

const inputCls =
  "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 transition";
const yellowBtn =
  "w-full bg-brand-yellow text-brand-blue-dark font-semibold text-sm rounded-xl py-3.5 hover:brightness-95 transition";

// "9161234567" -> "+7 (916) 123-45-67" (по мере набора)
function formatPhone(d: string) {
  let out = "+7 (" + d.slice(0, 3);
  if (d.length >= 3) out += ")";
  if (d.length > 3) out += " " + d.slice(3, 6);
  if (d.length > 6) out += "-" + d.slice(6, 8);
  if (d.length > 8) out += "-" + d.slice(8, 10);
  return out;
}

function Consent({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="text-left text-xs text-gray-500 mb-4">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 w-4 h-4 shrink-0 accent-[#02167f]"
        />
        <span>
          Даю{" "}
          <a href="/consent" target="_blank" rel="noreferrer" className="text-brand-blue underline">
            согласие на обработку персональных данных
          </a>
        </span>
      </label>
      <p className="mt-1.5 pl-6">
        Подробнее о том, как мы храним данные, — в{" "}
        <a href="/privacy" target="_blank" rel="noreferrer" className="text-brand-blue underline">
          политике обработки персональных данных
        </a>
        .
      </p>
    </div>
  );
}

export default function LoginPage() {
  const [screen, setScreen] = useState<Screen>("login");

  // единое поле: с «@» — почта клиента, иначе логин организации или менеджера
  const [ident, setIdent] = useState("");
  const [password, setPassword_] = useState("");

  const [code, setCode] = useState("");
  const [debugCode, setDebugCode] = useState("");
  const [ticket, setTicket] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [needPhone, setNeedPhone] = useState(false);

  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agree, setAgree] = useState(false);

  const isEmail = ident.includes("@");
  const email = ident.trim().toLowerCase();
  const phoneDisplay = phoneDigits ? formatPhone(phoneDigits) : "";

  function onIdentChange(raw: string) {
    setError("");
    setNotFound(false);
    setIdent(raw);
  }

  function onPhoneChange(raw: string) {
    let digits = raw.replace(/\D/g, "");
    // стёрли знак маски — удаляем последнюю цифру, иначе курсор «залипает»
    if (phoneDigits && raw.length < phoneDisplay.length && digits.length === phoneDigits.length + 1) {
      digits = digits.slice(0, -1);
    }
    setPhoneDigits(digits.replace(/^[78]/, "").slice(0, 10));
  }

  async function handleLogin() {
    setError("");
    setNotFound(false);
    if (!ident.trim()) {
      setError("Введите почту или логин");
      return;
    }
    setBusy(true);
    try {
      if (isEmail) {
        const data = await login(email, password);
        setAccessToken(data.access_token);
        window.location.href = "/";
        return;
      }
      // текстовый логин: сначала организация, затем менеджер
      try {
        const data = await orgLogin(ident.trim(), password);
        setAccessToken(data.access_token);
        window.location.href = "/";
        return;
      } catch {
        let m;
        try {
          m = await managerLogin(ident.trim(), password);
        } catch {
          throw { detail: "Неверный логин или пароль" };
        }
        setManagerAccessToken(m.access_token);
        window.location.href = "/nord";
        return;
      }
    } catch (e: unknown) {
      const err = e as { status?: number; detail?: string };
      if (isEmail && err.status === 404) {
        setNotFound(true);
        setError("Аккаунт с такой почтой не найден");
      } else {
        setError(err.detail || "Неверный пароль");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSendCode() {
    setError("");
    if (!isEmail) {
      setError("Введите адрес почты");
      return;
    }
    setBusy(true);
    try {
      const data = await requestCode(email);
      setDebugCode(data.debug_code ?? "");
      setScreen("code");
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message || "Не удалось отправить код, проверьте адрес почты");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode() {
    setError("");
    try {
      const data = await verifyCode(email, code.trim());
      setTicket(data.ticket);
      setNeedPhone(notFound);
      setScreen("newPassword");
    } catch {
      setError("Неверный код");
    }
  }

  async function handleSetPassword() {
    setError("");
    if (newPassword.length < 4) {
      setError("Пароль должен быть не короче 4 символов");
      return;
    }
    if (newPassword !== newPassword2) {
      setError("Пароли не совпадают");
      return;
    }
    if (needPhone && phoneDigits.length < 10) {
      setError("Введите телефон полностью");
      return;
    }
    if (!agree) {
      setError("Нужно согласие на обработку персональных данных");
      return;
    }
    try {
      const data = await setPassword(ticket, newPassword, needPhone ? `+7${phoneDigits}` : undefined, agree);
      setAccessToken(data.access_token);
      window.location.href = "/";
    } catch (e: unknown) {
      const err = e as Error;
      const msg = err.message || "Не удалось сохранить пароль";
      // новый аккаунт без телефона (например, нажали «Забыли пароль» вместо регистрации) — просим телефон
      if (msg.toLowerCase().includes("укажите номер")) setNeedPhone(true);
      setError(msg);
    }
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-gradient-to-br from-brand-blue-dark via-brand-blue to-brand-blue flex items-center justify-center p-6">
      <AutoBackdrop />
      <div aria-hidden className="pointer-events-none absolute -top-32 -left-24 w-96 h-96 rounded-full bg-brand-yellow/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 w-[28rem] h-[28rem] rounded-full bg-white/10 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-3xl p-8 md:p-10 shadow-2xl">
          <div className="flex items-center gap-3 mb-7">
            <div className="w-10 h-10 rounded-xl bg-brand-yellow flex items-center justify-center text-brand-blue-dark font-bold text-lg">
              Т
            </div>
            <span className="text-lg font-semibold text-gray-900">Твоя Шина</span>
          </div>

          {screen === "login" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleLogin();
              }}
            >
              <h1 className="text-lg font-bold text-gray-900">Вход</h1>
              <p className="text-xs text-gray-500 mt-0.5 mb-6">Почта или логин организации и пароль</p>

              <input
                autoFocus
                value={ident}
                onChange={(e) => onIdentChange(e.target.value)}
                placeholder="Почта или логин"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode={isEmail ? "email" : "text"}
                className={`${inputCls} mb-3`}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword_(e.target.value)}
                placeholder="Пароль"
                className={`${inputCls} mb-5`}
              />

              <button type="submit" disabled={busy} className={`${yellowBtn} disabled:opacity-60`}>
                Войти
              </button>

              {error && <p className="text-xs text-red-500 mt-3 text-center">{error}</p>}

              {isEmail && (
                <div className="mt-5 text-xs text-center">
                  {notFound ? (
                    <div>
                      <Consent checked={agree} onChange={setAgree} />
                      <button
                        type="button"
                        disabled={!agree || busy}
                        onClick={handleSendCode}
                        className="text-brand-blue font-medium disabled:opacity-40"
                      >
                        Зарегистрироваться
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={handleSendCode} className="text-gray-400 hover:text-gray-600">
                      Забыли пароль?
                    </button>
                  )}
                </div>
              )}
            </form>
          )}

          {screen === "code" && (
            <>
              <h1 className="text-lg font-bold text-gray-900">Подтверждение</h1>
              <p className="text-xs text-gray-500 mt-0.5">Мы отправили код на {email}</p>
              {debugCode ? (
                <p className="text-xs text-gray-400 mb-6">Тестовый режим: код — {debugCode}</p>
              ) : (
                <p className="text-xs text-gray-400 mb-6">Если письма нет, проверьте папку «Спам»</p>
              )}

              <input
                placeholder="Код из письма"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                className={`${inputCls} mb-5 text-center tracking-widest text-lg`}
              />
              <button onClick={handleVerifyCode} className={yellowBtn}>
                Подтвердить
              </button>
              {error && <p className="text-xs text-red-500 mt-3 text-center">{error}</p>}
              <button onClick={() => setScreen("login")} className="text-xs text-gray-400 hover:text-gray-600 mt-5 block mx-auto">
                Назад
              </button>
            </>
          )}

          {screen === "newPassword" && (
            <>
              <h1 className="text-lg font-bold text-gray-900">Придумайте пароль</h1>
              <p className="text-xs text-gray-500 mt-0.5 mb-6">Почта подтверждена, осталось задать пароль</p>

              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Новый пароль"
                className={`${inputCls} mb-3`}
              />
              <input
                type="password"
                value={newPassword2}
                onChange={(e) => setNewPassword2(e.target.value)}
                placeholder="Повторите пароль"
                className={`${inputCls} mb-3`}
              />
              {needPhone && (
                <>
                  <input
                    value={phoneDisplay}
                    onChange={(e) => onPhoneChange(e.target.value)}
                    placeholder="Телефон для связи"
                    inputMode="tel"
                    className={`${inputCls} mb-1`}
                  />
                  <p className="text-[11px] text-gray-400 mb-4">Нужен, чтобы сервис мог связаться с вами по записи</p>
                </>
              )}
              <div className="mt-2">
                <Consent checked={agree} onChange={setAgree} />
              </div>
              <button onClick={handleSetPassword} className={yellowBtn}>
                Готово
              </button>
              {error && <p className="text-xs text-red-500 mt-3 text-center">{error}</p>}
            </>
          )}
        </div>
        <LegalFooter dark />
      </div>
    </main>
  );
}
