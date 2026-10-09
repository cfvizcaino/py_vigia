import "server-only";

import { cookies } from "next/headers";
import { backendUrl } from "./backend-api";

/** The bearer token lives only in an httpOnly cookie; browser code never reads it. */
export const SESSION_COOKIE = "vigia_session";
const headers = { "Cache-Control": "no-store" };

export type SessionUser = { id: string; email: string; display_name: string; role: "operator" | "admin" };
export type Session = { user: SessionUser; expires_at: string };

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** Calls the backend as the signed-in person. The backend enforces roles; this only forwards. */
export async function backendFetch(path: string, init: RequestInit = {}) {
  const token = await sessionToken();
  const requestHeaders = new Headers(init.headers);
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
  return fetch(backendUrl(path), { ...init, headers: requestHeaders, cache: "no-store", signal: init.signal ?? AbortSignal.timeout(10_000) });
}

export function sessionError(status: number) {
  if (status === 401) return Response.json({ error: "Tu sesión terminó. Inicia sesión de nuevo." }, { status, headers });
  if (status === 403) return Response.json({ error: "Tu rol no permite esta acción." }, { status, headers });
  return null;
}

/**
 * Guards routes that do not go through the backend (vision, labeling, router).
 * `preview` asks the backend to authorize and audit camera video access.
 */
export async function authorize(options: { role?: "admin"; preview?: { camera_id: string; kind: "stream" | "snapshot" } } = {}): Promise<Response | null> {
  try {
    const response = options.preview
      ? await backendFetch("/auth/preview-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.preview) })
      : await backendFetch("/auth/me");
    if (!response.ok) return sessionError(response.status) ?? Response.json({ error: "No fue posible validar la sesión." }, { status: 503, headers });
    if (options.role && !options.preview) {
      const session = await response.json() as Session;
      if (session.user.role !== options.role) return sessionError(403);
    }
    return null;
  } catch {
    return Response.json({ error: "No se pudo validar la sesión con el servicio central." }, { status: 503, headers });
  }
}
