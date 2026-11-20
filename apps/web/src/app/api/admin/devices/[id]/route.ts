import { backendJson } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Borrado lógico del nodo: el backend lo saca de la operación y revoca sus tokens. */
export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Nodo no válido." }, { status: 400 });
  return backendJson(`/devices/${id}`, { method: "DELETE" });
}
