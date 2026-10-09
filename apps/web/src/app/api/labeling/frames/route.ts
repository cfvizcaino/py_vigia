import { authorize } from "@/lib/session";
import { listFrames } from "@/lib/plate-dataset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Plate frames are sensitive training data: dataset labeling is an admin task.
  const denied = await authorize({ role: "admin" });
  if (denied) return denied;
  try {
    const frames = await listFrames();
    return Response.json(
      {
        frames,
        total: frames.length,
        completed: frames.filter((frame) => frame.annotated).length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "No se encontró el dataset local de placas." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
}
