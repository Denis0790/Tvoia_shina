"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSocket } from "@/lib/chatSocket";
import type { Counters, Fetcher } from "@/lib/chat";

const EMPTY: Counters = { unread_messages: 0, unread_dialogs: 0, pending_bookings: 0 };

/** Счётчики для меню: непрочитанные сообщения и (у менеджера) неподтверждённые записи. */
export function useChatCounters(fetcher: Fetcher, socket: ChatSocket, enabled: boolean) {
  const [c, setC] = useState<Counters>(EMPTY);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetcher("/chat/counters");
      if (r.ok) setC(await r.json());
    } catch {}
  }, [fetcher]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const id = setInterval(refresh, 30000);
    const off = socket.subscribe((e) => {
      if (["_open", "message", "read", "message_deleted"].includes(e.type)) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(refresh, 250);
      }
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
      clearInterval(id);
      off();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, refresh, socket]);

  return { ...c, refresh };
}
