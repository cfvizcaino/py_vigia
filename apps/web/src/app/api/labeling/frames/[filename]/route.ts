import { authorize } from "@/lib/session";
import { readFile } from "node:fs/promises";
import { framePath } from "@/lib/plate-dataset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ filename: string }> },
) {
  // Plate frames are sensitive training data: dataset labeling is an admin task.
  const denied = await authorize({ role: "admin" });
  if (denied) return denied;
  try {
    const { filename } = await context.params;
    const image = await readFile(framePath(filename));
    const contentType = filename.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    return new Response(image, {
      headers: { "Content-Type": contentType, "Cache-Control": "private, no-store" },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
