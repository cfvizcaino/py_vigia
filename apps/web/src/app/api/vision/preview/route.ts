import { fetchVision } from "@/lib/vision-api";

export async function GET() {
  try {
    const response = await fetchVision("/api/v1/preview.jpg");
    if (!response.ok) return new Response(null, { status: 503 });
    return new Response(await response.arrayBuffer(), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
