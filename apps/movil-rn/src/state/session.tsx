import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { ApiError, validateBackendUrl, VigiaApiClient } from '../api/client';
import { preferences } from '../storage/preferences';
import { secureStorage } from '../storage/secure';
import type { AppUser, Device, DeviceDetection, EdgeCredential, IssuedCredential, QueryInput, QueryResult, Scenario } from '../types/models';

const demoUser: AppUser = {
  id: 'demo-operator',
  email: 'demostracion@vigia.local',
  display_name: 'Modo demostración',
  role: 'operator',
};

export const demoDevices: Device[] = [
  { id: 'demo-01', external_id: 'CAM-01', name: 'Tapo C110', kind: 'physical', status: 'offline', lat: 11.0131, lng: -74.8172, camera_model: 'Tapo C110' },
  { id: 'demo-02', external_id: 'CAM-02', name: 'Calle 84', kind: 'simulated', status: 'simulated', lat: 11.011, lng: -74.8148, camera_model: null },
  { id: 'demo-03', external_id: 'CAM-03', name: 'Parque Venezuela', kind: 'simulated', status: 'simulated', lat: 11.005, lng: -74.8069, camera_model: null },
  { id: 'demo-04', external_id: 'CAM-04', name: 'Calle 72', kind: 'physical', status: 'offline', lat: 11.0015, lng: -74.804, camera_model: null },
];

