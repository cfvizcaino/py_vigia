import { backendJson } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };
type Params = { params: Promise<{ id: string; task: string }> };

async function target(ctx: Params) {
  const { id, task } = await ctx.params;
  return UUID.test(id) && (task === "color" || task === "plate") ? `/detections/${id}/annotations/${task}` : null;
}

/** An admin labels the recorte's colour or plate for training (fase 4); the backend copies it to the learning store. */
export async function PUT(request: Request, ctx: Params) {
  const path = await target(ctx);
  if (!path) return Response.json({ error: "Etiqueta no válida." }, { status: 400, headers });
  let label: unknown;
  try {
    label = (await request.json())?.label;
  } catch {
    return Response.json({ error: "El cuerpo debe ser JSON válido." }, { status: 400, headers });
  }
  if (typeof label !== "string" || !label.trim() || label.length > 32) return Response.json({ error: "Etiqueta no válida." }, { status: 400, headers });
  return backendJson(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: label.trim() }), signal: AbortSignal.timeout(20_000) });
}

export async function DELETE(_: Request, ctx: Params) {
  const path = await target(ctx);
  if (!path) return Response.json({ error: "Etiqueta no válida." }, { status: 400, headers });
  return backendJson(path, { method: "DELETE", signal: AbortSignal.timeout(20_000) });
}
