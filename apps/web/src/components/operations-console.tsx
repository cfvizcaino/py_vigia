"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AdminPanel } from "./admin-panel";
import { CameraPreview } from "./camera-preview";
import type { SessionUser } from "./console-gate";
import { Icon, type IconName } from "./icon";
import { VigiaMap } from "./vigia-map";
import { DEMO_DEVICES, runDemoQuery } from "@/lib/demo-monitoring";
import { COLORS, STATUS_LABELS, observationDate, observationTime, percent, validateQuery, vehicleLabel, type Device, type QueryResult } from "@/lib/monitoring";
import type { RoadGeometry } from "@/lib/road-routing";

type View = "Resumen" | "Cámaras" | "Consultas" | "Trayectorias" | "Administración";
type Source = "loading" | "central" | "offline" | "demo";
type SearchRecord = { result: QueryResult; source: "central" | "demo"; elapsed: number };
const navigation: { label: View; icon: IconName; detail: string }[] = [
  { label: "Resumen", icon: "grid", detail: "Tu red, de un vistazo" },
  { label: "Cámaras", icon: "camera", detail: "Dispositivos y transmisión" },
  { label: "Consultas", icon: "search", detail: "Encuentra coincidencias" },
  { label: "Trayectorias", icon: "route", detail: "Explora los recorridos" },
  { label: "Administración", icon: "key", detail: "Auditoría y credenciales de nodos" },
];

function DevicesCard({ cameras, selected, onSelect }: { cameras: Device[]; selected: string; onSelect: (id: string) => void }) {
  return <article className="panel devices-card">
    <div className="card-heading"><div><span className="section-kicker">Infraestructura colaborativa</span><h2>Red de cámaras <span className="count-badge">{cameras.length}</span></h2></div><Icon name="camera"/></div>
    <div className="device-list">{cameras.map((camera) => <button key={camera.id} aria-pressed={selected === camera.external_id} className={selected === camera.external_id ? "selected" : ""} onClick={() => onSelect(camera.external_id)}>
      <span className={`camera-dot ${camera.kind}`}><Icon name="camera"/></span>
      <span className="device-info"><b>{camera.name}</b><small>{camera.external_id} · {camera.kind === "physical" ? "Cámara física" : "Nodo simulado"}</small></span>
      <span className={`device-status ${camera.status}`}><i/>{STATUS_LABELS[camera.status] ?? camera.status}</span>
    </button>)}</div>
    {!cameras.length && <div className="empty-state">No hay cámaras disponibles. Conecta el servicio central o abre la demostración.</div>}
    <div className="panel-footnote"><Icon name="shield" size={14}/>El estado corresponde al registro del dispositivo.</div>
  </article>;
}

const ROLE_LABELS = { operator: "Operador", admin: "Administrador" } as const;

/** A 401 means the server-side session ended: reload so the gate asks to sign in again. */
function sessionEnded(response: Response) {
  if (response.status !== 401) return false;
  window.location.reload();
  return true;
}

