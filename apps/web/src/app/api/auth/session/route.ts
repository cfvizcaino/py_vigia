import { backendFetch, sessionToken } from "@/lib/session";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  if (!await sessionToken()) return Response.json({ error: "Sin sesión." }, { status: 401, headers });
  try {
    const response = await backendFetch("/auth/me");
    if (!response.ok) return Response.json({ error: "Sin sesión." }, { status: response.status < 500 ? 401 : 502, headers });
    return Response.json(await response.json(), { headers });
  } catch {
    return Response.json({ error: "No se pudo conectar con el servicio central." }, { status: 503, headers });
  }
}
