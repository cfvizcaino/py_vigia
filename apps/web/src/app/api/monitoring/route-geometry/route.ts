import { resolveRoadGeometry } from "@/lib/road-routing";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const body = await request.json() as { points?: unknown };
    return Response.json(await resolveRoadGeometry(body.points), { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No fue posible calcular la geometría vial." },
      { status: 400, headers },
    );
  }
}
