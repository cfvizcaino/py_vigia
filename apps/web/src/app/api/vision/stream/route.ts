import { fetchVisionStream } from "@/lib/vision-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetchVisionStream("/api/v1/stream.mjpg");
    if (!response.ok || !response.body) return new Response(null, { status: 503 });

    return new Response(response.body, {
      headers: {
        "Content-Type": "multipart/x-mixed-replace; boundary=frame",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
