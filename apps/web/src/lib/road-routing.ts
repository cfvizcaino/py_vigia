export type RoadPoint = { lng: number; lat: number };
export type RoadGeometry = {
  points: RoadPoint[];
  source: "road-network" | "camera-chord";
  distance_m: number | null;
};

function validPoint(value: unknown): value is RoadPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as RoadPoint;
  return Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;
}

export function validateRoadPoints(value: unknown): RoadPoint[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 6 || !value.every(validPoint)) {
    throw new Error("La ruta debe contener entre 2 y 6 coordenadas válidas.");
  }
  return value.map(({ lat, lng }) => ({ lat, lng }));
}

/** Ajusta una secuencia de cámaras a calles transitables mediante OSRM. */
export async function resolveRoadGeometry(value: unknown): Promise<RoadGeometry> {
  const points = validateRoadPoints(value);
  const base = (process.env.ROAD_ROUTER_URL ?? "http://127.0.0.1:5000").replace(/\/$/, "");
  const coordinates = points.map(({ lng, lat }) => `${lng},${lat}`).join(";");
  try {
    const response = await fetch(`${base}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`, {
      cache: "no-store",
      headers: { "User-Agent": "VIGIA/0.2 road-geometry" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("router rejected request");
    const body = await response.json() as { routes?: { distance?: number; geometry?: { coordinates?: unknown[] } }[] };
    const route = body.routes?.[0];
    const geometry = route?.geometry?.coordinates;
    if (!Array.isArray(geometry) || geometry.length < 2 || geometry.length > 50_000) throw new Error("invalid route geometry");
    const routed = geometry.map((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) throw new Error("invalid route coordinate");
      return { lng: Number(coordinate[0]), lat: Number(coordinate[1]) };
    });
    if (!routed.every(validPoint)) throw new Error("invalid route coordinate");
    return { points: routed, source: "road-network", distance_m: Number.isFinite(route?.distance) ? Number(route?.distance) : null };
  } catch {
    // La correlación sigue siendo útil sin el proveedor, pero se etiqueta como estimación.
    return { points, source: "camera-chord", distance_m: null };
  }
}
