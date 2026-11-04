"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icon";
import { observationDate, observationTime, type Device } from "@/lib/monitoring";

type AuditEntry = {
  action: string;
  outcome: string;
  occurred_at: string;
  user_id: string | null;
  user_email: string | null;
  camera_id: string | null;
  credential_id: string | null;
  detail: Record<string, unknown> | null;
};
type Credential = { id: string; camera_id: string; created_at: string; expires_at: string; revoked: boolean };
type Issued = Credential & { secret: string };

const PAGE_SIZE = 50;
const CATEGORIES = [
  { id: "", label: "Todo" },
  { id: "sessions", label: "Sesiones" },
  { id: "queries", label: "Consultas" },
  { id: "changes", label: "Cambios" },
  { id: "credentials", label: "Credenciales" },
  { id: "denied", label: "Denegados" },
] as const;
const ACTIONS: Record<string, string> = {
  "auth.login": "Inicio de sesión",
  "auth.logout": "Cierre de sesión",
  "query.executed": "Consulta de trayectorias",
  "query.exported": "Exportación de consulta",
  "preview.accessed": "Apertura de video",
  "device.created": "Cámara registrada",
  "device.updated": "Cámara editada",
  "device.deleted": "Cámara eliminada",
  "detection.created": "Detección creada",
  "detection.updated": "Detección corregida",
  "detection.deleted": "Detección eliminada",
  "detection.confirmed": "Recorte confirmado",
  "detection.unconfirmed": "Recorte descartado",
  "device.links_synced": "Enlaces de cámaras sincronizados",
  "device.links_sync_failed": "Sincronización de enlaces fallida",
  "query.plate": "Búsqueda por placa",
  "thumbnail.viewed": "Recorte consultado",
  "credential.issued": "Credencial emitida",
  "credential.revoked": "Credencial revocada",
  "ingest.denied": "Ingestión rechazada",
  "authz.denied": "Acción sin permiso",
  "user.created": "Persona creada",
  "user.set-password": "Contraseña cambiada",
  "user.disable": "Persona deshabilitada",
  "user.enable": "Persona habilitada",
};
// As in the Figma: an allowed event is a filled violet pill, anything else an outlined one
// (the word always says which, so colour is never the only cue).
const OUTCOMES: Record<string, { label: string; tone: "ok" | "warn" }> = {
  allowed: { label: "Permitido", tone: "ok" },
  invalid: { label: "Rechazado", tone: "warn" },
  locked: { label: "Bloqueado", tone: "warn" },
  forbidden: { label: "Sin permiso", tone: "warn" },
  wrong_camera: { label: "Cámara ajena", tone: "warn" },
};

function describe(entry: AuditEntry) {
  const detail = entry.detail ?? {};
  const text = (key: string) => typeof detail[key] === "string" ? detail[key] as string : "";
  const shortId = (value: string) => value.slice(0, 8);
  switch (entry.action) {
    case "query.executed": return `Consulta ${shortId(text("query"))} · ${detail.routes ?? 0} rutas · ${detail.detections ?? 0} detecciones`;
    case "query.exported": return `Consulta ${shortId(text("query"))} · ${detail.routes ?? 0} rutas`;
    case "preview.accessed": return `${text("camera")} · ${detail.kind === "stream" ? "transmisión" : "imagen"}`;
    case "device.updated": return `${text("camera")} · ${Array.isArray(detail.fields) ? detail.fields.join(", ") : ""}`;
    case "authz.denied": return Array.isArray(detail.required) && detail.required.includes("admin") ? "Requiere rol de administración" : "Rol insuficiente";
    case "user.created": return detail.role === "admin" ? "Rol: administración" : "Rol: operación";
    default: return text("camera") || entry.camera_id || (text("detection") ? `Detección ${shortId(text("detection"))}` : "");
  }
}

