const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8090";

/** Muss mit `lib/auth.ts` übereinstimmen. */
export const COS_TOKEN_KEY = "cos_token";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_URL}${path}`;
  const headers = new Headers(options.headers);
  const token = localStorage.getItem(COS_TOKEN_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const text = await res.text();
    const isAuthLogin = path === "/api/auth/login" || path.endsWith("/api/auth/login");
    if (res.status === 401 && !isAuthLogin) {
      localStorage.removeItem(COS_TOKEN_KEY);
      window.location.href = "/login";
    }
    throw new ApiError(res.status, text || res.statusText);
  }

  const ct = res.headers.get("Content-Type");
  if (ct?.includes("application/json")) {
    return (await res.json()) as T;
  }
  return (await res.text()) as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path, { method: "GET" }),

  post: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  put: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};
