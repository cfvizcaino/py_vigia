import { backendJson } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Learning labels already saved for this recorte (fase 4). Admin only; the backend checks the role. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Detección no válida." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  return backendJson(`/detections/${id}/annotations`, { signal: AbortSignal.timeout(15_000) });
}
