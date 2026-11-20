"use client";

import Image from "next/image";
import { animate, utils } from "animejs";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AdminPanel } from "./admin-panel";
import { BrandMark } from "./brand";
import { ComboField, TIME_OPTIONS, parseDatePart, parseTime, timeLabel } from "./combo-field";
import type { SessionUser } from "./console-gate";
import { Icon, type IconName } from "./icon";
import { VigiaMap } from "./vigia-map";
import { DEMO_DEVICES, runDemoQuery } from "@/lib/demo-monitoring";
import { COLORS, REPORTED_COLORS, activityDetail, deviceActivity, normalizePlate, unknownColorNote, observationDate, observationTime, percent, validateQuery, vehicleLabel, type Device, type QueryResult, type RouteHop, type Scenario } from "@/lib/monitoring";
import { countTo, enter, reducedMotion } from "@/lib/motion";
import type { RoadGeometry } from "@/lib/road-routing";

type View = "Resumen" | "Cámaras" | "Consultas" | "Administración";
type Source = "loading" | "central" | "offline" | "demo";
type SearchRecord = { result: QueryResult; source: "central" | "demo"; elapsed: number };
const navigation: { label: View; icon: IconName }[] = [
  { label: "Resumen", icon: "grid" },
  { label: "Cámaras", icon: "camera" },
  { label: "Consultas", icon: "queries" },
];
const ROLE_LABELS = { operator: "Operador", admin: "Administrador" } as const;
const SOURCE_STATUS: Record<Source, string> = { central: "Servicio central conectado", demo: "Entorno de demostración", loading: "Conectando servicio…", offline: "Servicio central desconectado" };

const VEHICLE_OPTIONS = [{ value: "", label: "Cualquier vehículo" }, { value: "car", label: "Automóvil" }, { value: "motorcycle", label: "Motocicleta" }];
const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, "0")).map((value) => ({ value, label: value }));
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")).map((value) => ({ value, label: value }));
const radiusLabel = (meters: number) => meters >= 1000 ? `${(meters / 1000).toLocaleString("es-CO")}km` : `${meters}m`;
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
      <p>¿Este es el vehículo que estás buscando?</p>
      <div className="verdict-buttons" role="group" aria-label={`Confirmación del paso en ${hop.camera_id}`}>
        <button type="button" className={verdict === "match" ? "selected" : ""} aria-pressed={verdict === "match"} disabled={busy} onClick={() => onVerdict(verdict === "match" ? null : "match")}>Sí</button>
        <button type="button" className={verdict === "reject" ? "selected" : ""} aria-pressed={verdict === "reject"} disabled={busy} onClick={() => onVerdict(verdict === "reject" ? null : "reject")}>No</button>
      </div>
    </div>
    {hop.has_thumbnail && !broken && <LearningLabels hop={hop}/>}
  </div>;
}

type LearningTask = "color" | "plate";
const LEARNING_ERRORS: Record<number, string> = {
  409: "El recorte ya venció (7 días): no se puede guardar para entrenamiento.",
  422: "Esa etiqueta no es válida. Revisa el color o escribe la placa completa (ABC123, ABC12D).",
  501: "El servicio central no tiene almacén de aprendizaje configurado.",
};
const PLATE_LABELS: Record<string, string> = { ilegible: "Ilegible", sin_placa: "Sin placa visible" };

/**
 * Fase 4: the admin can label the recorte's real colour and plate for training. Only what
 * is saved here becomes a label: answering «¿Es este el vehículo?» says nothing about them.
 */
