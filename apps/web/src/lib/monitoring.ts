/** HTTP contracts shared with apps/backend/vigia_backend/schemas.py. */
/** What the node is really doing, from its heartbeat (backend: liveness.py). */
export type DeviceActivity = {
  state: "active" | "background" | "stopped" | "no_signal" | "never" | "simulated";
  last_contact_at: string | null;
  last_heartbeat_at: string | null;
  last_event_at: string | null;
  node_version: string | null;
  analyses_per_second?: number | null;
  active_tracks?: number | null;
  pending_events?: number | null;
  delivered_events?: number | null;
  last_error?: string | null;
  battery?: number | null;
};

export type Device = {
  id: string;
  external_id: string;
  name: string;
  kind: string;
  status: string;
  lat: number;
  lng: number;
  camera_model: string | null;
  activity?: DeviceActivity | null;
};

export type ActivityTone = "ok" | "warn" | "off" | "simulated";

const ACTIVITY: Record<DeviceActivity["state"], { label: string; tone: ActivityTone; explanation: string }> = {
  active: { label: "Detectando", tone: "ok", explanation: "El edge está analizando y enviando al servidor." },
  background: { label: "En segundo plano", tone: "warn", explanation: "La app quedó en segundo plano: el edge no analiza hasta que vuelva a primer plano." },
  stopped: { label: "Detenido", tone: "off", explanation: "Alguien detuvo el edge desde el teléfono." },
  no_signal: { label: "Sin señal", tone: "warn", explanation: "Dejó de responder sin avisar: la app se cerró, el teléfono perdió la red o se quedó sin batería." },
  never: { label: "Sin conectar", tone: "off", explanation: "Este nodo todavía no se ha conectado." },
  simulated: { label: "Simulada", tone: "simulated", explanation: "" },
};

/** Label, tone and meaning of a node's state; servers without heartbeats fall back to the stored status. */
export function deviceActivity(device: Pick<Device, "status" | "activity">): { label: string; tone: ActivityTone; explanation: string } {
  if (device.activity) return ACTIVITY[device.activity.state];
  if (device.status === "online") return { label: "En línea", tone: "ok", explanation: "" };
  if (device.status === "simulated") return ACTIVITY.simulated;
  return { label: "Sin conexión", tone: "off", explanation: "" };
}

export function elapsedLabel(from: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(from)) / 1000));
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

/** «Último contacto hace 3 min · v1.5.0 · 6,2 análisis/s · 4 en cola · batería 83 %». */
export function activityDetail(activity: DeviceActivity | null | undefined, now = Date.now()): string {
  if (!activity || activity.state === "simulated") return "";
  const parts: string[] = [];
  if (activity.last_contact_at) parts.push(`Último contacto ${elapsedLabel(activity.last_contact_at, now)}`);
  if (activity.node_version) parts.push(`v${activity.node_version.replace(/^movil-/, "")}`);
  if (activity.state === "active" && activity.analyses_per_second != null) parts.push(`${activity.analyses_per_second.toFixed(1).replace(".", ",")} análisis/s`);
  if (activity.pending_events) parts.push(`${activity.pending_events} en cola`);
  if (activity.battery != null) parts.push(`batería ${Math.round(activity.battery * 100)} %`);
  return parts.join(" · ");
}

export type QueryInput = {
  lat: number;
  lng: number;
  radius_m: number;
  time_from: string;
  time_to: string;
  vehicle_type?: string;
  color?: string;
  /** Admin only; the backend rejects it for operators (Ley 1581, same policy as recortes). */
  plate?: string;
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
  /** A recorte is stored and within its 7 days; only admins can open it. */
  has_thumbnail?: boolean;
  /** Admin only, within 7 days. */
  license_plate?: string | null;
  confirmation?: "match" | "reject" | null;
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
    selection?: string;
    /** Best-ranked route sharing a detection with this one: it is an alternative of that vehicle. */
    shares_with_rank?: number | null;
    /** Steps with a voted colour vs unknown ones (joined only by time and road). */
    color_evidence?: { known: number; unknown: number };
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
  /** Searched by plate, but no camera read it: the routes are vehicles without a readable plate. */
  plate_unread?: boolean;
};

export const COLORS: Record<string, string> = { white: "Blanco", black: "Negro", gray: "Gris o plateado", silver: "Plateado", red: "Rojo", blue: "Azul", green: "Verde", yellow: "Amarillo", brown: "Café" };
/** Colours the cameras' classifier reports (apps/vision/training/build_color_dataset.py); silver comes out as gray. */
export const REPORTED_COLORS = ["white", "black", "gray", "red", "blue", "green", "yellow", "brown"];
/** Colombian plates: cars ABC123, motorcycles ABC12D or ABC12. Same rule as the backend. */
export function normalizePlate(value: string): string | null {
  const text = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return /^[A-Z]{3}(?:[0-9]{3}|[0-9]{2}[A-Z]?)$/.test(text) ? text : null;
}

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
  let plate: string | null = null;
  if (input.plate !== undefined) {
    plate = typeof input.plate === "string" ? normalizePlate(input.plate) : null;
    if (!plate) throw new Error("La placa debe tener formato colombiano: ABC123 o ABC12D.");
  }
  return { lat: input.lat, lng: input.lng, radius_m: input.radius_m, time_from: input.time_from, time_to: input.time_to, ...(input.vehicle_type ? { vehicle_type: input.vehicle_type } : {}), ...(input.color ? { color: input.color } : {}), ...(plate ? { plate } : {}) };
}

/** A case of the synthetic scoring dataset, with Colombian local date and times. */
export type Scenario = {
  id: string;
  title: string;
  challenge: string;
  camera_id: string;
  radius_m: number;
  date: string;
  time_from: string;
  time_to: string;
  vehicle_type: "car" | "motorcycle" | null;
  color: string | null;
};

/** "· 1 paso sin color confirmado", or "" when every step has a colour. */
export function unknownColorNote(route: Pick<CandidateRoute, "explanation">): string {
  const unknown = route.explanation?.color_evidence?.unknown ?? 0;
  return unknown ? ` · ${unknown} ${unknown === 1 ? "paso" : "pasos"} sin color confirmado` : "";
}
