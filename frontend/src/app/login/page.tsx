"use client";

import { useState } from "react";
import { login, orgLogin, managerLogin, requestCode, verifyCode, setPassword } from "@/lib/api";
import { setAccessToken } from "@/lib/auth";
import { setManagerAccessToken } from "@/lib/managerAuth";
import AutoBackdrop from "@/components/AutoBackdrop";

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

export default function LoginPage() {
  const [screen, setScreen] = useState<Screen>("login");

  // единое поле: с цифры — телефон с маской, иначе логин организации
  const [ident, setIdent] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [phoneMode, setPhoneMode] = useState(false);
  const [password, setPassword_] = useState("");

  const [code, setCode] = useState("");
  const [debugCode, setDebugCode] = useState("");
  const [ticket, setTicket] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");

  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  const fullPhone = `+7${phoneDigits}`;
  const display = phoneMode ? formatPhone(phoneDigits) : ident;

  function onIdentChange(raw: string) {
    setError("");
    setNotFound(false);
    if (phoneMode || /^[+\d]/.test(raw)) {
      let digits = raw.replace(/\D/g, "");
      if (phoneMode) {
        // стёрли знак маски — удаляем последнюю цифру, иначе курсор «залипает»
        if (raw.length < display.length && digits.length === (phoneDigits.length ? phoneDigits.length + 1 : 0)) {
          digits = digits.slice(0, -1);
        }
        digits = digits.replace(/^7/, "");
      } else {
        digits = digits.replace(/^[78]/, "");
      }
      digits = digits.slice(0, 10);
      if (!digits && !/^[+\d]/.test(raw)) {
        setPhoneMode(false);
        setIdent("");
        setPhoneDigits("");
        return;
      }
      if (!digits && raw.length < display.length) {
        setPhoneMode(false);
        setIdent("");
        setPhoneDigits("");
        return;
      }
      setPhoneMode(true);
      setPhoneDigits(digits);
    } else {
      setPhoneMode(false);
      setPhoneDigits("");
      setIdent(raw);
    }
  }

  async function handleLogin() {
    setError("");
    setNotFound(false);
    if (phoneMode ? phoneDigits.length < 10 : !ident.trim()) {
      setError(phoneMode ? "Введите номер полностью" : "Введите телефон или логин");
      return;
    }
    setBusy(true);
    try {
      if (phoneMode) {
        const data = await login(fullPhone, password);
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
      if (phoneMode && err.status === 404) {
        setNotFound(true);
        setError("Аккаунт с таким номером не найден");
      } else {
        setError(err.detail || "Неверный пароль");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSendCode() {
    setError("");
    try {
      const data = await requestCode(fullPhone);
      setDebugCode(data.debug_code);
      setScreen("code");
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message || "Не удалось отправить код, проверьте номер");
    }
  }

  async function handleVerifyCode() {
    setError("");
    try {
      const data = await verifyCode(fullPhone, code);
      setTicket(data.ticket);
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
    try {
      const data = await setPassword(ticket, newPassword);
      setAccessToken(data.access_token);
      window.location.href = "/";
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message || "Не удалось сохранить пароль");
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
              <p className="text-xs text-gray-500 mt-0.5 mb-6">Телефон или логин организации и пароль</p>

              <input
                autoFocus
                value={display}
                onChange={(e) => onIdentChange(e.target.value)}
                placeholder="Телефон или логин"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode={phoneMode ? "tel" : "text"}
                className={`${inputCls} mb-3 ${phoneMode ? "tracking-wide" : ""}`}
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

              {phoneMode && (
                <div className="mt-5 text-xs text-center">
                  {notFound ? (
                    <button type="button" onClick={handleSendCode} className="text-brand-blue font-medium">
                      Зарегистрироваться
                    </button>
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
              <p className="text-xs text-gray-500 mt-0.5">Мы отправили код на {formatPhone(phoneDigits)}</p>
              <p className="text-xs text-gray-400 mb-6">Тестовый режим: код — {debugCode}</p>

              <input
                placeholder="Код из SMS"
                value={code}
                onChange={(e) => setCode(e.target.value)}
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
              <p className="text-xs text-gray-500 mt-0.5 mb-6">Номер подтверждён, осталось задать пароль</p>

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
                className={`${inputCls} mb-5`}
              />
              <button onClick={handleSetPassword} className={yellowBtn}>
                Готово
              </button>
              {error && <p className="text-xs text-red-500 mt-3 text-center">{error}</p>}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
