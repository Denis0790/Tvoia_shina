"use client";

import { useEffect, useState } from "react";
import { refreshAccessToken } from "@/lib/auth";

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    refreshAccessToken().finally(() => setReady(true));
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}
