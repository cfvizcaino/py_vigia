export type UserRole = 'operator' | 'admin';

export interface AppUser {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
}

/** What the node is really doing, from its heartbeat (backend: liveness.py). */
export interface DeviceActivity {
  state: 'active' | 'background' | 'stopped' | 'no_signal' | 'never' | 'simulated';
  last_contact_at: string | null;
  last_heartbeat_at: string | null;
  last_event_at: string | null;
  node_version: string | null;
  analyses_per_second: number | null;
  active_tracks: number | null;
  pending_events: number | null;
  delivered_events: number | null;
  last_error: string | null;
  battery: number | null;
}

export interface Device {
  id: string;
  external_id: string;
  name: string;
  kind: string;
  status: string;
  lat: number;
  lng: number;
  camera_model: string | null;
  activity?: DeviceActivity | null | undefined;
}

export interface DeviceDetection {
  id: string;
  vehicle_type: string;
  color: string | null;
  direction: string;
  confidence: number;
  observed_at: string;
}

export interface EdgeCredential {
  id: string;
  camera_id: string;
  created_at: string;
  expires_at: string;
  revoked: boolean;
}

export interface IssuedCredential {
  credential: EdgeCredential;
  secret: string;
}

export interface QueryInput {
  lat: number;
  lng: number;
  radius_m: number;
  time_from: string;
  time_to: string;
  vehicle_type?: string;
  color?: string;
  /** Only admins may filter by plate (Ley 1581); the backend audits it. */
  plate?: string;
}

export interface Scenario {
  id: string;
  title: string;
  camera_id: string;
  radius_m: number;
  date: string;
  time_from: string;
  time_to: string;
  vehicle_type: string | null;
  color: string | null;
}

export interface NearbyDevice {
  id: string;
  external_id: string;
  name: string;
  lat: number;
  lng: number;
  distance_m: number;
}

export interface RouteDetection {
  sequence_order: number;
  detection_id: string;
  camera_id: string;
  vehicle_type: string;
  color: string | null;
  direction: string;
  confidence: number;
  observed_at: string;
  license_plate?: string | null | undefined;
  confirmation?: 'match' | 'reject' | null | undefined;
  has_thumbnail?: boolean | undefined;
}

export interface CandidateRoute {
  id: string;
  rank: number;
  confidence: number;
  has_distant_gaps: boolean;
  camera_ids: string[];
  vehicle_type: string;
  color?: string | null;
  detections: RouteDetection[];
  explanation: Record<string, unknown>;
  road_geometry?: Record<string, unknown> | null | undefined;
}

export interface QueryRecord {
  id: string | number;
  lat: number;
  lng: number;
  radius_m: number;
  time_from: string;
  time_to: string;
  vehicle_type?: string | null;
  color?: string | null;
  created_at: string;
}

export interface QueryResult {
  query: QueryRecord;
  nearby_devices: NearbyDevice[];
  candidate_detection_count: number;
  routes: CandidateRoute[];
  /** Searched by plate, but no camera read it: the routes are vehicles without a readable plate. */
  plate_unread?: boolean | undefined;
}
