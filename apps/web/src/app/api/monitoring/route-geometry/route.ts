import { isDemoRoute } from "@/lib/demo-monitoring";
import { resolveRoadGeometry } from "@/lib/road-routing";
import { authorize } from "@/lib/session";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  let body: { points?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "El cuerpo debe ser JSON válido." }, { status: 400, headers });
  }
  // Signed-in users may route any camera sequence. The anonymous demo is limited to its
  // four fixed cameras, so the router never becomes an open proxy for arbitrary points.
  if (!isDemoRoute(body.points)) {
    const denied = await authorize();
    if (denied) return denied;
  }
  try {
    return Response.json(await resolveRoadGeometry(body.points), { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No fue posible calcular la geometría vial." },
      { status: 400, headers },
    );
  }
}