function credentialState(credential: Credential) {
  if (credential.revoked) return { label: "Revocada", icon: "close" as const, tone: "muted" };
  if (Date.parse(credential.expires_at.endsWith("Z") || credential.expires_at.includes("+") ? credential.expires_at : `${credential.expires_at}Z`) <= Date.now()) return { label: "Vencida", icon: "clock" as const, tone: "warn" };
  return { label: "Activa", icon: "check" as const, tone: "ok" };
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    window.location.reload();  // Session ended: the gate will ask to sign in.
    throw new Error("Tu sesión terminó.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "No fue posible completar la operación.");
  return body as T;
}

export function AdminPanel({ cameras }: { cameras: Device[] }) {
  return <section className="admin-grid" aria-label="Administración">
    <AuditPanel/>
    <CredentialsPanel cameras={cameras}/>
  </section>;
}

function AuditPanel() {
  const [category, setCategory] = useState("");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (append: boolean, before?: string) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const search = new URLSearchParams();
      if (category) search.set("category", category);
      if (before) search.set("before", before);
      const page = await readJson<AuditEntry[]>(await fetch(`/api/admin/audit?${search}`, { cache: "no-store", signal: controller.signal }));
      setEntries((current) => append ? [...current, ...page] : page);
      setHasMore(page.length === PAGE_SIZE);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "No fue posible cargar la auditoría.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    // Fetch-on-filter-change: the state updates happen in load()'s async callbacks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(false);
    return () => request.current?.abort();
  }, [load]);

  return <article className="admin-card audit-card" aria-busy={loading} aria-labelledby="audit-title">
    <h2 id="audit-title">Auditoría de uso</h2>
    <div className="audit-filters" role="group" aria-label="Filtrar por tipo de evento">
      {CATEGORIES.map((item) => <button key={item.id} className={category === item.id ? "selected" : ""} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}
    </div>
    {error && <p className="error-message admin-message" role="alert">{error}</p>}
    <div className="audit-body">
    <div className="audit-scroll" tabIndex={0} aria-label="Eventos auditados" ref={scrollRef}>
      <table className="audit-table">
        <caption className="visually-hidden">Eventos auditados, del más reciente al más antiguo. Hora de Colombia.</caption>
        <thead><tr><th scope="col">Fecha y hora</th><th scope="col">Evento</th><th scope="col">Persona</th><th scope="col">Resultado</th></tr></thead>
        <tbody>{entries.map((entry, index) => {
          const outcome = OUTCOMES[entry.outcome] ?? { label: entry.outcome, tone: "warn" as const };
          const detail = describe(entry);
          return <tr key={`${entry.occurred_at}-${index}`}>
            <td data-label="Fecha"><span className="audit-when"><span className="audit-time">{observationTime(entry.occurred_at)}</span><small>{observationDate(entry.occurred_at)}</small></span></td>
            <td data-label="Evento" title={detail || undefined}>{ACTIONS[entry.action] ?? entry.action}{detail && <span className="visually-hidden"> · {detail}</span>}</td>
            <td data-label="Persona" className="audit-person">{entry.user_email ?? "Sistema o nodo"}</td>
            <td data-label="Resultado"><span className={`admin-pill ${outcome.tone}`}>{outcome.label}</span></td>
          </tr>;
        })}</tbody>
      </table>
      {!entries.length && !loading && !error && <p className="admin-empty">Sin eventos para este filtro. Cuando alguien inicie sesión, consulte o exporte, el registro aparecerá aquí.</p>}
      {hasMore && !loading && <button className="admin-more" onClick={() => load(true, entries.at(-1)?.occurred_at)}>Cargar anteriores</button>}
    </div>
    <ScrollTrack target={scrollRef} watch={entries.length}/>
    </div>
    <p className="visually-hidden" role="status" aria-live="polite">{loading ? "Cargando eventos…" : `${entries.length} eventos mostrados`}</p>
  </article>;
}

/**
 * The audit list's scrollbar as drawn in the Figma (a faint track and a violet-to-white
 * thumb), which no browser draws natively. The list still scrolls natively (wheel, touch,
 * keyboard); the thumb can also be dragged and the track clicked. Decorative for screen readers.
 */
function ScrollTrack({ target, watch }: { target: React.RefObject<HTMLDivElement | null>; watch: number }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const list = target.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!list || !track || !thumb) return;
    const update = () => {
      const overflow = list.scrollHeight - list.clientHeight;
      setVisible(overflow > 1 && getComputedStyle(list).overflowY !== "visible");
      if (overflow <= 1) return;
      const size = Math.max(parseFloat(getComputedStyle(thumb).minHeight) || 40, track.clientHeight * list.clientHeight / list.scrollHeight);
      thumb.style.height = `${size}px`;
      thumb.style.transform = `translateY(${(track.clientHeight - size) * list.scrollTop / overflow}px)`;
    };
    update();
    list.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(list);
    if (list.firstElementChild) resize.observe(list.firstElementChild);
    return () => { list.removeEventListener("scroll", update); resize.disconnect(); };
  }, [target, watch]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const list = target.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!list || !track || !thumb) return;
    event.preventDefault();
    const travel = track.clientHeight - thumb.offsetHeight;
    const ratio = (list.scrollHeight - list.clientHeight) / Math.max(1, travel);
    if (event.target !== thumb) {
      // A click on the track centres the thumb there.
      const offset = event.clientY - track.getBoundingClientRect().top - thumb.offsetHeight / 2;
      list.scrollTo({ top: offset * ratio, behavior: "smooth" });
      return;
    }
    const startY = event.clientY;
    const startTop = list.scrollTop;
    thumb.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => { list.scrollTop = startTop + (moveEvent.clientY - startY) * ratio; };
    const end = () => { thumb.removeEventListener("pointermove", move); thumb.removeEventListener("pointerup", end); thumb.removeEventListener("pointercancel", end); };
    thumb.addEventListener("pointermove", move);
    thumb.addEventListener("pointerup", end);
    thumb.addEventListener("pointercancel", end);
  }

  return <div className={`audit-track ${visible ? "" : "hidden"}`} ref={trackRef} onPointerDown={onPointerDown} aria-hidden="true">
    <div className="audit-thumb" ref={thumbRef}/>
  </div>;
}