interface SessionContextValue {
  restoring: boolean;
  busy: boolean;
  isDemo: boolean;
  user: AppUser | null;
  baseUrl: string;
  error: string | null;
  devices: Device[];
  scenarios: Scenario[];
  history: QueryResult[];
  activeResult: QueryResult | null;
  login(email: string, password: string): Promise<void>;
  exploreDemo(): void;
  logout(): Promise<void>;
  saveApiUrl(value: string): Promise<string | null>;
  search(input: QueryInput): Promise<boolean>;
  openResult(result: QueryResult): void;
  exportResult(result: QueryResult): Promise<string>;
  createEdge(input: { cameraId: string; name: string; lat: number; lng: number; cameraModel?: string }): Promise<Device>;
  relocateEdge(deviceId: string, lat: number, lng: number): Promise<Device>;
  recentDetections(deviceId: string): Promise<DeviceDetection[]>;
  issueCredential(cameraId: string, days?: number): Promise<IssuedCredential>;
  listCredentials(): Promise<EdgeCredential[]>;
  revokeCredential(credentialId: string): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);
  const [baseUrl, setBaseUrl] = useState('http://10.0.2.2:8000');
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [history, setHistory] = useState<QueryResult[]>([]);
  const [activeResult, setActiveResult] = useState<QueryResult | null>(null);

  const expireSession = useCallback(() => {
    setUser(null);
    setIsDemo(false);
    setDevices([]);
    setScenarios([]);
    setHistory([]);
    setActiveResult(null);
    setError('La sesión venció. Inicia sesión nuevamente.');
  }, []);

  const api = useMemo(() => new VigiaApiClient(baseUrl, expireSession), [baseUrl, expireSession]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const savedUrl = await preferences.getApiUrl();
        if (!active) return;
        setBaseUrl(savedUrl);
        const token = await secureStorage.readSessionToken();
        if (!token) return;
        const client = new VigiaApiClient(savedUrl, expireSession);
        const [current, savedDevices] = await Promise.all([client.currentUser(), client.getDevices()]);
        if (active) {
          setUser(current);
          setDevices(savedDevices);
          setScenarios(await client.getScenarios());
        }
      } catch (reason) {
        if (active && reason instanceof ApiError && reason.statusCode !== 401) setError(reason.message);
        else if (active && !(reason instanceof ApiError)) setError('No fue posible restaurar la sesión.');
      } finally {
        if (active) setRestoring(false);
      }
    })();
    return () => { active = false; };
  }, [expireSession]);

  const login = useCallback(async (email: string, password: string) => {
    setBusy(true);
    setError(null);
    try {
      const loggedIn = await api.login(email, password);
      const savedDevices = await api.getDevices();
      setUser(loggedIn);
      setIsDemo(false);
      setDevices(savedDevices);
      setHistory([]);
      setActiveResult(null);
      setScenarios(await api.getScenarios());
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'No fue posible iniciar sesión.');
    } finally {
      setBusy(false);
    }
  }, [api]);

  const exploreDemo = useCallback(() => {
    setUser(demoUser);
    setIsDemo(true);
    setDevices(demoDevices);
    setScenarios([]);
    setHistory([]);
    setActiveResult(null);
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      if (!isDemo) await api.logout();
      else await secureStorage.clearSessionToken();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'La sesión se cerró localmente; no fue posible confirmar el cierre en el servidor.');
      await secureStorage.clearSessionToken();
    } finally {
      setUser(null);
      setIsDemo(false);
      setDevices([]);
      setScenarios([]);
      setHistory([]);
      setActiveResult(null);
    }
  }, [api, isDemo]);

  const saveApiUrl = useCallback(async (value: string): Promise<string | null> => {
    const candidate = value.trim().replace(/\/+$/, '');
    const issue = validateBackendUrl(candidate);
    if (issue) return issue;
    await preferences.saveApiUrl(candidate);
    setBaseUrl(candidate);
    return null;
  }, []);

  const search = useCallback(async (input: QueryInput) => {
    setBusy(true);
    setError(null);
    try {
      let result: QueryResult;
      if (isDemo) {
        const createdAt = new Date().toISOString();
        result = {
          query: { id: `demo-${Date.now()}`, created_at: createdAt, ...input },
          nearby_devices: demoDevices.map((device) => ({ ...device, distance_m: 0 })),
          candidate_detection_count: 7,
          routes: [
            { id: 'demo-route-1', rank: 1, confidence: 0.925, has_distant_gaps: false, vehicle_type: input.vehicle_type ?? 'car', color: input.color ?? 'white', camera_ids: ['CAM-01', 'CAM-02'], detections: [], explanation: { calibrated_probability: false, weights: { detection: 0.35, time: 0.4, appearance: 0.15, road: 0.1 }, segments: [] }, road_geometry: null },
          ],
        };
      } else {
        result = await api.runQuery(input);
      }
      setActiveResult(result);
      setHistory((previous) => [result, ...previous].slice(0, 20));
      return true;
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'No fue posible ejecutar la consulta.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [api, isDemo]);

  const exportResult = useCallback(async (result: QueryResult) => {
    if (isDemo) throw new ApiError('La exportación auditada solo está disponible en una sesión conectada.', null);
    const payload = await api.exportQuery(String(result.query.id));
    return JSON.stringify(payload, null, 2);
  }, [api, isDemo]);

  const requireAdmin = useCallback(() => {
    if (isDemo || user?.role !== 'admin') {
      throw new ApiError('Esta acción está disponible únicamente para administradores conectados.', 403);
    }
  }, [isDemo, user]);

  const createEdge = useCallback(async (input: {
    cameraId: string; name: string; lat: number; lng: number; cameraModel?: string;
  }) => {
    requireAdmin();
    const created = await api.createEdge(input);
    setDevices((items) => [...items, created]);
    return created;
  }, [api, requireAdmin]);

  const relocateEdge = useCallback(async (deviceId: string, lat: number, lng: number) => {
    requireAdmin();
    const updated = await api.relocateEdge(deviceId, lat, lng);
    setDevices((items) => items.map((device) => device.id === updated.id ? updated : device));
    return updated;
  }, [api, requireAdmin]);

  const recentDetections = useCallback(async (deviceId: string) => {
    requireAdmin();
    return api.recentDetections(deviceId);
  }, [api, requireAdmin]);

  const issueCredential = useCallback(async (cameraId: string, days = 90) => {
    requireAdmin();
    return api.issueCredential(cameraId, days);
  }, [api, requireAdmin]);

  const listCredentials = useCallback(async () => {
    requireAdmin();
    return api.listCredentials();
  }, [api, requireAdmin]);

  const revokeCredential = useCallback(async (credentialId: string) => {
    requireAdmin();
    await api.revokeCredential(credentialId);
  }, [api, requireAdmin]);

  const value: SessionContextValue = {
    restoring, busy, isDemo, user, baseUrl, error, devices, scenarios, history, activeResult,
    login, exploreDemo, logout, saveApiUrl, search,
    openResult: setActiveResult,
    exportResult,
    createEdge, relocateEdge, recentDetections, issueCredential, listCredentials, revokeCredential,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession debe usarse dentro de SessionProvider.');
  return value;
}
