"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AdminPanel } from "./admin-panel";
import { BrandMark } from "./brand";
import type { SessionUser } from "./console-gate";
import { Icon, type IconName } from "./icon";
import { VigiaMap } from "./vigia-map";
import { DEMO_DEVICES, runDemoQuery } from "@/lib/demo-monitoring";
import { COLORS, REPORTED_COLORS, STATUS_LABELS, normalizePlate, unknownColorNote, observationDate, observationTime, percent, validateQuery, vehicleLabel, type Device, type QueryResult, type RouteHop, type Scenario } from "@/lib/monitoring";
import type { RoadGeometry } from "@/lib/road-routing";

type View = "Resumen" | "Cámaras" | "Consultas" | "Administración";
type Source = "loading" | "central" | "offline" | "demo";
type SearchRecord = { result: QueryResult; source: "central" | "demo"; elapsed: number };
const navigation: { label: View; icon: IconName }[] = [
  { label: "Resumen", icon: "grid" },
  { label: "Cámaras", icon: "camera" },
  { label: "Consultas", icon: "queries" },
  { label: "Administración", icon: "key" },
];
const ROLE_LABELS = { operator: "Operador", admin: "Administrador" } as const;
const SOURCE_STATUS: Record<Source, string> = { central: "Servicio central conectado", demo: "Entorno de demostración", loading: "Conectando servicio…", offline: "Servicio central desconectado" };

const radiusLabel = (meters: number) => meters >= 1000 ? `${(meters / 1000).toLocaleString("es-CO")} km` : `${meters} m`;
const colorLabel = (color: string | null | undefined, fallback: string) => COLORS[color ?? ""] ?? color ?? fallback;
const score = (value: number) => Math.round(value * 100);

// Only the scoring database returns cases; elsewhere the list is empty and the picker stays hidden.
function fetchScenarios(signal: AbortSignal): Promise<Scenario[]> {
  return fetch("/api/monitoring/scenarios", { cache: "no-store", signal })
    .then(async (response) => response.ok ? response.json() as Promise<Scenario[]> : [])
    .catch(() => []);
}

/** A 401 means the server-side session ended: reload so the gate asks to sign in again. */
function sessionEnded(response: Response) {
  if (response.status !== 401) return false;
  window.location.reload();
  return true;
}

/** Admin review of one step: the recorte, the plate and «¿Es este el vehículo?». */
function HopEvidence({ hop, busy, onVerdict }: { hop: RouteHop; busy: boolean; onVerdict: (verdict: "match" | "reject" | null) => void }) {
  const [broken, setBroken] = useState(false);
  const verdict = hop.confirmation ?? null;
  return <div className={`hop-evidence ${verdict ?? ""}`}>
    {hop.has_thumbnail && !broken
      ? <Image className="hop-thumb" src={`/api/detections/${hop.detection_id}/thumbnail`} alt={`Recorte del vehículo en ${hop.camera_id}`} width={132} height={99} unoptimized onError={() => setBroken(true)}/>
      : <span className="hop-thumb empty">{broken ? "Recorte vencido" : "Sin recorte"}</span>}
    <div className="hop-question">
      {hop.license_plate && <span className="plate-chip" aria-label={`Placa ${hop.license_plate}`}>{hop.license_plate}</span>}
      <p>¿Es este el vehículo que buscas?</p>
      <div className="verdict-buttons" role="group" aria-label={`Confirmación del paso en ${hop.camera_id}`}>
        <button type="button" className={verdict === "match" ? "selected" : ""} aria-pressed={verdict === "match"} disabled={busy} onClick={() => onVerdict(verdict === "match" ? null : "match")}>Sí, es este</button>
        <button type="button" className={verdict === "reject" ? "selected" : ""} aria-pressed={verdict === "reject"} disabled={busy} onClick={() => onVerdict(verdict === "reject" ? null : "reject")}>No es este</button>
      </div>
    </div>
  </div>;
}

function CountPill({ value, label, tone = "violet" }: { value: ReactNode; label: string; tone?: "violet" | "deep" | "muted" }) {
  return <div className="count-pill"><span className={`count-value ${tone}`}>{value}</span><span>{label}</span></div>;
}

