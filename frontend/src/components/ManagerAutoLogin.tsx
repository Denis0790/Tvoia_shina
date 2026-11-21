"use client";

import { useEffect } from "react";
import { refreshManagerAccessToken } from "@/lib/managerAuth";

// Если у менеджера на этом устройстве ещё живёт вход, страница входа сразу ведёт в админку.
export default function ManagerAutoLogin() {
  useEffect(() => {
    refreshManagerAccessToken().then((token) => {
      if (token) window.location.replace("/nord");
    });
  }, []);
  return null;
}
