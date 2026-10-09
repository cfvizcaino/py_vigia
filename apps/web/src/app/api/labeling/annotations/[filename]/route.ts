import { authorize } from "@/lib/session";
import { readBoxes, saveBoxes, validateBoxes } from "@/lib/plate-dataset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ filename: string }> };

export async function GET(_request: Request, context: Context) {
  // Plate frames are sensitive training data: dataset labeling is an admin task.
  const denied = await authorize({ role: "admin" });
  if (denied) return denied;
  try {
    const { filename } = await context.params;
    const annotation = await readBoxes(filename);
    return Response.json(annotation, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Fotograma no encontrado." }, { status: 404 });
  }
}

export async function PUT(request: Request, context: Context) {
  // Plate frames are sensitive training data: dataset labeling is an admin task.
  const denied = await authorize({ role: "admin" });
  if (denied) return denied;
  try {
    const { filename } = await context.params;
    const body = (await request.json()) as { boxes?: unknown };
    const boxes = validateBoxes(body.boxes);
    await saveBoxes(filename, boxes);
    return Response.json({ saved: true, boxCount: boxes.length });
  } catch (error) {
    const status = error instanceof SyntaxError || (error instanceof Error && error.message.startsWith("INVALID_")) ? 400 : 404;
    return Response.json({ error: status === 400 ? "Las cajas no son válidas." : "No se pudo guardar la anotación." }, { status });
  }
}
