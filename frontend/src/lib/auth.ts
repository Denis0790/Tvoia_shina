const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

let accessToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (refreshTimer) clearTimeout(refreshTimer);
  if (token) {
    refreshTimer = setTimeout(() => {
      refreshAccessToken();
    }, 13 * 60 * 1000);
  }
}

export async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      setAccessToken(null);
      return null;
    }
    const data = await res.json();
    setAccessToken(data.access_token);
    return data.access_token;
  } catch {
    setAccessToken(null);
    return null;
  }
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  let token = getAccessToken();

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
    token = await refreshAccessToken();
    if (token) {
      res = await doFetch(token);
    }
  }

  return res;
}
