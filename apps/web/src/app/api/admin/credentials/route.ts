import { backendJson } from "@/lib/session";

export async function GET() {
  return backendJson("/admin/credentials");
}

export async function POST(request: Request) {
  let input: { camera_id?: unknown; days?: unknown };
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "El cuerpo debe ser JSON válido." }, { status: 400 });
  }
  const { camera_id: camera, days } = input;
  if (typeof camera !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(camera)) return Response.json({ error: "Cámara no válida." }, { status: 400 });
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 365) return Response.json({ error: "La vigencia debe estar entre 1 y 365 días." }, { status: 400 });
  return backendJson(`/admin/devices/${encodeURIComponent(camera)}/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days }),
  });
}
