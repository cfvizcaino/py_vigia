const DEFAULT_VISION_API = "http://127.0.0.1:8001";

export function visionApiUrl(path: string): string {
  const base = process.env.VISION_API_URL ?? DEFAULT_VISION_API;
  return `${base.replace(/\/$/, "")}${path}`;
}

export async function fetchVision(path: string): Promise<Response> {
  return fetch(visionApiUrl(path), {
    cache: "no-store",
    signal: AbortSignal.timeout(4_000),
  });
}

export async function fetchVisionStream(path: string): Promise<Response> {
  return fetch(visionApiUrl(path), { cache: "no-store" });
}