function CredentialsPanel({ cameras }: { cameras: Device[] }) {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [camera, setCamera] = useState(cameras[0]?.external_id ?? "");
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState("");
  const selectedCamera = camera || cameras[0]?.external_id || "";

  const refresh = useCallback(async () => {
    try {
      setCredentials(await readJson<Credential[]>(await fetch("/api/admin/credentials", { cache: "no-store" })));
    } catch (error) {
      setError(error instanceof Error ? error.message : "No fue posible cargar las credenciales.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  async function issue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      setIssued(await readJson<Issued>(await fetch("/api/admin/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ camera_id: selectedCamera, days }) })));
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "No fue posible emitir la credencial.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/credentials/${id}`, { method: "DELETE" });
      if (response.status !== 204) await readJson(response);
      setConfirming("");
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "No fue posible revocar la credencial.");
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.secret);
      setCopied(true);
    } catch {
      setError("El navegador no permitió copiar. Selecciona el token y cópialo manualmente.");
    }
  }

  const ordered = [...credentials].sort((a, b) => Number(a.revoked) - Number(b.revoked) || b.created_at.localeCompare(a.created_at));

  return <article className="admin-card credentials-card" aria-labelledby="credentials-title">
    <h2 id="credentials-title">Credenciales</h2>
    <form className="credential-form" onSubmit={issue}>
      <fieldset disabled={busy || !cameras.length}>
        <label><span>Cámara</span><span className="admin-select"><select value={selectedCamera} onChange={(event) => setCamera(event.target.value)}>{cameras.map((item) => <option key={item.id} value={item.external_id}>{item.external_id} · {item.name}</option>)}</select><Icon name="chevron" size={24}/></span></label>
        <label><span>Vigencia</span><span className="admin-select"><select value={days} onChange={(event) => setDays(Number(event.target.value))}>{[30, 90, 180, 365].map((value) => <option key={value} value={value}>{value} días</option>)}</select><Icon name="chevron" size={24}/></span></label>
        <button className="issue-button" type="submit">{busy ? <><span className="spinner"/>Procesando…</> : "Emitir credencial"}</button>
      </fieldset>
    </form>
    {issued && <div className="secret-callout" role="region" aria-label="Token recién emitido">
      <p><b>Copia este token ahora.</b> No se volverá a mostrar. Instálalo en el <code>.env</code> del nodo {issued.camera_id} como <code>VIGIA_CENTRAL_API_TOKEN</code>.</p>
      <code className="secret-value">{issued.secret}</code>
      <div className="secret-actions">
        <button className="admin-pill ok" type="button" onClick={copySecret}>{copied && <Icon name="check" size={30}/>}{copied ? "Copiado" : "Copiar token"}</button>
        <button className="admin-pill outline" type="button" onClick={() => setIssued(null)}>Ya lo guardé</button>
      </div>
      <span className="visually-hidden" role="status" aria-live="polite">{copied ? "Token copiado al portapapeles" : ""}</span>
    </div>}
    {error && <p className="error-message admin-message" role="alert">{error}</p>}
    <ul className="credential-list">{ordered.map((credential) => {
      const state = credentialState(credential);
      const active = state.tone === "ok";
      return <li key={credential.id}>
        <b className="credential-camera">{credential.camera_id}</b>
        <span className="credential-dates">Emitida {observationDate(credential.created_at)} · vence {observationDate(credential.expires_at)}</span>
        <span className={`admin-pill wide ${active ? "ok" : "warn"}`}>{active && <Icon name="check" size={30}/>}{state.label}</span>
        {active && confirming !== credential.id && <button className="admin-pill wide outline" onClick={() => setConfirming(credential.id)} disabled={busy} aria-label={`Revocar credencial de ${credential.camera_id}`}>Revocar</button>}
        {active && confirming === credential.id && <div className="revoke-confirm" role="group" aria-label={`Confirmar revocación de ${credential.camera_id}`}>
          <span>El nodo {credential.camera_id} dejará de publicar detecciones.</span>
          <button className="admin-pill wide outline" onClick={() => setConfirming("")} disabled={busy}>Cancelar</button>
          <button className="admin-pill wide ok" onClick={() => revoke(credential.id)} disabled={busy}>Revocar</button>
        </div>}
      </li>;
    })}</ul>
    {!credentials.length && !error && <p className="admin-empty">Sin credenciales. Emite una para que el nodo edge pueda publicar detecciones.</p>}
  </article>;
}
