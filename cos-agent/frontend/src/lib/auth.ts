import { api, ApiError, COS_TOKEN_KEY } from "./api.ts";

export function getToken(): string | null {
  return localStorage.getItem(COS_TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(COS_TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(COS_TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return Boolean(getToken());
}

export async function login(email: string, password: string): Promise<void> {
  const res = await api.post<{ token: string }>("/api/auth/login", {
    email,
    password,
  });
  setToken(res.token);
}

export function logout(): void {
  clearToken();
  window.location.href = "/login";
}

export { ApiError };
