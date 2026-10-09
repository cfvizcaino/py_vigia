import { validateQuery } from "./monitoring";

const headers = { "Cache-Control": "no-store" };

export function backendUrl(path: string) {
  return `${(process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "")}/api/v1${path}`;
}

/** Only fixed API paths are accepted; the upstream address stays on the server. */
export async function backendResponse(path: "/devices" | "/queries", input?: unknown, token?: string | null) {
  let search = "";
  if (path === "/queries") {
    try {
      const query = validateQuery(input);
      // SQLite drops timezone offsets on bind. Send UTC to match stored observations.
      const normalized = { ...query, time_from: new Date(query.time_from).toISOString(), time_to: new Date(query.time_to).toISOString() };
      search = `?${new URLSearchParams(Object.entries(normalized).map(([key, value]) => [key, String(value)]))}`;
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Consulta no válida." }, { status: 400, headers });
    }
  }
  if (!token) return Response.json({ error: "Tu sesión terminó. Inicia sesión de nuevo." }, { status: 401, headers });
  try {
    const response = await fetch(`${backendUrl(path)}${search}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (response.status === 401) return Response.json({ error: "Tu sesión terminó. Inicia sesión de nuevo." }, { status: 401, headers });
    if (response.status === 403) return Response.json({ error: "Tu rol no permite esta acción." }, { status: 403, headers });
    if (!response.ok) {
      return Response.json({ error: response.status < 500 ? "El servicio rechazó la consulta. Revisa los filtros e inténtalo de nuevo." : "El servicio central encontró un error. Intenta nuevamente." }, { status: response.status < 500 ? response.status : 502, headers });
    }
    return Response.json(await response.json(), { headers });
  } catch {
    return Response.json({ error: "No se pudo conectar con el servicio central. Comprueba que esté iniciado y vuelve a intentar." }, { status: 503, headers });
  }
}