/** `user` null means the anonymous demo: no request reaches the central service. */
export function OperationsConsole({ user }: { user: SessionUser | null }) {
  const [view, setView] = useState<View>("Resumen");
  const [composing, setComposing] = useState(false);
  const [detail, setDetail] = useState<null | "search" | "history">(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [source, setSource] = useState<Source>(user ? "loading" : "demo");
  const [cameras, setCameras] = useState<Device[]>(user ? [] : DEMO_DEVICES);
  const [selectedCamera, setSelectedCamera] = useState("CAM-01");
  const [vehicle, setVehicle] = useState("car");
  const [color, setColor] = useState("white");
  const [date, setDate] = useState(user ? "" : "2026-08-25");
  const [timeFrom, setTimeFrom] = useState("09:20");
  const [timeTo, setTimeTo] = useState("10:30");
  const [radius, setRadius] = useState(2000);
  const [plate, setPlate] = useState("");
  const [confirming, setConfirming] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [searching, setSearching] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [exportError, setExportError] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioId, setScenarioId] = useState("");
  const [record, setRecord] = useState<SearchRecord | null>(null);
  const [history, setHistory] = useState<SearchRecord[]>([]);
  const [historyFilter, setHistoryFilter] = useState("");
  const [routeId, setRouteId] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [resolvedGeometry, setResolvedGeometry] = useState<{ key: string; value: RoadGeometry } | null>(null);
  const connectionRef = useRef<AbortController | null>(null);
  const queryRef = useRef<AbortController | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The admin entry is only a shortcut: the backend still rejects non-admin calls.
  const visibleNavigation = navigation.filter((item) => item.label !== "Administración" || user?.role === "admin");
  const selected = cameras.find((camera) => camera.external_id === selectedCamera) ?? cameras[0];
  const result = record?.result;
  const showingRoute = view === "Consultas" && detail !== null;
  const activeRoute = showingRoute ? result?.routes.find((route) => route.id === routeId) ?? result?.routes[0] : undefined;
  const cameraRoutePoints = useMemo(() => activeRoute?.camera_ids.flatMap((id) => {
    const camera = result?.nearby_devices.find((device) => device.external_id === id);
    return camera ? [{ lat: camera.lat, lng: camera.lng }] : [];
  }) ?? [], [activeRoute, result]);
  const routeGeometryKey = cameraRoutePoints.map(({ lat, lng }) => `${lat},${lng}`).join(";");
  const routeGeometry = activeRoute?.road_geometry ?? (resolvedGeometry?.key === routeGeometryKey ? resolvedGeometry.value : null);
  const routeGeometryLoading = cameraRoutePoints.length > 1 && routeGeometry === null;
  const routePoints = routeGeometry?.points ?? cameraRoutePoints;
  const routeMode = routeGeometryLoading ? "loading" : routeGeometry?.source ?? (cameraRoutePoints.length > 1 ? "camera-chord" : "none");
  const physical = cameras.filter((camera) => camera.kind === "physical").length;
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    connectionRef.current = controller;
    fetch("/api/monitoring/devices", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (sessionEnded(response) || !response.ok) throw new Error(); return response.json() as Promise<Device[]>; })
      .then((devices) => { setCameras(devices); setSource("central"); setSelectedCamera(devices[0]?.external_id ?? ""); setUpdatedAt(observationTime(new Date().toISOString())); fetchScenarios(controller.signal).then(setScenarios); })
      .catch(() => { if (!controller.signal.aborted) setSource("offline"); })
      .finally(() => { if (!controller.signal.aborted) setDate(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())); });
    return () => { controller.abort(); queryRef.current?.abort(); };
  }, [user]);

  useEffect(() => {
    if (cameraRoutePoints.length < 2 || activeRoute?.road_geometry) return;
    const controller = new AbortController();
    fetch("/api/monitoring/route-geometry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: cameraRoutePoints }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<RoadGeometry>;
      })
      .then((geometry) => setResolvedGeometry({ key: routeGeometryKey, value: geometry }))
      .catch(() => { if (!controller.signal.aborted) setResolvedGeometry({ key: routeGeometryKey, value: { points: cameraRoutePoints, source: "camera-chord", distance_m: null } }); });
    return () => controller.abort();
  }, [cameraRoutePoints, routeGeometryKey, activeRoute?.road_geometry]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [menuOpen]);

  async function connect() {
    connectionRef.current?.abort();
    const controller = new AbortController();
    connectionRef.current = controller;
    setConnecting(true);
    setConnectionError("");
    try {
      const response = await fetch("/api/monitoring/devices", { cache: "no-store", signal: controller.signal });
      if (sessionEnded(response)) return;
      if (!response.ok) throw new Error("El servicio central no está disponible. Puedes explorar la consola en modo demostración.");
      const devices = await response.json() as Device[];
      setCameras(devices);
      setSource("central");
      setSelectedCamera(devices[0]?.external_id ?? "");
      fetchScenarios(controller.signal).then(setScenarios);
      setRecord(null);
      setHistory([]);
      setDetail(null);
      setError("");
      setUpdatedAt(observationTime(new Date().toISOString()));
    } catch (error) {
      if (!controller.signal.aborted) {
        setConnectionError(error instanceof Error ? error.message : "No se pudo conectar.");
        if (source !== "demo") setSource("offline");
      }
    } finally {
      if (!controller.signal.aborted) setConnecting(false);
    }
  }

  function applyScenario(id: string) {
    setScenarioId(id);
    const scenario = scenarios.find((item) => item.id === id);
    if (!scenario) return;
    setSelectedCamera(scenario.camera_id);
    setDate(scenario.date);
    setTimeFrom(scenario.time_from);
    setTimeTo(scenario.time_to);
    setVehicle(scenario.vehicle_type ?? "");
    setColor(scenario.color ?? "");
    setRadius(scenario.radius_m);
  }

  function loadScenario() { setDate("2026-08-25"); setTimeFrom("09:20"); setTimeTo("10:30"); setVehicle("car"); setColor("white"); setRadius(2000); setSelectedCamera("CAM-01"); }

  function openDemo() {
    connectionRef.current?.abort();
    setConnecting(false);
    setSource("demo");
    setCameras(DEMO_DEVICES);
    setRecord(null);
    setHistory([]);
    setDetail(null);
    setError("");
    setConnectionError("");
    loadScenario();
  }

  function go(next: View) {
    setView(next);
    setDetail(null);
    setMenuOpen(false);
  }

  function compose() {
    setView("Resumen");
    setDetail(null);
    setComposing(true);
  }

  function back() {
    if (view === "Consultas" && detail === "search") compose();
    else if (view === "Consultas" && detail === "history") setDetail(null);
    else if (view === "Resumen") setComposing(false);
    else go("Resumen");
  }

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searching || !selected || source !== "central" && source !== "demo") return;
    setError("");
    setRecord(null);
    const start = performance.now();
    const controller = new AbortController();
    queryRef.current = controller;
    try {
      const input = validateQuery({ lat: selected.lat, lng: selected.lng, radius_m: radius, time_from: `${date}T${timeFrom}:00-05:00`, time_to: `${date}T${timeTo}:00-05:00`, ...(vehicle ? { vehicle_type: vehicle } : {}), ...(color ? { color } : {}), ...(isAdmin && plate.trim() ? { plate } : {}) });
      setSearching(true);
      let data: QueryResult;
      if (source === "demo") data = runDemoQuery(input);
      else {
        const response = await fetch("/api/monitoring/queries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.signal });
        if (sessionEnded(response)) return;
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "No fue posible ejecutar la consulta.");
        data = body;
      }
      const next = { result: data, source, elapsed: (performance.now() - start) / 1000 };
      setRecord(next);
      setHistory((current) => [next, ...current].slice(0, 20));
      setRouteId(data.routes[0]?.id ?? "");
      setView("Consultas");
      setDetail("search");
      window.scrollTo({ top: 0 });
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "No fue posible ejecutar la consulta.");
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  /** Sends an admin's verdict; the backend recalculates this query's routes and returns them. */
  async function confirmHop(hop: RouteHop, verdict: "match" | "reject" | null) {
    if (!record || record.source !== "central" || confirming) return;
    setConfirming(hop.detection_id);
    setConfirmError("");
    try {
      const response = await fetch(`/api/monitoring/queries/${record.result.query.id}/confirmations/${hop.detection_id}`, verdict
        ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verdict }) }
        : { method: "DELETE" });
      if (sessionEnded(response)) return;
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No fue posible guardar la confirmación.");
      const next = { ...record, result: body as QueryResult };
      setRecord(next);
      setHistory((current) => current.map((item) => item === record ? next : item));
      // Keep looking at the same cameras when that route survives the recalculation.
      const ids = (hops: RouteHop[] = []) => hops.map((item) => item.detection_id).join();
      const same = next.result.routes.find((route) => ids(route.detections) === ids(activeRoute?.detections));
      setRouteId(same?.id ?? next.result.routes[0]?.id ?? "");
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : "No fue posible guardar la confirmación.");
    } finally {
      setConfirming("");
    }
  }

  async function exportResult() {
    if (!record) return;
    let payload: unknown = { source: record.source, timezone: "America/Bogota", notice: "Trayectorias estimadas; no constituyen una identificación confirmada.", ...record.result };
    if (record.source === "central") {
      // Central exports are built and audited by the backend from what it persisted.
      setExportError("");
      try {
        const response = await fetch(`/api/monitoring/queries/${record.result.query.id}/export`, { method: "POST" });
        if (sessionEnded(response)) return;
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "No fue posible exportar la consulta.");
        payload = { source: "central", ...body };
      } catch (error) {
        setExportError(error instanceof Error ? error.message : "No fue posible exportar la consulta.");
        return;
      }
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vigia-${record.result.query.id}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.reload();
  }

  const title = view === "Cámaras" ? "Dispositivos de la red." : view === "Administración" ? "Auditoría y credenciales." : view === "Consultas" ? detail ? "Trayectorias estimadas." : "Registros de búsqueda." : composing ? "Nueva consulta." : "Tu red, de un vistazo.";
  const canGoBack = view !== "Resumen" || composing;

  const sourceCard = <section className={`source-card ${source}`} aria-labelledby="source-title">
    <Icon name={source === "central" ? "activity" : source === "loading" ? "refresh" : "alert"} size={26}/>
    <h2 id="source-title">{source === "central" ? "Datos del servicio central" : source === "demo" ? "Modo demostración · datos de ejemplo" : source === "loading" ? "Conectando tu red de cámaras" : "Servicio central sin respuesta"}</h2>
    <p>{source === "central" ? `Última lectura de dispositivos: ${updatedAt}. Los nodos simulados conservan su etiqueta.` : source === "demo" ? "Escenario del 25 de agosto de 2026. Las rutas y sus puntajes son ilustrativos." : source === "loading" ? "Consultando los dispositivos registrados…" : "Reintenta la conexión o explora un escenario de prueba."}</p>
    <div className="source-actions">
      {source === "offline" && <button className="pill-light" onClick={openDemo}>Explorar demo</button>}
      {source !== "loading" && <button className="pill-muted" disabled={connecting || searching} onClick={connect}>{connecting ? <><span className="spinner"/>Conectando…</> : source === "central" ? "Actualizar red" : "Conectar servicio"}</button>}
    </div>
    {connectionError && <p className="error-message" role="alert">{connectionError}</p>}
  </section>;

  const queryForm = <form className="query-card" id="query-form" onSubmit={search} aria-labelledby="query-title">
    <h2 id="query-title" className="visually-hidden">Buscar un vehículo</h2>
    <fieldset disabled={searching || connecting || source === "loading" || source === "offline"}>
      <label className="line-field">Punto de búsqueda<span className="select-wrap"><select value={selected?.external_id ?? ""} onChange={(event) => setSelectedCamera(event.target.value)} required>{!cameras.length && <option value="">Sin dispositivos</option>}{cameras.map((camera) => <option key={camera.id} value={camera.external_id}>{camera.external_id} · {camera.name}</option>)}</select><Icon name="chevron" size={18}/></span></label>
      <div className="field-row">
        <label className="line-field">Vehículo<span className="select-wrap"><select value={vehicle} onChange={(event) => setVehicle(event.target.value)}><option value="">Todos</option><option value="car">Automóvil</option><option value="motorcycle">Motocicleta</option></select><Icon name="chevron" size={18}/></span></label>
        <label className="line-field">Color<span className="select-wrap"><select value={color} onChange={(event) => setColor(event.target.value)}><option value="">Todos</option>{REPORTED_COLORS.map((key) => <option key={key} value={key}>{COLORS[key]}</option>)}{color && !REPORTED_COLORS.includes(color) && <option value={color}>{COLORS[color] ?? color}</option>}</select><Icon name="chevron" size={18}/></span></label>
      </div>
      {isAdmin && <label className="line-field plate-field">Placa · opcional, solo admin<input value={plate} onChange={(event) => setPlate(event.target.value.toUpperCase())} placeholder="ABC123" autoComplete="off" spellCheck={false} maxLength={8} aria-invalid={plate.trim() !== "" && !normalizePlate(plate)}/></label>}
      <label className="line-field">Fecha · hora de Colombia<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required/></label>
      <div className="field-row">
        <label className="line-field">Desde<input type="time" value={timeFrom} onChange={(event) => setTimeFrom(event.target.value)} required/></label>
        <label className="line-field">Hasta<input type="time" value={timeTo} onChange={(event) => setTimeTo(event.target.value)} required/></label>
      </div>
      <label className="radius-label">Radio de búsqueda<output>{radiusLabel(radius)}</output>
        <input type="range" min="100" max="5000" step="100" value={radius} onChange={(event) => setRadius(Number(event.target.value))} style={{ "--fill": `${(radius - 100) / 49}%` } as React.CSSProperties}/>
      </label>
      <div className="range-ticks" aria-hidden="true"><span>100 m</span><span>5 km</span></div>
      <div className="query-actions">
        <button className="pill-light" type="submit" disabled={!selected}>{searching ? <><span className="spinner"/>Buscando coincidencias…</> : <><Icon name="search" size={17}/>{source === "demo" ? "Buscar en la demostración" : "Buscar coincidencias"}</>}</button>
        {scenarios.length ? <label className="line-field scenario-picker">Caso del dataset de pruebas<span className="select-wrap"><select value={scenarioId} onChange={(event) => applyScenario(event.target.value)}><option value="">Elige un caso para llenar el formulario</option>{scenarios.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.title}</option>)}</select><Icon name="chevron" size={18}/></span></label>
          : <button className="text-link" type="button" onClick={loadScenario}>Cargar escenario de prueba · 25 ago.</button>}
      </div>
    </fieldset>
    {error && <p className="error-message" role="alert">{error}</p>}
    <p className="form-help"><Icon name="shield" size={16}/>La consulta cruza metadatos de las cámaras dentro del radio. El video no sale de los nodos.</p>
  </form>;

  const routePanel = <article className="routes-card" aria-busy={searching} aria-labelledby="route-title">
    {result && <header className="route-head">
      <span className="vehicle-badge"><Icon name={(activeRoute?.vehicle_type ?? result.query.vehicle_type) === "motorcycle" ? "motorcycle" : "car"} size={30}/></span>
      <div>
        <h2 id="route-title">{activeRoute ? `${vehicleLabel(activeRoute.vehicle_type)} · ${colorLabel(activeRoute.color, "Color desconocido")}` : result.query.vehicle_type ? vehicleLabel(result.query.vehicle_type) : "Todos los vehículos"}</h2>
        <p>{observationDate(result.query.time_from)} · {observationTime(result.query.time_from)}–{observationTime(result.query.time_to)} · UTC−5 · Radio {result.query.radius_m} m</p>
      </div>
      {activeRoute && <span className="route-score"><b>{score(activeRoute.confidence)}</b>Puntaje / 100</span>}
    </header>}
    <div className="result-announcement" role="status" aria-live="polite">{searching ? "Consultando cámaras cercanas…" : result ? `${result.candidate_detection_count} detecciones · ${result.routes.length} rutas candidatas · ${record?.source === "demo" ? "Demostración" : "Servicio central"}` : "Los resultados aparecerán después de una búsqueda."}</div>
    <div className="route-tools">
      <button className="pill-outline" type="button" onClick={compose}><Icon name="search" size={16}/>Ajustar consulta</button>
      {record && <button className="round-button small" onClick={exportResult} aria-label="Exportar resultados JSON" title="Exportar resultados JSON"><Icon name="download" size={18}/></button>}
    </div>
    {exportError && <p className="error-message" role="alert">{exportError}</p>}
    {activeRoute ? <>
      <div className="route-options" role="group" aria-label="Rutas candidatas">{result?.routes.map((route) => <button key={route.id} aria-pressed={activeRoute.id === route.id} className={activeRoute.id === route.id ? "selected" : ""} onClick={() => setRouteId(route.id)}><Icon name="route" size={16}/>Ruta {route.rank}<small>{score(route.confidence)}/100</small></button>)}</div>
      <p className={`route-caution ${activeRoute.has_distant_gaps ? "warning" : ""}`}><Icon name={activeRoute.has_distant_gaps ? "alert" : "shield"} size={17}/>{activeRoute.has_distant_gaps ? "Hay tramos distantes sin observaciones intermedias. Revisa las rutas alternativas." : "La ruta une observaciones y expresa una estimación, no una identificación confirmada."}</p>
      {activeRoute.explanation?.shares_with_rank && <p className="route-caution"><Icon name="route" size={17}/>Comparte observaciones con la ruta {activeRoute.explanation.shares_with_rank}: es otra forma de unir al mismo vehículo, no un vehículo distinto.</p>}
      <h3 className="route-subtitle">Recorrido · {activeRoute.camera_ids.length} pasos por cámaras{unknownColorNote(activeRoute)}</h3>
      {isAdmin && record?.source === "central" && <p className="route-caution"><Icon name="shield" size={17}/>Los recortes y las placas son datos personales: duran 7 días y cada vista queda en la auditoría. Al confirmar, las rutas se recalculan.</p>}
      {confirmError && <p className="error-message" role="alert">{confirmError}</p>}
      <ol className="timeline">{activeRoute.detections.map((hop, index) => <li key={hop.detection_id} className={hop.confirmation ?? ""}>
        <span className="timeline-dot">{hop.confirmation === "match" ? <Icon name="check" size={18}/> : index + 1}</span>
        <div><b>{result?.nearby_devices.find((device) => device.external_id === hop.camera_id)?.name ?? hop.camera_id}</b><small>{hop.camera_id} · {hop.direction.replaceAll("-", " ")}{hop.confirmation === "match" ? " · confirmado" : ""}</small></div>
        <div className="hop-time"><b>{observationTime(hop.observed_at)}</b><small>{percent(hop.confidence)} coincidencia</small></div>
        {isAdmin && record?.source === "central" && <HopEvidence hop={hop} busy={confirming !== ""} onVerdict={(verdict) => confirmHop(hop, verdict)}/>}
      </li>)}</ol>
      {activeRoute.explanation?.segments && <details className="route-evidence" key={activeRoute.id}>
        <summary><Icon name="chevron" size={18}/>¿Por qué aparece esta ruta?</summary>
        <p>Es un puntaje de compatibilidad, no una probabilidad de identificación. Compara tiempos, detecciones y alternativas viales.</p>
        <dl>{Object.entries(activeRoute.explanation.weights).map(([key, value]) => <div key={key}><dt>{{ detection: "Calidad de detección", time: "Compatibilidad temporal", appearance: "Apariencia disponible", road: "Costo vial" }[key] ?? key}</dt><dd>{percent(value)}</dd></div>)}</dl>
        <ol>{activeRoute.explanation.segments.map((segment, index) => <li key={index}>
          <b>{segment.from_camera} → {segment.to_camera} · alternativa {segment.option_index + 1}</b>
          <span>{Math.round(segment.distance_m)} m · {Math.round(segment.observed_seconds)} s observados / {Math.round(segment.expected_seconds)} s de referencia</span>
          <span>Puntaje del tramo: {score(segment.score)}/100. {segment.source === "osrm" ? "Red vial OSRM." : "Enlace no verificado; referencia de velocidad supuesta."}{segment.gap_penalty < 1 ? " Penalización por tramo sin observaciones intermedias." : ""}</span>
        </li>)}</ol>
        <p>Agregación geométrica de tramos + {score(activeRoute.explanation.coverage_bonus)} puntos por observaciones adicionales. Dirección de imagen no usada: falta calibrar cámaras.{activeRoute.explanation.search_pruned ? " Búsqueda acotada: pueden existir otras candidatas." : ""}</p>
      </details>}
    </> : <div className="empty-state">
      <Icon name="route" size={30}/>
      <b>{searching ? "Reconstruyendo las señales" : result ? "Sin trayectorias para estos filtros" : "Cada señal cuenta una parte"}</b>
      <p>{result ? "Prueba otro color, amplía el radio o ajusta el horario. Una detección aislada puede no formar una ruta." : "Busca un vehículo para conectar sus detecciones y explorar sus posibles recorridos."}</p>
    </div>}
  </article>;

  const historyFiltered = history.filter((item) => {
    const text = `${vehicleLabel(item.result.query.vehicle_type ?? "car")} ${colorLabel(item.result.query.color, "")} ${observationDate(item.result.query.time_from)}`.toLowerCase();
    return text.includes(historyFilter.toLowerCase());
  });
  const historyPanel = <section className="history-card" aria-labelledby="history-title">
    <h2 id="history-title">Historial de consultas <span className="count-badge">{history.length}</span></h2>
    {history.length ? historyFiltered.length ? <div className="history-list">{historyFiltered.map((item) => <button key={item.result.query.id} className={record === item ? "selected" : ""} onClick={() => { setRecord(item); setRouteId(item.result.routes[0]?.id ?? ""); setDetail("history"); }}>
      <span className="history-icon"><Icon name={item.result.query.vehicle_type === "motorcycle" ? "motorcycle" : "car"} size={26}/></span>
      <span className="history-main"><b>{item.result.query.vehicle_type ? vehicleLabel(item.result.query.vehicle_type) : "Todos los vehículos"} · {colorLabel(item.result.query.color, "Todos los colores")}</b><small>{observationDate(item.result.query.time_from)} · {observationTime(item.result.query.time_from)}–{observationTime(item.result.query.time_to)} · Radio {radiusLabel(item.result.query.radius_m)}</small></span>
      <span className="history-meta"><small>{item.source === "demo" ? "Demostración" : "Servicio central"}</small><span><Icon name="route" size={15}/>{item.result.routes.length} rutas</span></span>
    </button>)}</div> : <p className="empty-inline">Ninguna consulta coincide con «{historyFilter}».</p>
      : <div className="empty-state"><Icon name="history" size={30}/><b>Aún no hay consultas</b><p>Las búsquedas de esta sesión aparecerán aquí, hasta las últimas 20.</p><button className="pill-light" onClick={compose}>Crear una consulta<Icon name="arrow" size={16}/></button></div>}
  </section>;

  const filteredCameras = cameras.filter((camera) => `${camera.name} ${camera.external_id}`.toLowerCase().includes(deviceFilter.toLowerCase()));
  const devicesPanel = <section className="devices-card" aria-labelledby="devices-title">
    <h2 id="devices-title">Red de cámaras</h2>
    <div className="device-list">{filteredCameras.map((camera) => <button key={camera.id} aria-pressed={selected?.external_id === camera.external_id} className={selected?.external_id === camera.external_id ? "selected" : ""} onClick={() => setSelectedCamera(camera.external_id)}>
      <span className={`camera-glyph ${camera.kind}`}><Icon name="camera" size={24}/></span>
      <span className="device-info"><b>{camera.name}</b><small>{camera.external_id} · {camera.kind === "physical" ? "Cámara física" : "Nodo simulado"}</small><span className={`device-status ${camera.status}`}><i/>{STATUS_LABELS[camera.status] ?? camera.status}</span></span>
    </button>)}</div>
    {!filteredCameras.length && <p className="empty-inline">{cameras.length ? `Ninguna cámara coincide con «${deviceFilter}».` : "No hay cámaras disponibles. Conecta el servicio central o abre la demostración."}</p>}
    <p className="form-help"><Icon name="shield" size={15}/>El estado corresponde al registro del dispositivo; no prueba que la transmisión esté disponible.</p>
  </section>;

  const mapPanel = <section className="map-card" aria-label="Mapa de operaciones">
    <VigiaMap cameras={cameras} selectedId={selected?.external_id ?? ""} onSelect={setSelectedCamera} routePoints={routePoints} routeMode={routeMode} radius={showingRoute && result ? result.query.radius_m : radius} center={showingRoute && result ? result.query : selected}
      caption={routeMode === "loading" ? "Ajustando el recorrido a la red vial…" : routeMode === "road-network" ? `Geometría vial OSRM · ${activeRoute?.road_geometry ? "alternativa evaluada" : "solo referencia visual"}${routeGeometry?.distance_m ? ` · ${(routeGeometry.distance_m / 1000).toFixed(2)} km` : ""}` : routeMode === "camera-chord" ? "Estimación directa; enrutador vial no disponible" : "Selecciona un nodo para explorar"}/>
  </section>;

  const legend = <div className="legend" aria-label="Leyenda del mapa"><span><i className="physical"/>Física</span><span><i className="simulated"/>Simulada</span><span><i className="offline"/>Sin conexión</span></div>;
  const camerasPill = <CountPill value={cameras.length} label="Cámaras registradas"/>;
  const resultPills = <>
    <CountPill value={result?.candidate_detection_count ?? 0} label="Detecciones candidatas" tone={result ? "violet" : "muted"}/>
    <CountPill value={result?.routes.length ?? 0} label="Rutas posibles" tone={result ? "violet" : "muted"}/>
    {record && <p className="aside-note"><Icon name="clock" size={15}/>Consulta resuelta en {record.elapsed < .01 ? "menos de 0,01" : record.elapsed.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s · {record.source === "demo" ? "procesamiento local de ejemplo" : "medido desde esta consola"}</p>}
  </>;

  let stage: ReactNode;
  if (view === "Administración" && user?.role === "admin") stage = <div className="stage single"><AdminPanel cameras={cameras}/></div>;
  else if (view === "Cámaras") stage = <div className="stage">
    <div className="stage-main">
      <label className="search-pill"><Icon name="search" size={22}/><input aria-label="Filtrar cámaras" placeholder="Buscar nombre o identificador…" value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}/></label>
      {devicesPanel}
    </div>
    <aside className="stage-aside" aria-label="Estado de la red">
      {camerasPill}
      {sourceCard}
      <section className="camera-selection" aria-label="Cámara seleccionada"><Icon name="target" size={26}/><h2>Seleccionada</h2><p>{selected ? <><b>{selected.name}</b><span>{selected.external_id} · {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}</span></> : "Ninguna"}</p></section>
    </aside>
    {mapPanel}
  </div>;
  else if (view === "Consultas") stage = <div className={`stage ${detail ? "result-stage" : ""}`}>
    <div className="stage-main">
      {detail ? routePanel : <><label className="search-pill"><Icon name="search" size={22}/><input aria-label="Buscar consulta" placeholder="Buscar consulta…" value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}/></label>{historyPanel}</>}
    </div>
    <aside className="stage-aside" aria-label="Resumen de la consulta">{camerasPill}{sourceCard}{resultPills}</aside>
    {mapPanel}
  </div>;
  else stage = <div className="stage">
    <div className="stage-main">
      <button type="button" className={`search-pill launcher ${composing ? "open" : ""}`} aria-expanded={composing} aria-controls="query-form" onClick={() => setComposing((open) => !open)}>
        <Icon name="search" size={22}/><span>Nueva consulta</span>{composing && <Icon name="close" size={18}/>}
      </button>
      {composing ? queryForm : source !== "central" && sourceCard}
    </div>
    <aside className="stage-aside" aria-label="Estado de la red">
      {camerasPill}
      {composing && <>{source === "central" && sourceCard}<CountPill value={cameras.length} label="Nodos en el mapa" tone="deep"/>{legend}</>}
      {!composing && <p className="aside-note"><Icon name="camera" size={15}/>{physical} físicas · {cameras.length - physical} simuladas</p>}
    </aside>
    {mapPanel}
  </div>;

  const initials = user ? user.display_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() : "DE";

  return <div className="app-shell">
    <a className="skip-link" href="#workspace">Saltar al contenido</a>
    <aside className="rail">
      <button type="button" className="rail-brand" onClick={() => go("Resumen")} aria-label="VIGÍA, resumen"><BrandMark size={50}/></button>
      <nav className="rail-nav" aria-label="Navegación principal">{visibleNavigation.map((item) => <button key={item.label} aria-current={view === item.label ? "page" : undefined} className={view === item.label ? "active" : ""} onClick={() => go(item.label)}>
        <span className="rail-icon"><Icon name={item.icon} size={20}/></span><span>{item.label}</span>
      </button>)}</nav>
    </aside>
    <div className="workspace" id="workspace">
      <header className="topbar">
        <BrandMark size={34}/>
        <div className="account" ref={menuRef}>
          <span className="account-name">{user?.display_name ?? "Demostración"}</span>
          <button type="button" className="round-button small" aria-label="Cuenta" aria-expanded={menuOpen} aria-controls="account-menu" onClick={() => setMenuOpen((open) => !open)}><Icon name="user" size={20}/></button>
          <span className="avatar" aria-hidden="true">{initials}</span>
          {menuOpen && <div className="account-menu" id="account-menu">
            <b>{user?.display_name ?? "Demostración"}</b>
            <small>{user ? `${ROLE_LABELS[user.role]} · ${user.email}` : "Sin sesión · datos de ejemplo"}</small>
            {user ? <button type="button" className="pill-muted" onClick={logout}><Icon name="logout" size={17}/>Cerrar sesión</button> : <button type="button" className="pill-light" onClick={() => { window.history.replaceState(null, "", "/?entrar=1"); window.location.reload(); }}>Iniciar sesión</button>}
          </div>}
        </div>
      </header>
      <div className="title-row">
        <button type="button" className="round-button" onClick={back} disabled={!canGoBack} aria-label="Volver"><Icon name="back" size={24}/></button>
        <h1>{title}</h1>
        <div className={`network-pill ${source}`} role="status"><span className="network-icon"><Icon name="signal" size={22}/></span><span><b>Red Barranquilla</b><small>{SOURCE_STATUS[source]}</small></span></div>
      </div>
      <main>{stage}</main>
      <footer className="workspace-footer"><span>VIGÍA · Barranquilla, Colombia · UTC−5</span><span>Trayectorias estimadas, no identificaciones confirmadas.</span></footer>
    </div>
  </div>;
}