function LearningLabels({ hop }: { hop: RouteHop }) {
  const [saved, setSaved] = useState<Partial<Record<LearningTask, string>>>({});
  const [color, setColor] = useState(hop.color && REPORTED_COLORS.includes(hop.color) ? hop.color : "");
  const [plate, setPlate] = useState(hop.license_plate ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/detections/${hop.detection_id}/annotations`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ task: LearningTask; label: string }[]> : [])
      .then((rows) => {
        const next: Partial<Record<LearningTask, string>> = {};
        for (const row of rows) next[row.task] = row.label;
        setSaved(next);
        if (next.color && next.color !== "no_determinable") setColor(next.color);
        if (next.plate && !PLATE_LABELS[next.plate]) setPlate(next.plate);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [hop.detection_id]);

  async function save(task: LearningTask, label: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/detections/${hop.detection_id}/annotations/${task}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) });
      if (sessionEnded(response)) return;
      if (!response.ok) throw new Error(LEARNING_ERRORS[response.status] ?? "No fue posible guardar la etiqueta.");
      const row = await response.json() as { label: string };
      setSaved((current) => ({ ...current, [task]: row.label }));
      setMessage({ text: task === "color" ? "Color guardado para entrenamiento." : "Placa guardada para entrenamiento.", error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "No fue posible guardar la etiqueta.", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function undo(task: LearningTask) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/detections/${hop.detection_id}/annotations/${task}`, { method: "DELETE" });
      if (sessionEnded(response)) return;
      if (!response.ok) throw new Error("No fue posible deshacer la etiqueta.");
      setSaved((current) => ({ ...current, [task]: undefined }));
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "No fue posible deshacer la etiqueta.", error: true });
    } finally {
      setBusy(false);
    }
  }

  const plateText = normalizePlate(plate);
  const savedLabel = (task: LearningTask, label: string) => <span className="learning-saved"><Icon name="check" size={18}/>
    {task === "color" ? label === "no_determinable" ? "No se distingue" : colorLabel(label, label) : PLATE_LABELS[label] ?? label}
    <button type="button" className="text-link" disabled={busy} onClick={() => undo(task)}>Deshacer</button></span>;
  return <details className="learning-labels">
    <summary>Etiquetar para entrenamiento{(saved.color || saved.plate) && <span className="learning-count">{[saved.color, saved.plate].filter(Boolean).length} guardada{saved.color && saved.plate ? "s" : ""}</span>}</summary>
    <p className="learning-note">Solo se usa lo que guardes aquí. El recorte se copia a un almacén privado de aprendizaje y se borra a los 180 días.</p>
    <div className="learning-row">
      <label>Color real<select value={color} disabled={busy} onChange={(event) => setColor(event.target.value)}>
        <option value="" disabled>Elige un color</option>
        {REPORTED_COLORS.map((value) => <option key={value} value={value}>{colorLabel(value, value)}</option>)}
        <option value="no_determinable">No se distingue</option>
      </select></label>
      <button type="button" className="pill-small" disabled={busy || !color} onClick={() => save("color", color)}>Guardar color</button>
      {saved.color && savedLabel("color", saved.color)}
    </div>
    <div className="learning-row">
      <label>Placa<input value={plate} disabled={busy} maxLength={8} placeholder="ABC123" autoComplete="off" spellCheck={false} onChange={(event) => setPlate(event.target.value.toUpperCase())}/></label>
      <button type="button" className="pill-small" disabled={busy || !plateText} onClick={() => plateText && save("plate", plateText)}>Guardar placa</button>
      <button type="button" className="pill-small ghost" disabled={busy} onClick={() => save("plate", "ilegible")}>Ilegible</button>
      <button type="button" className="pill-small ghost" disabled={busy} onClick={() => save("plate", "sin_placa")}>Sin placa visible</button>
      {saved.plate && savedLabel("plate", saved.plate)}
    </div>
    {message && <p className={message.error ? "error-message" : "learning-ok"} role={message.error ? "alert" : "status"}>{message.text}</p>}
  </details>;
}

function CountPill({ value, label, tone = "gradient" }: { value: number; label: string; tone?: "gradient" | "solid" }) {
  const ref = useRef<HTMLSpanElement>(null);
  // Numbers count up to their value instead of appearing.
  useEffect(() => { countTo(ref.current, value); }, [value]);
  return <div className="count-pill"><span className={`count-value ${tone}`} ref={ref}>{value}</span><span>{label}</span></div>;
}

type GuideStep = "red" | "consulta" | "rutas" | "camaras" | "historial";
const GUIDE_STEPS: { id: GuideStep; label: string }[] = [
  { id: "red", label: "Tu red" },
  { id: "consulta", label: "La consulta" },
  { id: "rutas", label: "Las rutas" },
  { id: "camaras", label: "Las cámaras" },
  { id: "historial", label: "El historial" },
];

/**
 * The demo is the console's first impression, so it explains itself: each screen says
 * what it shows and offers the next step. The steps above can be visited in any order.
 */
