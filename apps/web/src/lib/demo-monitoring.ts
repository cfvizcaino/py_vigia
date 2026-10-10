import { type Device, type QueryInput, type QueryResult, type CandidateRoute, validateQuery } from "./monitoring";

// Explicit, local demonstration. Never used as a fallback for failed live queries.
export const DEMO_DEVICES: Device[] = [
  { id: "demo-01", external_id: "CAM-01", name: "Tapo C110", kind: "physical", status: "offline", lat: 11.0131, lng: -74.8172, camera_model: "Tapo C110" },
  { id: "demo-02", external_id: "CAM-02", name: "Calle 84", kind: "simulated", status: "simulated", lat: 11.011, lng: -74.8148, camera_model: null },
  { id: "demo-03", external_id: "CAM-03", name: "Parque Venezuela", kind: "simulated", status: "simulated", lat: 11.005, lng: -74.8069, camera_model: null },
  { id: "demo-04", external_id: "CAM-04", name: "Calle 72", kind: "simulated", status: "offline", lat: 11.0015, lng: -74.804, camera_model: null },
];

export const DEMO_QUERY: QueryInput = { lat: 11.0131, lng: -74.8172, radius_m: 2000, time_from: "2026-08-25T09:20:00-05:00", time_to: "2026-08-25T10:30:00-05:00", vehicle_type: "car", color: "white" };

function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const examples = [
  { vehicle: "car", color: "white", cameras: [0, 1], times: ["14:30:00", "14:30:54"], confidence: 0.925 },
  { vehicle: "car", color: "white", cameras: [2, 3], times: ["15:10:00", "15:11:20"], confidence: 0.78 },
  { vehicle: "car", color: "gray", cameras: [0, 2, 3], times: ["14:35:00", "14:38:32", "14:39:52"], confidence: 0.74 },
  { vehicle: "motorcycle", color: "black", cameras: [0, 1, 2, 3], times: ["14:42:00", "14:42:54", "14:45:35", "14:46:55"], confidence: 0.72 },
];

export function runDemoQuery(value: QueryInput): QueryResult {
  const query = validateQuery(value);
  const nearby = DEMO_DEVICES.filter((device) => distance(query, device) <= query.radius_m);
  let count = 0;
  const routes: CandidateRoute[] = [];
  for (const [index, example] of examples.entries()) {
    if (query.vehicle_type && query.vehicle_type !== example.vehicle || query.color && query.color !== example.color) continue;
    const detections = example.cameras.flatMap((camera, hop) => {
      const device = DEMO_DEVICES[camera];
      const observed_at = `2026-08-25T${example.times[hop]}Z`;
      if (!nearby.includes(device) || Date.parse(observed_at) < Date.parse(query.time_from) || Date.parse(observed_at) > Date.parse(query.time_to)) return [];
      return [{ sequence_order: hop, detection_id: `demo-${index}-${hop}`, camera_id: device.external_id, vehicle_type: example.vehicle, color: example.color, direction: "izquierda-a-derecha", confidence: 0.94 - hop * 0.04, observed_at }];
    });
    count += detections.length;
    if (detections.length < 2) continue;
    routes.push({ id: `demo-route-${index}`, rank: routes.length + 1, confidence: example.confidence, has_distant_gaps: index > 0, camera_ids: detections.map((hop) => hop.camera_id), vehicle_type: example.vehicle, color: example.color, detections: detections.map((hop, order) => ({ ...hop, sequence_order: order })) });
  }
  return { query: { ...query, id: `demo-${Date.now()}`, created_at: new Date().toISOString() }, nearby_devices: nearby, candidate_detection_count: count, routes };
}

/** The anonymous demo may only ask the road router for routes between its own fixed cameras. */
export function isDemoRoute(points: unknown): boolean {
  return Array.isArray(points) && points.length >= 2 && points.every((point: { lat?: unknown; lng?: unknown } | null) =>
    DEMO_DEVICES.some((device) => point?.lat === device.lat && point?.lng === device.lng));
}
