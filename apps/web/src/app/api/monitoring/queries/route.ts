import { backendResponse } from "@/lib/backend-api";

// The backend's GET persists a query. Expose POST to avoid prefetch/replay by caches.
export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "El cuerpo debe ser JSON válido." }, { status: 400 });
  }
  return backendResponse("/queries", input);
}