function DemoGuide({ step, empty, onStep, onNext, onSignIn }: { step: GuideStep; empty: boolean; onStep: (step: GuideStep) => void; onNext: () => void; onSignIn: () => void }) {
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const index = GUIDE_STEPS.findIndex((item) => item.id === step);
  useLayoutEffect(() => {
    const parts = open ? enter(bodyRef.current ? [...bodyRef.current.children] : null, { step: 60, distance: 12, duration: 650 }) : null;
    return () => { parts?.revert(); };
  }, [step, empty, open]);
  const copy: Record<GuideStep, { title: string; text: ReactNode; action: string }> = {
    red: {
      title: "Así ve un operador su red de cámaras",
      text: <>El mapa muestra las 4 cámaras del piloto en Barranquilla: una física y tres simuladas. Cada una detecta vehículos <b>en el propio dispositivo</b> y al servidor solo llegan datos como el tipo, el color y la hora: nunca el video.</>,
      action: "Abrir una consulta",
    },
    consulta: {
      title: "Describe el vehículo que buscas",
      text: <>Ya cargamos un caso de prueba: <b>un automóvil blanco</b> visto cerca de la Tapo C110 el 25 de agosto de 2026, entre las 09:20 y las 10:30, en un radio de 2 km. Puedes cambiar cualquier filtro antes de buscar.</>,
      action: "Buscar con este caso",
    },
    rutas: empty ? {
      title: "Ninguna ruta con estos filtros",
      text: <>Una detección aislada no forma un recorrido. Prueba con <b>automóvil blanco</b>, amplía el radio o abre más el horario.</>,
      action: "Ajustar la consulta",
    } : {
      title: "VIGÍA conecta las detecciones en recorridos",
      text: <>Cada ruta candidata une cámaras por las que pudo pasar el vehículo y lleva un puntaje de 0 a 100: mide si los tiempos y las distancias encajan, <b>no confirma la identidad</b>. Cambia de ruta y abre «¿Por qué aparece esta ruta?» para ver la evidencia.</>,
      action: "Ver las cámaras",
    },
    camaras: {
      title: "Los dispositivos de la red",
      text: <>Filtra o elige una cámara para ubicarla en el mapa. Las <b>físicas</b> son cámaras o teléfonos que procesan video real; las <b>simuladas</b> reproducen eventos para probar el sistema sin calle.</>,
      action: "Ver el historial",
    },
    historial: {
      title: "Cada búsqueda queda a mano",
      text: <>El historial guarda las consultas de la sesión para volver a sus rutas. Con una cuenta, las búsquedas usan los datos del servicio central y cada acceso queda auditado.</>,
      action: "Iniciar sesión",
    },
  };
  const current = copy[step];
  if (!open) return <button type="button" className="guide-reopen" onClick={() => setOpen(true)}><Icon name="info" size={22}/>Mostrar la guía de la demo</button>;
  return <section className="demo-guide" aria-labelledby="demo-guide-title">
    <div className="guide-top">
      <span className="guide-kicker"><Icon name="info" size={22}/>Guía de la demo · paso {index + 1} de {GUIDE_STEPS.length}</span>
      <button type="button" className="guide-close" aria-label="Ocultar la guía" title="Ocultar la guía" onClick={() => setOpen(false)}><Icon name="close" size={22}/></button>
    </div>
    <ol className="guide-progress" aria-label="Pasos de la demo">{GUIDE_STEPS.map((item, position) => <li key={item.id}>
      <button type="button" aria-current={item.id === step ? "step" : undefined} className={position < index ? "done" : ""} onClick={() => onStep(item.id)}>
        <span className="guide-dot">{position < index ? <Icon name="check" size={16}/> : position + 1}</span>{item.label}
      </button>
    </li>)}</ol>
    <div className="guide-body" ref={bodyRef} key={`${step}${empty}`}>
      <h2 id="demo-guide-title">{current.title}</h2>
      <p>{current.text}</p>
      <button type="button" className="pill-figma demo-action" onClick={step === "historial" ? onSignIn : onNext}>{current.action}<Icon name="arrow" size={24}/></button>
    </div>
  </section>;
}

/** The current view leaves (a short fade and sink) before the next one is drawn. */
function swap(change: () => void) {
  const stage = document.querySelector(".stage");
  if (!stage || reducedMotion()) {
    change();
    return;
  }
  animate(stage, { opacity: [1, 0], translateY: [0, 14], filter: ["blur(0px)", "blur(6px)"], duration: 200, ease: "inQuad", onComplete: change });
}

/**
 * `user` null means the anonymous demo: no request reaches the central service, a guide
 * walks through the screens and the back arrow on Resumen returns to the landing (`onExit`).
 */