/** `user` null means the anonymous demo: no request reaches the central service. */
export function OperationsConsole({ user }: { user: SessionUser | null }) {
  const [view, setView] = useState<View>("Resumen");
  const [source, setSource] = useState<Source>(user ? "loading" : "demo");
  const [cameras, setCameras] = useState<Device[]>(user ? [] : DEMO_DEVICES);
  const [selectedCamera, setSelectedCamera] = useState("CAM-01");
  const [vehicle, setVehicle] = useState("car");
  const [color, setColor] = useState("white");
  const [date, setDate] = useState(user ? "" : "2026-08-25");
  const [timeFrom, setTimeFrom] = useState("09:20");
  const [timeTo, setTimeTo] = useState("10:30");
  const [radius, setRadius] = useState(2000);
  const [searching, setSearching] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [exportError, setExportError] = useState("");
  const [record, setRecord] = useState<SearchRecord | null>(null);
  const [history, setHistory] = useState<SearchRecord[]>([]);
  const [routeId, setRouteId] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [resolvedGeometry, setResolvedGeometry] = useState<{ key: string; value: RoadGeometry } | null>(null);
  const connectionRef = useRef<AbortController | null>(null);
  const queryRef = useRef<AbortController | null>(null);
  // The admin entry is only a shortcut: the backend still rejects non-admin calls.
  const visibleNavigation = navigation.filter((item) => item.label !== "Administración" || user?.role === "admin");
  const selected = cameras.find((camera) => camera.external_id === selectedCamera) ?? cameras[0];
  const result = record?.result;
  const activeRoute = result?.routes.find((route) => route.id === routeId) ?? result?.routes[0];
  const cameraRoutePoints = useMemo(() => activeRoute?.camera_ids.flatMap((id) => {
    const camera = result?.nearby_devices.find((device) => device.external_id === id);
    return camera ? [{ lat: camera.lat, lng: camera.lng }] : [];
  }) ?? [], [activeRoute, result]);
  const routeGeometryKey = cameraRoutePoints.map(({ lat, lng }) => `${lat},${lng}`).join(";");
  const routeGeometry = activeRoute?.road_geometry ?? (resolvedGeometry?.key === routeGeometryKey ? resolvedGeometry.value : null);
  const routeGeometryLoading = cameraRoutePoints.length > 1 && routeGeometry === null;
  const routePoints = routeGeometry?.points ?? cameraRoutePoints;
  const routeMode = routeGeometryLoading ? "loading" : routeGeometry?.source ?? (cameraRoutePoints.length > 1 ? "camera-chord" : "none");

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    connectionRef.current = controller;
    fetch("/api/monitoring/devices", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (sessionEnded(response) || !response.ok) throw new Error(); return response.json() as Promise<Device[]>; })
      .then((devices) => { setCameras(devices); setSource("central"); setSelectedCamera(devices[0]?.external_id ?? ""); setUpdatedAt(observationTime(new Date().toISOString())); })
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
      setRecord(null);
      setHistory([]);
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

  function loadScenario() { setDate("2026-08-25"); setTimeFrom("09:20"); setTimeTo("10:30"); setVehicle("car"); setColor("white"); setRadius(2000); setSelectedCamera("CAM-01"); }

  function openDemo() {
    connectionRef.current?.abort();
    setConnecting(false);
    setSource("demo");
    setCameras(DEMO_DEVICES);
    setRecord(null);
    setHistory([]);
    setError("");
    setConnectionError("");
    loadScenario();
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
      const input = validateQuery({ lat: selected.lat, lng: selected.lng, radius_m: radius, time_from: `${date}T${timeFrom}:00-05:00`, time_to: `${date}T${timeTo}:00-05:00`, ...(vehicle ? { vehicle_type: vehicle } : {}), ...(color ? { color } : {}) });
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
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "No fue posible ejecutar la consulta.");
    } finally {
      if (!controller.signal.aborted) setSearching(false);
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

  const queryForm = <form className="panel query-card" onSubmit={search}>
    <div className="card-heading"><div><span className="section-kicker">Cruza las señales</span><h2>Buscar un vehículo</h2></div><span className="query-icon"><Icon name="search"/></span></div>
    <div className="query-fields">
      <fieldset disabled={searching || connecting || source === "loading" || source === "offline"}>
        <label>Punto de búsqueda<select value={selected?.external_id ?? ""} onChange={(event) => setSelectedCamera(event.target.value)} required>{!cameras.length && <option value="">Sin dispositivos</option>}{cameras.map((camera) => <option key={camera.id} value={camera.external_id}>{camera.external_id} · {camera.name}</option>)}</select></label>
        <div className="field-row"><label>Vehículo<select value={vehicle} onChange={(event) => setVehicle(event.target.value)}><option value="">Todos</option><option value="car">Automóvil</option><option value="motorcycle">Motocicleta</option></select></label><label>Color<select value={color} onChange={(event) => setColor(event.target.value)}><option value="">Todos</option>{Object.entries(COLORS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        <label>Fecha · hora de Colombia<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required/></label>
        <div className="field-row"><label>Desde<input type="time" value={timeFrom} onChange={(event) => setTimeFrom(event.target.value)} required/></label><label>Hasta<input type="time" value={timeTo} onChange={(event) => setTimeTo(event.target.value)} required/></label></div>
        <label className="radius-label">Radio de búsqueda<output>{radius >= 1000 ? `${(radius / 1000).toLocaleString("es-CO")} km` : `${radius} m`}</output><input type="range" min="100" max="5000" step="100" value={radius} onChange={(event) => setRadius(Number(event.target.value))}/></label>
        <div className="range-ticks"><span>100 m</span><span>5 km</span></div>
        <button className="primary-action" type="submit" disabled={!selected}>{searching ? <><span className="spinner"/>Buscando coincidencias…</> : <><Icon name="search" size={17}/>{source === "demo" ? "Buscar en la demostración" : "Buscar coincidencias"}<Icon name="arrow" size={17}/></>}</button>
        <button className="text-action scenario-action" type="button" onClick={loadScenario}>Cargar escenario de prueba · 25 ago.</button>
      </fieldset>
      {error && <p className="error-message" role="alert">{error}</p>}
      <p className="form-help"><Icon name="shield" size={15}/>La consulta cruza metadatos de las cámaras dentro del radio seleccionado.</p>
    </div>
  </form>;

  const routePanel = <article className="panel routes-card" aria-busy={searching}>
    <div className="card-heading"><div><span className="section-kicker">Reconstrucción de recorrido</span><h2>Trayectorias estimadas</h2></div>{record && <button className="icon-button" onClick={exportResult} aria-label="Exportar resultados JSON" title="Exportar resultados JSON"><Icon name="download" size={18}/></button>}</div>
    {exportError && <p className="error-message export-error" role="alert">{exportError}</p>}
    <div className="result-announcement" role="status" aria-live="polite">{searching ? "Consultando cámaras cercanas…" : result ? `${result.candidate_detection_count} detecciones · ${result.routes.length} rutas candidatas · ${record?.source === "demo" ? "Demostración" : "Servicio central"}` : "Los resultados aparecerán después de una búsqueda."}</div>
    {result && <div className="result-context">{observationDate(result.query.time_from)} · {observationTime(result.query.time_from)}–{observationTime(result.query.time_to)} · UTC−5 · Radio {result.query.radius_m} m</div>}
    {activeRoute ? <>
      <div className="route-options" aria-label="Rutas candidatas">{result?.routes.map((route) => <button key={route.id} aria-pressed={activeRoute.id === route.id} className={activeRoute.id === route.id ? "selected" : ""} onClick={() => setRouteId(route.id)}><Icon name="route" size={16}/>Ruta {route.rank}<span>{Math.round(route.confidence * 100)}/100</span></button>)}</div>
      <div className="route-summary"><span className="vehicle-illustration"><Icon name={activeRoute.vehicle_type === "car" ? "car" : "route"} size={30}/></span><div><b>{vehicleLabel(activeRoute.vehicle_type)} · {COLORS[activeRoute.color ?? ""] ?? activeRoute.color ?? "Color desconocido"}</b><small>{activeRoute.camera_ids.length} pasos por cámaras</small></div><span className="confidence">{Math.round(activeRoute.confidence * 100)}<small>puntaje / 100</small></span></div>
      {activeRoute.explanation?.segments && <details className="route-evidence" key={activeRoute.id}>
        <summary>¿Por qué aparece esta ruta?</summary>
        <p>Es un puntaje de compatibilidad, no una probabilidad de identificación. Compara tiempos, detecciones y alternativas viales.</p>
        <dl>{Object.entries(activeRoute.explanation.weights).map(([key, value]) => <div key={key}><dt>{{ detection: "Calidad de detección", time: "Compatibilidad temporal", appearance: "Apariencia disponible", road: "Costo vial" }[key] ?? key}</dt><dd>{percent(value)}</dd></div>)}</dl>
        <ol>{activeRoute.explanation.segments.map((segment, index) => <li key={index}>
          <b>{segment.from_camera} → {segment.to_camera} · alternativa {segment.option_index + 1}</b>
          <span>{Math.round(segment.distance_m)} m · {Math.round(segment.observed_seconds)} s observados / {Math.round(segment.expected_seconds)} s de referencia</span>
          <span>Puntaje del tramo: {Math.round(segment.score * 100)}/100. {segment.source === "osrm" ? "Red vial OSRM." : "Enlace no verificado; referencia de velocidad supuesta."}{segment.gap_penalty < 1 ? " Penalización por tramo sin observaciones intermedias." : ""}</span>
        </li>)}</ol>
        <p>Agregación geométrica de tramos + {Math.round(activeRoute.explanation.coverage_bonus * 100)} puntos por observaciones adicionales. Dirección de imagen no usada: falta calibrar cámaras.{activeRoute.explanation.search_pruned ? " Búsqueda acotada: pueden existir otras candidatas." : ""}</p>
      </details>}
      <ol className="timeline">{activeRoute.detections.map((hop, index) => <li key={hop.detection_id}><span className="timeline-dot">{String(index + 1).padStart(2, "0")}</span><div><b>{result?.nearby_devices.find((device) => device.external_id === hop.camera_id)?.name ?? hop.camera_id}</b><small>{hop.camera_id} · {hop.direction.replaceAll("-", " ")}</small></div><div className="hop-time"><b>{observationTime(hop.observed_at)}</b><small>{percent(hop.confidence)} coincidencia</small></div></li>)}</ol>
      <p className={`route-caution ${activeRoute.has_distant_gaps ? "warning" : ""}`}><Icon name="layers" size={16}/>{activeRoute.has_distant_gaps ? "Hay tramos distantes sin observaciones intermedias. Revisa las rutas alternativas." : "La ruta une observaciones y expresa una estimación, no una identificación confirmada."}</p>
    </> : <div className="empty-state"><span className="empty-icon"><Icon name="route" size={30}/></span><b>{searching ? "Reconstruyendo las señales" : result ? "Sin trayectorias para estos filtros" : "Cada señal cuenta una parte"}</b><p>{result ? "Prueba otro color, amplía el radio o ajusta el horario. Una detección aislada puede no formar una ruta." : "Busca un vehículo para conectar sus detecciones y explorar sus posibles recorridos."}</p></div>}
  </article>;

  const mapPanel = <article className="panel map-card">
    <div className="card-heading"><div><span className="section-kicker">Territorio conectado</span><h2>Mapa de operaciones</h2></div><span className="location-label"><Icon name="pin" size={14}/>Barranquilla, CO</span></div>
    <VigiaMap cameras={cameras} selectedId={selected?.external_id ?? ""} onSelect={setSelectedCamera} routePoints={routePoints} routeMode={routeMode} radius={view === "Trayectorias" && result ? result.query.radius_m : radius} center={view === "Trayectorias" && result ? result.query : selected}/>
    <div className="map-footer"><div className="legend"><span><i className="physical"/>Física</span><span><i className="simulated"/>Simulada</span><span><i className="offline"/>Sin conexión</span></div><span>{routeMode === "loading" ? "Ajustando el recorrido a la red vial…" : routeMode === "road-network" ? `Geometría vial OSRM · ${activeRoute?.road_geometry ? "alternativa evaluada" : "solo referencia visual"}${routeGeometry?.distance_m ? ` · ${(routeGeometry.distance_m / 1000).toFixed(2)} km` : ""}` : routeMode === "camera-chord" ? "Estimación directa; enrutador vial no disponible" : "Selecciona un nodo para explorar"}</span></div>
  </article>;

  return <main className="app-shell">
    <a className="skip-link" href="#workspace">Saltar al contenido</a>
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="VIGIA, inicio"><span className="brand-mark"><Icon name="shield" size={27}/></span><span><strong>VIGIA<span>●</span></strong><small>INTELIGENCIA COMUNITARIA</small></span></Link>
      <div className="workspace-label"><span className="small-orbit"/>RED BARRANQUILLA<Icon name="layers" size={14}/></div>
      <span className="nav-label">CENTRO DE OPERACIONES</span>
      <nav className="main-nav" aria-label="Navegación principal">{visibleNavigation.map((item, index) => <button key={item.label} aria-current={view === item.label ? "page" : undefined} className={view === item.label ? "active" : ""} onClick={() => setView(item.label)}><Icon name={item.icon}/><span>{item.label}</span><small>0{index + 1}</small></button>)}</nav>
      <div className="sidebar-network" aria-hidden="true"><div className="radar"><i/><i/><i/><span className="radar-dot a"/><span className="radar-dot b"/><Icon name="shield" size={25}/></div><span>Una comunidad.<br/><b>Muchas miradas.</b></span></div>
      <div className="privacy-note"><Icon name="shield" size={19}/><div><b>Inteligencia en el origen</b><p>Detección local. Consultas por metadatos. Una red que colabora.</p></div></div>
      <div className="profile"><span className="avatar">{user ? user.display_name.slice(0, 2).toUpperCase() : "DE"}</span><div><b>{user?.display_name ?? "Demostración"}</b><small>{user ? `${ROLE_LABELS[user.role]} · ${user.email}` : "Sin sesión · datos de ejemplo"}</small></div><span className="version">v0.3</span></div>
    </aside>
    <section className="workspace" id="workspace">
      <header className="topbar"><div className="breadcrumb">VIGIA <span>/</span> Operaciones <span>/</span><b>{view}</b></div><div className="topbar-actions"><span className={`system-status ${source}`}><i/>{source === "central" ? "Servicio central conectado" : source === "demo" ? "Entorno de demostración" : source === "loading" ? "Conectando servicio…" : "Servicio central desconectado"}</span>{user ? <button className="text-action session-action" onClick={logout}>Cerrar sesión</button> : <button className="text-action session-action" onClick={() => window.location.reload()}>Iniciar sesión</button>}</div></header>
      <section className="page-heading"><div><p className="eyebrow"><span/>OBSERVA. CONECTA. COMPRENDE.</p><h1>{view === "Resumen" ? <>La ciudad, <span>en perspectiva.</span></> : view === "Cámaras" ? <>Una red. <span>Más alcance.</span></> : view === "Consultas" ? <>Sigue <span>las señales.</span></> : view === "Administración" ? <>Cada acción, <span>con autor.</span></> : <>Conecta <span>el recorrido.</span></>}</h1><p>{navigation.find((item) => item.label === view)?.detail}. Información para entender lo que ocurre.</p></div><button className="secondary-action" onClick={() => { setView("Consultas"); document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth" }); }}><Icon name="search" size={17}/>Nueva consulta<Icon name="arrow" size={17}/></button></section>
      <div className={`source-banner ${source}`} role="status"><span className="source-icon"><Icon name={source === "central" ? "activity" : "layers"} size={18}/></span><div><b>{source === "central" ? "Datos del servicio central" : source === "demo" ? "Modo demostración · datos de ejemplo" : source === "loading" ? "Conectando tu red de cámaras" : "Tu consola está lista. Conecta tu red."}</b><span>{source === "central" ? `Última lectura de dispositivos: ${updatedAt}. Los nodos simulados conservan su etiqueta.` : source === "demo" ? "Escenario del 25 de agosto de 2026. Las rutas y sus porcentajes son ilustrativos." : source === "loading" ? "Consultando los dispositivos registrados…" : "El servicio central no responde. Reintenta la conexión o explora un escenario de prueba."}</span></div><div className="banner-actions">{source === "offline" && <button className="demo-button" onClick={openDemo}>Explorar demo<Icon name="arrow" size={14}/></button>}{source !== "loading" && <button className="text-action" disabled={connecting || searching} onClick={connect}><Icon name="refresh" size={15}/>{connecting ? "Conectando…" : source === "central" ? "Actualizar red" : "Conectar servicio"}</button>}</div></div>
      {connectionError && <p className="error-message" role="alert">{connectionError}</p>}

      {view !== "Administración" && <section className="metrics" aria-label="Métricas de la red y última consulta">
        {([
          { label: "Cámaras registradas", value: cameras.length, detail: `${cameras.filter((c) => c.kind === "physical").length} físicas · ${cameras.filter((c) => c.kind === "simulated").length} simuladas`, icon: "camera", tone: "teal" },
          { label: "Detecciones candidatas", value: result?.candidate_detection_count ?? "—", detail: result ? "En la consulta seleccionada" : "A la espera de tu consulta", icon: "search", tone: "orange" },
          { label: "Rutas posibles", value: result?.routes.length ?? "—", detail: result ? "Ordenadas por puntaje" : "Conecta las observaciones", icon: "route", tone: "violet" },
          { label: "Tiempo de consulta", value: record ? `${record.elapsed.toFixed(2)} s` : "—", detail: record?.source === "demo" ? "Procesamiento local de ejemplo" : "Medido desde esta consola", icon: "clock", tone: "blue" },
        ] as const).map((metric, index) => <article className={`metric ${metric.tone}`} key={metric.label}><div className="metric-top"><span>{metric.label}</span><Icon name={metric.icon} size={19}/></div><strong>{metric.value}</strong><div className="metric-bottom"><small>{metric.detail}</small><span className="metric-number">0{index + 1}</span></div></article>)}
      </section>}

      {view === "Administración" && user?.role === "admin" ? <AdminPanel cameras={cameras}/> : view === "Cámaras" ? <>
        <div className="camera-toolbar"><h2>Dispositivos de la red</h2><label className="device-search"><Icon name="search" size={17}/><input aria-label="Filtrar cámaras" placeholder="Buscar nombre o identificador…" value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}/></label></div>
        <section className="cameras-grid"><div><CameraPreview active={selected?.external_id === "CAM-01" && selected.kind === "physical"} large/><div className="camera-selection"><Icon name="pin" size={17}/><span>Seleccionada: <b>{selected?.name ?? "Ninguna"}</b>{selected && <small>{selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}</small>}</span></div></div><DevicesCard cameras={cameras.filter((camera) => `${camera.name} ${camera.external_id}`.toLowerCase().includes(deviceFilter.toLowerCase()))} selected={selected?.external_id ?? ""} onSelect={setSelectedCamera}/></section>
        {mapPanel}
      </> : view === "Trayectorias" ? <>
        <section className="history-layout"><article className="panel history-card"><div className="card-heading"><div><span className="section-kicker">Esta sesión · últimas 20</span><h2>Historial de consultas</h2></div><span className="count-badge">{history.length}</span></div>{history.length ? <div className="history-list">{history.map((item, index) => <button key={item.result.query.id} className={record === item ? "selected" : ""} onClick={() => { setRecord(item); setRouteId(item.result.routes[0]?.id ?? ""); }}><span className="history-icon"><Icon name="route"/></span><span><b>{item.result.query.vehicle_type ? vehicleLabel(item.result.query.vehicle_type) : "Todos los vehículos"} · {COLORS[item.result.query.color ?? ""] ?? "Todos los colores"}</b><small>{observationDate(item.result.query.time_from)} · {observationTime(item.result.query.time_from)} · {item.source === "demo" ? "Demo" : "Central"}</small></span><span className="history-rank">{item.result.routes.length} rutas<small>#{history.length - index}</small></span></button>)}</div> : <div className="empty-state"><Icon name="clock" size={30}/><b>Aún no hay consultas</b><p>Las búsquedas realizadas aparecerán aquí durante esta sesión.</p><button className="secondary-action" onClick={() => setView("Consultas")}>Crear una consulta<Icon name="arrow" size={16}/></button></div>}</article>{routePanel}</section>{mapPanel}
      </> : <><section className="content-grid">{mapPanel}{queryForm}</section><section className="lower-grid">{routePanel}<DevicesCard cameras={cameras} selected={selected?.external_id ?? ""} onSelect={setSelectedCamera}/></section></>}
      <footer className="workspace-footer"><span><span className="footer-mark">V</span>VIGIA · Tecnología que conecta a tu comunidad.</span><span>Barranquilla, Colombia <i/>UTC−5</span></footer>
    </section>
  </main>;
}
