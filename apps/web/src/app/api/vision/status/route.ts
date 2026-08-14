import { fetchVision } from "@/lib/vision-api";

export async function GET() {
  try {
    const response = await fetchVision("/api/v1/status");
    if (!response.ok) throw new Error("Vision service unavailable");
    return Response.json(await response.json(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        service: "vigia-vision",
        status: "offline",
        cameraId: "CAM-01",
        cameraModel: "Tapo C110",
        frameNumber: 0,
        lastFrameAt: null,
        activeDetections: 0,
        errorCode: "VISION_SERVICE_OFFLINE",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
