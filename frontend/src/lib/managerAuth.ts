const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

let managerAccessToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function getManagerAccessToken() {
  return managerAccessToken;
}

export function setManagerAccessToken(token: string | null) {
  managerAccessToken = token;
  if (refreshTimer) clearTimeout(refreshTimer);
  if (token) {
    refreshTimer = setTimeout(() => {
      refreshManagerAccessToken();
    }, 13 * 60 * 1000);
  }
}

export async function refreshManagerAccessToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/auth/manager-refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      setManagerAccessToken(null);
      return null;
    }
    const data = await res.json();
    setManagerAccessToken(data.access_token);
    return data.access_token;
  } catch {
    setManagerAccessToken(null);
    return null;
  }
}

export async function managerApiFetch(path: string, options: RequestInit = {}) {
  let token = getManagerAccessToken();

  const doFetch = (t: string | null) =>
    fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.headers || {}),
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
    });

  let res = await doFetch(token);

  if (res.status === 401) {
    token = await refreshManagerAccessToken();
    if (token) {
      res = await doFetch(token);
    }
  }

  return res;
}
