import { backendJson } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };
type Params = { params: Promise<{ id: string; detectionId: string }> };

async function target(ctx: Params) {
  const { id, detectionId } = await ctx.params;
  return UUID.test(id) && UUID.test(detectionId) ? `/queries/${id}/confirmations/${detectionId}` : null;
}

/** An admin says whether a step is the vehicle; the backend recalculates and returns the routes. */
export async function PUT(request: Request, ctx: Params) {
  const path = await target(ctx);
  if (!path) return Response.json({ error: "Paso no válido." }, { status: 400, headers });
  let verdict: unknown;
  try {
    verdict = (await request.json())?.verdict;
  } catch {
    return Response.json({ error: "El cuerpo debe ser JSON válido." }, { status: 400, headers });
  }
  if (verdict !== "match" && verdict !== "reject") return Response.json({ error: "Respuesta no válida." }, { status: 400, headers });
  return backendJson(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verdict }), signal: AbortSignal.timeout(20_000) });
}

export async function DELETE(_: Request, ctx: Params) {
  const path = await target(ctx);
  if (!path) return Response.json({ error: "Paso no válido." }, { status: 400, headers });
  return backendJson(path, { method: "DELETE", signal: AbortSignal.timeout(20_000) });
}
