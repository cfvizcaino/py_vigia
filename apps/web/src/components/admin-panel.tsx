"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icon";
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
  { id: "preview", label: "Video" },
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
  "credential.issued": "Credencial emitida",
  "credential.revoked": "Credencial revocada",
  "ingest.denied": "Ingestión rechazada",
  "authz.denied": "Acción sin permiso",
  "user.created": "Persona creada",
  "user.set-password": "Contraseña cambiada",
  "user.disable": "Persona deshabilitada",
  "user.enable": "Persona habilitada",
};
// Outcome is always shown as text + icon, never by color alone.
const OUTCOMES: Record<string, { label: string; icon: IconName; tone: "ok" | "warn" }> = {
  allowed: { label: "Permitido", icon: "check", tone: "ok" },
  invalid: { label: "Rechazado", icon: "close", tone: "warn" },
  locked: { label: "Bloqueado", icon: "alert", tone: "warn" },
  forbidden: { label: "Sin permiso", icon: "alert", tone: "warn" },
  wrong_camera: { label: "Cámara ajena", icon: "alert", tone: "warn" },
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

  return <article className="panel audit-card" aria-busy={loading}>
    <div className="card-heading">
      <div><span className="section-kicker">Trazabilidad</span><h2>Auditoría de uso</h2></div>
      <button className="icon-button" onClick={() => load(false)} disabled={loading} aria-label="Actualizar auditoría" title="Actualizar auditoría"><Icon name="refresh" size={18}/></button>
    </div>
    <div className="audit-filters" role="group" aria-label="Filtrar por tipo de evento">
      {CATEGORIES.map((item) => <button key={item.id} className={category === item.id ? "selected" : ""} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}
    </div>
    {error && <p className="error-message admin-message" role="alert">{error}</p>}
    {entries.length > 0 ? <div className="audit-table-wrap">
      <table className="audit-table">
        <caption className="visually-hidden">Eventos auditados, del más reciente al más antiguo. Hora de Colombia.</caption>
        <thead><tr><th scope="col">Fecha · hora</th><th scope="col">Evento</th><th scope="col">Persona</th><th scope="col">Resultado</th><th scope="col">Detalle</th></tr></thead>
        <tbody>{entries.map((entry, index) => {
          const outcome = OUTCOMES[entry.outcome] ?? { label: entry.outcome, icon: "layers" as const, tone: "warn" as const };
          return <tr key={`${entry.occurred_at}-${index}`}>
            <td data-label="Fecha"><span className="audit-when"><span className="audit-time">{observationTime(entry.occurred_at)}</span><small>{observationDate(entry.occurred_at)}</small></span></td>
            <td data-label="Evento"><b>{ACTIONS[entry.action] ?? entry.action}</b></td>
            <td data-label="Persona" className="audit-person">{entry.user_email ?? <span className="muted">Sistema o nodo</span>}</td>
            <td data-label="Resultado"><span className={`outcome ${outcome.tone}`}><Icon name={outcome.icon} size={13}/>{outcome.label}</span></td>
            <td data-label="Detalle" className="audit-detail">{describe(entry) || <span className="muted">—</span>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div> : !loading && !error && <div className="empty-state"><span className="empty-icon"><Icon name="shield" size={28}/></span><b>Sin eventos para este filtro</b><p>Cuando alguien inicie sesión, consulte, exporte o abra el video, el registro aparecerá aquí.</p></div>}
    <div className="audit-footer" role="status" aria-live="polite">
      {loading ? <span><span className="spinner"/>Cargando eventos…</span> : <span>{entries.length} eventos mostrados · hora de Colombia</span>}
      {hasMore && !loading && <button className="text-action" onClick={() => load(true, entries.at(-1)?.occurred_at)}>Cargar anteriores<Icon name="arrow" size={14}/></button>}
    </div>
  </article>;
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

  return <article className="panel credentials-card">
    <div className="card-heading"><div><span className="section-kicker">Identidad de nodos edge</span><h2>Credenciales <span className="count-badge">{credentials.filter((c) => credentialState(c).tone === "ok").length}</span></h2></div><Icon name="key"/></div>
    <form className="credential-form" onSubmit={issue}>
      <fieldset disabled={busy || !cameras.length}>
        <label>Cámara<select value={selectedCamera} onChange={(event) => setCamera(event.target.value)}>{cameras.map((item) => <option key={item.id} value={item.external_id}>{item.external_id} · {item.name}</option>)}</select></label>
        <label>Vigencia<select value={days} onChange={(event) => setDays(Number(event.target.value))}>{[30, 90, 180, 365].map((value) => <option key={value} value={value}>{value} días</option>)}</select></label>
        <button className="primary-action" type="submit">{busy ? <><span className="spinner"/>Procesando…</> : <><Icon name="key" size={16}/>Emitir credencial</>}</button>
      </fieldset>
    </form>
    {issued && <div className="secret-callout" role="region" aria-label="Token recién emitido">
      <p><Icon name="alert" size={16}/><span><b>Copia este token ahora.</b> No se volverá a mostrar. Instálalo en el <code>.env</code> del nodo {issued.camera_id} como <code>VIGIA_CENTRAL_API_TOKEN</code>.</span></p>
      <code className="secret-value">{issued.secret}</code>
      <div className="secret-actions">
        <button className="secondary-action" type="button" onClick={copySecret}><Icon name={copied ? "check" : "copy"} size={16}/>{copied ? "Copiado" : "Copiar token"}</button>
        <button className="text-action" type="button" onClick={() => setIssued(null)}>Ya lo guardé</button>
      </div>
      <span className="visually-hidden" role="status" aria-live="polite">{copied ? "Token copiado al portapapeles" : ""}</span>
    </div>}
    {error && <p className="error-message admin-message" role="alert">{error}</p>}
    <ul className="credential-list">{ordered.map((credential) => {
      const state = credentialState(credential);
      return <li key={credential.id}>
        <div className="credential-main">
          <b>{credential.camera_id}</b>
          <small>Emitida {observationDate(credential.created_at)} · vence {observationDate(credential.expires_at)}</small>
        </div>
        <span className={`outcome ${state.tone}`}><Icon name={state.icon} size={13}/>{state.label}</span>
        {state.tone === "ok" && (confirming === credential.id
          ? <div className="revoke-confirm" role="group" aria-label={`Confirmar revocación de ${credential.camera_id}`}>
              <span>El nodo dejará de publicar.</span>
              <button className="text-action" onClick={() => setConfirming("")} disabled={busy}>Cancelar</button>
              <button className="danger-action" onClick={() => revoke(credential.id)} disabled={busy}>Revocar</button>
            </div>
          : <button className="text-action revoke-action" onClick={() => setConfirming(credential.id)} disabled={busy} aria-label={`Revocar credencial de ${credential.camera_id}`}>Revocar</button>)}
      </li>;
    })}</ul>
    {!credentials.length && !error && <div className="empty-state"><b>Sin credenciales</b><p>Emite una para que el nodo edge pueda publicar detecciones.</p></div>}
  </article>;
}
