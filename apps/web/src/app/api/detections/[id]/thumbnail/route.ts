import { backendFetch, sessionError } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A recorte can show a plate or a person (Ley 1581): never cached, by the browser or a proxy.
const privateHeaders = { "Cache-Control": "private, no-store" };

/** Admin only; the backend checks the role, enforces the 7 days and audits every view. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Detección no válida." }, { status: 400, headers: privateHeaders });
  try {
    const response = await backendFetch(`/detections/${id}/thumbnail`);
    if (!response.ok) return sessionError(response.status) ?? Response.json({ error: response.status === 404 ? "El recorte ya no está disponible." : "No fue posible cargar el recorte." }, { status: response.status === 404 ? 404 : 502, headers: privateHeaders });
    return new Response(await response.arrayBuffer(), { headers: { ...privateHeaders, "Content-Type": "image/jpeg" } });
  } catch {
    return Response.json({ error: "No se pudo conectar con el servicio central." }, { status: 503, headers: privateHeaders });
  }
}
