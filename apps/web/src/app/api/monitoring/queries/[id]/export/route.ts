import { backendFetch, sessionError } from "@/lib/session";

const headers = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The export is produced and audited by the backend from persisted data. */
export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Consulta no válida." }, { status: 400, headers });
  try {
    const response = await backendFetch(`/queries/${id}/export`, { method: "POST" });
    if (!response.ok) return sessionError(response.status) ?? Response.json({ error: "No fue posible exportar la consulta." }, { status: response.status === 404 ? 404 : 502, headers });
    return Response.json(await response.json(), { headers });
  } catch {
    return Response.json({ error: "No se pudo conectar con el servicio central." }, { status: 503, headers });
  }
}