export function OperationsConsole({ user, onExit }: { user: SessionUser | null; onExit?: () => void }) {
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

  // Node activity comes from 30 s heartbeats: refresh it so «Sin señal» shows up without reloading.
  useEffect(() => {
    if (!user || source !== "central") return;
    const timer = window.setInterval(() => {
      fetch("/api/monitoring/devices", { cache: "no-store" })
        .then(async (response) => { if (sessionEnded(response) || !response.ok) return; setCameras(await response.json() as Device[]); setUpdatedAt(observationTime(new Date().toISOString())); })
        .catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [user, source]);

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
    setMenuOpen(false);
    if (next === view && !detail) return;
    swap(() => { setView(next); setDetail(null); });
  }

  function compose() {
    swap(() => { setView("Resumen"); setDetail(null); setComposing(true); });
  }

  function back() {
    if (view === "Consultas" && detail === "search") compose();
    else if (view === "Consultas" && detail === "history") swap(() => setDetail(null));
    else if (view === "Resumen") swap(() => setComposing(false));
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
      swap(() => { setView("Consultas"); setDetail("search"); window.scrollTo({ top: 0 }); });
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

  // ── Motion: every change of screen has a real flow instead of appearing at once ──
  const screenKey = `${view}|${detail ?? ""}|${composing}`;

  // The new view comes in: the stage, then its pieces one after another, and the title.
  useLayoutEffect(() => {
    if (reducedMotion()) return;
    const stage = document.querySelector(".stage");
    if (stage) utils.set(stage, { opacity: 1, translateY: 0, filter: "blur(0px)" });
    const pieces = enter(".stage-main > *, .stage-aside > *, .map-card, .stage.single > :not(.admin-grid), .admin-grid > *", { step: 55, distance: 26, duration: 800 });
    const title = animate(".title-row h1", { opacity: [0, 1], translateX: [-28, 0], duration: 800, ease: "outExpo" });
    const rows = composing ? enter(".query-card .line-row, .query-card .radius-label, .query-card .range-ticks, .query-card .query-actions", { delay: 180, step: 45, distance: 14, duration: 650 }) : null;
    return () => { pieces?.revert(); title.revert(); rows?.revert(); };
  }, [screenKey, composing]);

  // On first load the rail and the header slide in.
  useLayoutEffect(() => {
    if (reducedMotion()) return;
    const rail = enter(".rail-brand, .rail-gear, .rail-nav > button", { step: 60, distance: 0, duration: 700 });
    const railSlide = animate(".rail-brand, .rail-gear, .rail-nav > button", { translateX: [-24, 0], duration: 800, ease: "outExpo" });
    const header = enter(".topbar .account > *, .back-button, .network-pill", { step: 70, distance: 16, duration: 800 });
    return () => { rail?.revert(); railSlide.revert(); header?.revert(); };
  }, []);

  // Choosing another candidate route replays its steps in order.
  useEffect(() => {
    if (!activeRoute) return;
    const steps = enter(".timeline > li", { step: 70, distance: 12, duration: 650 });
    return () => { steps?.revert(); };
  }, [activeRoute?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isResumen = view === "Resumen";
  const title = view === "Cámaras" ? "Dispositivos de la red." : view === "Administración" ? "Control accesos." : view === "Consultas" ? detail ? "Trayectorias estimadas." : "Registros de búsqueda." : composing ? "Nueva consulta" : "Resumen";
  const canGoBack = view !== "Resumen" || composing;
  // Resumen is the first screen: no arrow there, except in the demo, where it returns to the landing.
  const exitDemo = !user && view === "Resumen" && !composing ? onExit : undefined;
  const [year, month, day] = (date || "--").split("-");
  const setDatePart = (part: 0 | 1 | 2, value: string) => {
    const parts = [year || String(new Date().getFullYear()), month || "01", day || "01"];
    parts[part] = value;
    setDate(parts.join("-"));
  };
  const thisYear = new Date().getFullYear();

  const sourceCard = <section className={`source-card ${source}`} aria-labelledby="source-title">
    <Icon name={source === "central" ? "activity" : source === "loading" ? "refresh" : "alert"} size={41}/>
    <h2 id="source-title">{source === "central" ? "Datos del servicio central" : source === "demo" ? "Modo demostración · datos de ejemplo" : source === "loading" ? "Conectando tu red de cámaras" : "Servicio central sin respuesta"}</h2>
    <p>{source === "central" ? <>Última lectura de dispositivos: {updatedAt}.<br/>Los nodos simulados conservan su etiqueta.</> : source === "demo" ? "Escenario del 25 de agosto de 2026. Las rutas y sus puntajes son ilustrativos." : source === "loading" ? "Consultando los dispositivos registrados…" : "Reintenta la conexión o explora un escenario de prueba."}</p>
    {source === "offline" && <button className="card-button" onClick={openDemo}>Explorar demo</button>}
    {source !== "loading" && <button className="card-button" disabled={connecting || searching} onClick={connect}>{connecting ? "Conectando…" : source === "central" ? "Actualizar Red" : "Conectar servicio"}</button>}
    {connectionError && <p className="error-message" role="alert">{connectionError}</p>}
  </section>;

  const queryForm = <form className="query-card" id="query-form" onSubmit={search} aria-labelledby="query-title">
    <h2 id="query-title" className="visually-hidden">Buscar un vehículo</h2>
    <fieldset disabled={searching || connecting || source === "loading" || source === "offline"}>
      <div className="line-row">
        <ComboField label="Punto de búsqueda" placeholder="Punto de Búsqueda" value={selected?.external_id ?? ""} options={cameras.map((camera) => ({ value: camera.external_id, label: `${camera.name} - ${camera.external_id}` }))} onChange={setSelectedCamera} inputMode="text" className="wide"/>
      </div>
      <div className="line-row">
        <ComboField label="Vehículo" placeholder="Vehículo" value={vehicle} options={VEHICLE_OPTIONS} onChange={setVehicle} inputMode="text"/>
        <ComboField label="Color" placeholder="Color" value={color} options={[{ value: "", label: "Cualquier color" }, ...REPORTED_COLORS.map((key) => ({ value: key, label: COLORS[key] })), ...(color && !REPORTED_COLORS.includes(color) ? [{ value: color, label: COLORS[color] ?? color }] : [])]} onChange={setColor} inputMode="text"/>
        {isAdmin && <label className={`line-select plate-field ${plate ? "" : "empty"}`}><span className="visually-hidden">Placa</span><input aria-label="Placa" value={plate} onChange={(event) => setPlate(event.target.value.toUpperCase())} placeholder="Placa" autoComplete="off" spellCheck={false} maxLength={8} aria-invalid={plate.trim() !== "" && !normalizePlate(plate)}/></label>}
      </div>
      {/* Date and times can be typed or picked from the chevron's list. */}
      <div className="line-row">
        <ComboField label="Día" placeholder="DD" value={day ?? ""} options={DAY_OPTIONS} parse={parseDatePart(1, 31)} onChange={(value) => setDatePart(2, value)}/>
        <ComboField label="Mes" placeholder="MM" value={month ?? ""} options={MONTH_OPTIONS} parse={parseDatePart(1, 12)} onChange={(value) => setDatePart(1, value)}/>
        <ComboField label="Año" placeholder="AAAA" value={year ?? ""} options={[...new Set([thisYear - 1, thisYear, thisYear + 1, Number(year) || thisYear])].sort().map((value) => ({ value: String(value), label: String(value) }))} parse={parseDatePart(2000, 2100, 4)} onChange={(value) => setDatePart(0, value)}/>
      </div>
      <div className="line-row">
        <ComboField label="Desde" placeholder="Desde" value={timeFrom} options={TIME_OPTIONS} parse={parseTime} onChange={setTimeFrom} format={timeLabel} inputMode="text" className="time-field"/>
        <ComboField label="Hasta" placeholder="Hasta" value={timeTo} options={TIME_OPTIONS} parse={parseTime} onChange={setTimeTo} format={timeLabel} inputMode="text" className="time-field"/>
      </div>
      <label className="radius-label">Radio de Búsqueda<output>{radiusLabel(radius)}</output>
        <input type="range" min="100" max="5000" step="100" value={radius} onChange={(event) => setRadius(Number(event.target.value))} style={{ "--fill": `${(radius - 100) / 49}%` } as React.CSSProperties}/>
      </label>
      <div className="range-ticks" aria-hidden="true"><span>100m</span><span>5km</span></div>
      <div className="query-actions">
        <button className="pill-figma" type="submit" disabled={!selected}>{searching ? "Buscando coincidencias…" : source === "demo" ? "Buscar en la demostración" : "Buscar coincidencias"}</button>
        {scenarios.length ? <label className="line-select scenario-picker"><span className="visually-hidden">Caso del dataset de pruebas</span><select aria-label="Caso del dataset de pruebas" value={scenarioId} onChange={(event) => applyScenario(event.target.value)}><option value="">Caso del dataset de pruebas</option>{scenarios.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.title}</option>)}</select><Icon name="chevron" size={24}/></label>
          : <button className="text-link" type="button" onClick={loadScenario}>Cargar escenario de prueba · 25 ago.</button>}
      </div>
    </fieldset>
    {error && <p className="error-message" role="alert">{error}</p>}
  </form>;

  const routeVehicle = activeRoute?.vehicle_type ?? result?.query.vehicle_type;
  const routePlate = isAdmin ? activeRoute?.detections.find((hop) => hop.license_plate)?.license_plate : null;
  const routePanel = <article className="routes-card" aria-busy={searching} aria-labelledby="route-title">
    {result && <header className="route-head">
      <span className="vehicle-badge"><Icon name={routeVehicle === "motorcycle" ? "motorcycle" : "car"} size={51}/></span>
      <div>
        <h2 id="route-title">{activeRoute ? [vehicleLabel(activeRoute.vehicle_type), colorLabel(activeRoute.color, "Color desconocido"), routePlate].filter(Boolean).join(" | ") : result.query.vehicle_type ? vehicleLabel(result.query.vehicle_type) : "Todos los vehículos"}</h2>
        <p>{observationDate(result.query.time_from)} · {observationTime(result.query.time_from)}–{observationTime(result.query.time_to)} · UTC−5 · Radio {result.query.radius_m} m</p>
      </div>
      {activeRoute && <span className="route-score"><b>{score(activeRoute.confidence)}</b>Puntaje / 100</span>}
      {record && <button className="round-button export" onClick={exportResult} aria-label="Exportar resultados JSON" title="Exportar resultados JSON"><Icon name="download" size={28}/></button>}
    </header>}
    <div className="result-announcement" role="status" aria-live="polite">{searching ? "Consultando cámaras cercanas…" : result ? `${result.candidate_detection_count} detecciones · ${result.routes.length} rutas candidatas · ${record?.source === "demo" ? "Demostración" : "Servicio central"}` : "Los resultados aparecerán después de una búsqueda."}</div>
    {exportError && <p className="error-message" role="alert">{exportError}</p>}
    {activeRoute ? <>
      <div className="route-options" role="group" aria-label="Rutas candidatas">{result?.routes.map((route) => <button key={route.id} aria-pressed={activeRoute.id === route.id} className={activeRoute.id === route.id ? "selected" : ""} onClick={() => setRouteId(route.id)}><Icon name="route" size={25}/>Ruta {route.rank}<small>{score(route.confidence)} /100</small></button>)}</div>
      {activeRoute.has_distant_gaps && <p className="route-caution"><Icon name="alert" size={22}/>Hay tramos distantes sin observaciones intermedias. Revisa las rutas alternativas.</p>}
      <hr className="route-rule"/>
      <details className="route-evidence" key={activeRoute.id}>
        <summary><Icon name="why" size={50}/>¿Por qué aparece esta ruta?</summary>
        <p>Es un puntaje de compatibilidad, no una probabilidad de identificación. Compara tiempos, detecciones y alternativas viales.</p>
        {activeRoute.explanation?.segments && <>
          <dl>{Object.entries(activeRoute.explanation.weights).map(([key, value]) => <div key={key}><dt>{{ detection: "Calidad de detección", time: "Compatibilidad temporal", appearance: "Apariencia disponible", road: "Costo vial" }[key] ?? key}</dt><dd>{percent(value)}</dd></div>)}</dl>
          <ol>{activeRoute.explanation.segments.map((segment, index) => <li key={index}>
            <b>{segment.from_camera} → {segment.to_camera} · alternativa {segment.option_index + 1}</b>
            <span>{Math.round(segment.distance_m)} m · {Math.round(segment.observed_seconds)} s observados / {Math.round(segment.expected_seconds)} s de referencia</span>
            <span>Puntaje del tramo: {score(segment.score)}/100. {segment.source === "osrm" ? "Red vial OSRM." : "Enlace no verificado; referencia de velocidad supuesta."}{segment.gap_penalty < 1 ? " Penalización por tramo sin observaciones intermedias." : ""}</span>
          </li>)}</ol>
          <p>Agregación geométrica de tramos + {score(activeRoute.explanation.coverage_bonus)} puntos por observaciones adicionales{unknownColorNote(activeRoute)}. Dirección de imagen no usada: falta calibrar cámaras.{activeRoute.explanation.search_pruned ? " Búsqueda acotada: pueden existir otras candidatas." : ""}</p>
        </>}
      </details>
      {isAdmin && record?.source === "central" && <p className="route-caution"><Icon name="lock" size={22}/>Los recortes y las placas son datos personales: duran 7 días y cada vista queda en la auditoría.</p>}
      {confirmError && <p className="error-message" role="alert">{confirmError}</p>}
      <ol className="timeline">{activeRoute.detections.map((hop, index) => {
        const row = <>
          <span className="timeline-dot">{index + 1}</span>
          <span className="hop-name">{result?.nearby_devices.find((device) => device.external_id === hop.camera_id)?.name ?? hop.camera_id}</span>
          <span className="hop-time">{observationTime(hop.observed_at)} · {percent(hop.confidence)}</span>
        </>;
        // Admins review each step: closed by default, opening it shows the recorte and the question.
        return <li key={hop.detection_id} className={hop.confirmation ?? ""}>
          {isAdmin && record?.source === "central" ? <details className="hop-details" onToggle={(event) => {
            // Opening a step unfolds the recorte and the question.
            const evidence = event.currentTarget.querySelector(".hop-evidence");
            if (event.currentTarget.open && evidence && !reducedMotion()) animate(evidence, { opacity: [0, 1], translateY: [-12, 0], scale: [.98, 1], duration: 520, ease: "outExpo" });
          }}>
            <summary>{row}{hop.confirmation && <span className={`hop-verdict ${hop.confirmation}`}>{hop.confirmation === "match" ? "Confirmado" : "Descartado"}</span>}<Icon name="chevron" size={24}/></summary>
            <HopEvidence hop={hop} busy={confirming !== ""} onVerdict={(verdict) => confirmHop(hop, verdict)}/>
          </details> : <div className="hop-row">{row}</div>}
        </li>;
      })}</ol>
    </> : <div className="empty-state">
      <b>{searching ? "Reconstruyendo las señales" : result ? "Sin trayectorias para estos filtros" : "Cada señal cuenta una parte"}</b>
      <p>{result ? "Prueba otro color, amplía el radio o ajusta el horario. Una detección aislada puede no formar una ruta." : "Busca un vehículo para conectar sus detecciones y explorar sus posibles recorridos."}</p>
      <button className="pill-figma" type="button" onClick={compose}>Ajustar consulta</button>
    </div>}
  </article>;

  const historyFiltered = history.filter((item) => {
    const text = `${vehicleLabel(item.result.query.vehicle_type ?? "car")} ${colorLabel(item.result.query.color, "")} ${observationDate(item.result.query.time_from)}`.toLowerCase();
    return text.includes(historyFilter.toLowerCase());
  });
  const historyPanel = <section className="history-card" aria-labelledby="history-title">
    <div className="history-title"><h2 id="history-title">Historial de consultas</h2><button type="button" className="icon-only" aria-label="Filtrar consultas" onClick={() => document.getElementById("history-filter")?.focus()}><Icon name="filters" size={34}/></button></div>
    {history.length ? historyFiltered.length ? <div className="history-list">{historyFiltered.map((item) => <button key={item.result.query.id} className={record === item ? "selected" : ""} onClick={() => swap(() => { setRecord(item); setRouteId(item.result.routes[0]?.id ?? ""); setDetail("history"); })}>
      <Icon name={item.result.query.vehicle_type === "motorcycle" ? "motorcycle" : "car"} size={51}/>
      <span className="history-main"><b>{[item.result.query.vehicle_type ? vehicleLabel(item.result.query.vehicle_type) : "Todos los vehículos", colorLabel(item.result.query.color, "")].filter(Boolean).join(" | ")}</b><small>{observationDate(item.result.query.time_from)}. {observationTime(item.result.query.time_from)}–{observationTime(item.result.query.time_to)}</small></span>
      <span className="history-source">{item.source === "demo" ? "Demostración" : "Servicio central"}</span>
      <span className="history-meta"><Icon name="history" size={24}/>{item.result.routes.length} rutas · radio {radiusLabel(item.result.query.radius_m)}</span>
    </button>)}</div> : <p className="empty-inline">Ninguna consulta coincide con «{historyFilter}».</p>
      : <div className="empty-state"><b>Aún no hay consultas</b><p>Las búsquedas de esta sesión aparecerán aquí, hasta las últimas 20.</p><button className="pill-figma" onClick={compose}>Crear una consulta</button></div>}
  </section>;

  const filteredCameras = cameras.filter((camera) => `${camera.name} ${camera.external_id}`.toLowerCase().includes(deviceFilter.toLowerCase()));
  const devicesPanel = <section className="devices-card" aria-labelledby="devices-title">
    <h2 id="devices-title">Red de Cámaras</h2>
    <div className="device-list">{filteredCameras.map((camera) => <button key={camera.id} aria-pressed={selected?.external_id === camera.external_id} className={selected?.external_id === camera.external_id ? "selected" : ""} onClick={() => setSelectedCamera(camera.external_id)}>
      <Icon name="cameraItem" size={42}/>
      <span className="device-info"><b>{camera.name}</b><small>{camera.external_id} | {camera.kind === "physical" ? "Cámara física" : "Nodo simulado"}</small><span className={`device-status ${deviceActivity(camera).tone}`}><i/>{deviceActivity(camera).label}</span></span>
    </button>)}</div>
    {!filteredCameras.length && <p className="empty-inline">{cameras.length ? `Ninguna cámara coincide con «${deviceFilter}».` : "No hay cámaras disponibles. Conecta el servicio central o abre la demostración."}</p>}
  </section>;

  const mapPanel = <section className="map-card" aria-label="Mapa de operaciones">
    <VigiaMap cameras={cameras} selectedId={selected?.external_id ?? ""} onSelect={setSelectedCamera} routePoints={routePoints} routeMode={routeMode} radius={showingRoute && result ? result.query.radius_m : radius} center={showingRoute && result ? result.query : selected}
      caption={routeMode === "loading" ? "Ajustando el recorrido a la red vial…" : routeMode === "road-network" ? `Geometría vial OSRM · ${activeRoute?.road_geometry ? "alternativa evaluada" : "solo referencia visual"}${routeGeometry?.distance_m ? ` · ${(routeGeometry.distance_m / 1000).toFixed(2)} km` : ""}` : routeMode === "camera-chord" ? "Estimación directa; enrutador vial no disponible" : ""}/>
  </section>;

  const legend = <div className="legend" aria-label="Leyenda del mapa"><span><i className="physical"/>Física</span><span><i className="simulated"/>Simulada</span><span><i className="offline"/>Sin conexión</span></div>;
  const camerasPill = <CountPill value={cameras.length} label="Cámaras Registradas"/>;
  const resultPills = <>
    <CountPill value={result?.candidate_detection_count ?? 0} label="Detecciones candidatas" tone={showingRoute ? "solid" : "gradient"}/>
    <CountPill value={result?.routes.length ?? 0} label="Rutas posibles" tone={showingRoute ? "solid" : "gradient"}/>
  </>;

  let stage: ReactNode;
  if (view === "Administración" && user?.role === "admin") stage = <div className="stage single admin-stage"><AdminPanel cameras={cameras} onDeviceDeleted={(id) => setCameras((current) => current.filter((camera) => camera.id !== id))}/></div>;
  else if (view === "Cámaras") stage = <div className="stage">
    <div className="stage-main">
      <label className="search-pill"><Icon name="search" size={38}/><input aria-label="Filtrar cámaras" placeholder="Buscar nombre o identificador..." value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}/></label>
      {devicesPanel}
    </div>
    <aside className="stage-aside" aria-label="Estado de la red">
      {camerasPill}
      {sourceCard}
      <section className="camera-selection" aria-label="Cámara seleccionada"><Icon name="target" size={42}/><h2>Seleccionadas</h2><p>{selected ? `${selected.name} | ${selected.lat.toFixed(4)}, ${selected.lng.toFixed(4)}` : "Ninguna"}</p>
        {selected && selected.kind === "physical" && <div className="camera-activity" role="status">
          <span className={`device-status ${deviceActivity(selected).tone}`}><i/>{deviceActivity(selected).label}</span>
          {activityDetail(selected.activity) && <small>{activityDetail(selected.activity)}</small>}
          {deviceActivity(selected).tone !== "ok" && deviceActivity(selected).explanation && <small>{deviceActivity(selected).explanation}</small>}
        </div>}
      </section>
    </aside>
    {mapPanel}
  </div>;
  else if (view === "Consultas") stage = <div className={`stage ${detail ? "result-stage" : ""}`}>
    <div className="stage-main">
      {detail ? routePanel : <><label className="search-pill"><Icon name="search" size={38}/><input id="history-filter" aria-label="Buscar consulta" placeholder="Buscar consulta" value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}/></label>{historyPanel}</>}
    </div>
    <aside className="stage-aside" aria-label="Resumen de la consulta">{camerasPill}{sourceCard}{resultPills}</aside>
    {mapPanel}
  </div>;
  else stage = <div className={`stage ${composing ? "" : "compact"}`}>
    <div className="stage-main">
      <button type="button" className={`search-pill launcher ${composing ? "open" : ""}`} aria-expanded={composing} aria-controls="query-form" onClick={() => swap(() => setComposing((open) => !open))}>
        <Icon name="search" size={38}/><span>Nueva consulta</span>
      </button>
      {composing && queryForm}
    </div>
    <aside className="stage-aside" aria-label="Estado de la red">
      {camerasPill}
      {(composing || source !== "central") && sourceCard}
      {composing && <><CountPill value={cameras.length} label="Nodos en el  mapa"/>{legend}</>}
    </aside>
    {mapPanel}
  </div>;

  // Where the demo guide stands, and what its steps and its button do.
  const guideStep: GuideStep = view === "Cámaras" ? "camaras" : view === "Consultas" ? detail ? "rutas" : "historial" : composing ? "consulta" : "red";
  function guideTo(step: GuideStep) {
    if (step === "red") { if (view !== "Resumen" || composing || detail) swap(() => { setView("Resumen"); setDetail(null); setComposing(false); }); }
    else if (step === "consulta") compose();
    else if (step === "rutas") { if (record) swap(() => { setView("Consultas"); setDetail("search"); }); else compose(); }
    else if (step === "camaras") go("Cámaras");
    else go("Consultas");
  }
  function guideNext() {
    if (guideStep === "red") compose();
    else if (guideStep === "consulta") (document.getElementById("query-form") as HTMLFormElement | null)?.requestSubmit();
    else if (guideStep === "rutas") { if (activeRoute) go("Cámaras"); else compose(); }
    else if (guideStep === "camaras") go("Consultas");
  }
  const signIn = () => { window.history.replaceState(null, "", "/?entrar=1"); window.location.reload(); };
  const guide = !user && <DemoGuide step={guideStep} empty={guideStep === "rutas" && !activeRoute} onStep={guideTo} onNext={guideNext} onSignIn={signIn}/>;

  const initials = user ? user.display_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() : "DE";
  const adminActive = view === "Administración";

  return <div className="app-shell">
    <a className="skip-link" href="#workspace">Saltar al contenido</a>
    {/* The active section's circle fills from the bottom; the one left behind drains (CSS). */}
    <aside className="rail">
      <button type="button" className="rail-brand" onClick={() => go("Resumen")} aria-label="VIGÍA, resumen"><BrandMark size={61}/></button>
      {/* The gear is the administration entry: audit and node credentials. */}
      {user?.role === "admin" ? <button type="button" className={`rail-gear ${adminActive ? "active" : ""}`} aria-current={adminActive ? "page" : undefined} aria-label="Administración" title="Administración" onClick={() => go("Administración")}><Icon name="settings" size={30}/>{adminActive && <span className="rail-gear-label" aria-hidden="true">Administración</span>}</button> : <span className="rail-gear-space" aria-hidden="true"/>}
      <nav className="rail-nav" aria-label="Navegación principal">{navigation.map((item) => <button key={item.label} aria-current={view === item.label ? "page" : undefined} className={view === item.label ? "active" : ""} onClick={() => go(item.label)}>
        <span className="rail-icon"><Icon name={item.icon} size={30}/></span><span>{item.label}</span>
      </button>)}</nav>
    </aside>
    <div className="workspace" id="workspace">
      <header className="topbar">
        <BrandMark size={40}/>
        <div className="account" ref={menuRef}>
          <span className="account-name">{user?.display_name ?? "Demostración"}</span>
          <button type="button" className="account-button" aria-label="Cuenta" aria-expanded={menuOpen} aria-controls="account-menu" onClick={() => setMenuOpen((open) => !open)}><Icon name="user" size={33}/></button>
          <span className="avatar" aria-hidden="true">{initials}</span>
          {menuOpen && <div className="account-menu" id="account-menu">
            <b>{user?.display_name ?? "Demostración"}</b>
            <small>{user ? `${ROLE_LABELS[user.role]} · ${user.email}` : "Sin sesión · datos de ejemplo"}</small>
            {user ? <button type="button" className="card-button" onClick={logout}>Cerrar sesión</button> : <button type="button" className="card-button" onClick={signIn}>Iniciar sesión</button>}
          </div>}
        </div>
      </header>
      <div className="title-row">
        {(canGoBack || exitDemo) && <button type="button" className="back-button" onClick={exitDemo ?? back} aria-label={exitDemo ? "Volver al inicio" : "Volver"} title={exitDemo ? "Volver al inicio" : undefined}><Icon name="back" size={38}/></button>}
        <h1 className={isResumen ? "visually-hidden" : "figma-title"}>{title}</h1>
        <div className={`network-pill ${source}`} role="status" aria-label={`Red Barranquilla · ${SOURCE_STATUS[source]}`}><span className="network-icon"><Icon name="signal" size={42}/></span><span aria-hidden="true">Red Barranquilla</span></div>
      </div>
      {guide}
      <main>{stage}</main>
      <footer className="workspace-footer"><span>© 2026 Equipo VIGÍA</span></footer>
    </div>
  </div>;
}
