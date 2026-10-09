/** HTTP contracts shared with apps/backend/vigia_backend/schemas.py. */
export type Device = {
  id: string;
  external_id: string;
  name: string;
  kind: string;
  status: string;
  lat: number;
  lng: number;
  camera_model: string | null;
};

export type QueryInput = {
  lat: number;
  lng: number;
  radius_m: number;
  time_from: string;
  time_to: string;
  vehicle_type?: string;
  color?: string;
};

export type RouteHop = {
  sequence_order: number;
  detection_id: string;
  camera_id: string;
  vehicle_type: string;
  color: string | null;
  direction: string;
  confidence: number;
  observed_at: string;
};

export type CandidateRoute = {
  id: string;
  rank: number;
  confidence: number;
  has_distant_gaps: boolean;
  camera_ids: string[];
  vehicle_type: string;
  color: string | null;
  detections: RouteHop[];
  road_geometry?: import("./road-routing").RoadGeometry | null;
  explanation?: {
    model: string;
    calibrated_probability: boolean;
    weights: Record<string, number>;
    geometric_mean: number;
    coverage_bonus: number;
    search_pruned: boolean;
    segments: {
      from_camera: string; to_camera: string; option_index: number;
      distance_m: number; observed_seconds: number; expected_seconds: number;
      source: string; score: number; gap_penalty: number; source_penalty: number;
    }[];
  };
};

export type QueryResult = {
  query: QueryInput & { id: string; created_at: string };
  nearby_devices: Pick<Device, "id" | "external_id" | "name" | "lat" | "lng">[];
  candidate_detection_count: number;
  routes: CandidateRoute[];
};

export const COLORS: Record<string, string> = { white: "Blanco", black: "Negro", gray: "Gris / plata", red: "Rojo", blue: "Azul", green: "Verde" };
export const STATUS_LABELS: Record<string, string> = { online: "En línea", offline: "Sin conexión", simulated: "Simulada" };
export const vehicleLabel = (type: string) => type === "motorcycle" ? "Motocicleta" : "Automóvil";
export const percent = (value: number) => `${Math.round(value * 100)}%`;

// SQLite returns naive UTC timestamps; always render in the operation's timezone.
function observationDateTime(value: string) {
  const utc = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  return new Date(utc);
}

export function observationDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(observationDateTime(value));
}

export function observationTime(value: string) {
  return observationDateTime(value).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function validateQuery(value: unknown): QueryInput {
  if (!value || typeof value !== "object") throw new Error("Completa los datos de la consulta.");
  const input = value as QueryInput;
  if (!Number.isFinite(input.lat) || Math.abs(input.lat) > 90 || !Number.isFinite(input.lng) || Math.abs(input.lng) > 180) throw new Error("Selecciona un punto de búsqueda válido.");
  if (!Number.isFinite(input.radius_m) || input.radius_m <= 0 || input.radius_m > 50_000) throw new Error("El radio debe estar entre 1 y 50.000 metros.");
  const zonedDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/i;
  if (typeof input.time_from !== "string" || typeof input.time_to !== "string" || !zonedDate.test(input.time_from) || !zonedDate.test(input.time_to) || !Number.isFinite(Date.parse(input.time_from)) || !Number.isFinite(Date.parse(input.time_to))) throw new Error("Ingresa fechas y horas válidas con zona horaria.");
  if (Date.parse(input.time_from) >= Date.parse(input.time_to)) throw new Error("La hora final debe ser posterior a la inicial.");
  if (input.vehicle_type && !["car", "motorcycle"].includes(input.vehicle_type)) throw new Error("Tipo de vehículo no válido.");
  if (input.color !== undefined && (typeof input.color !== "string" || !input.color.trim() || input.color.length > 64)) throw new Error("Color no válido.");
  return { lat: input.lat, lng: input.lng, radius_m: input.radius_m, time_from: input.time_from, time_to: input.time_to, ...(input.vehicle_type ? { vehicle_type: input.vehicle_type } : {}), ...(input.color ? { color: input.color } : {}) };
}
