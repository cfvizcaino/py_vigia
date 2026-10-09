"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icon";
import { OperationsConsole } from "./operations-console";

export type SessionUser = { id: string; email: string; display_name: string; role: "operator" | "admin" };
type State = { kind: "loading" } | { kind: "anonymous"; offline: boolean } | { kind: "user"; user: SessionUser } | { kind: "demo" };

/**
 * Chooses what to render. It is not a security boundary: every API route
 * re-checks the session on the server and the backend enforces roles.
 */
export function ConsoleGate() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    // A late answer must not undo a choice made meanwhile (e.g. opening the demo).
    const settle = (next: State) => setState((current) => current.kind === "loading" ? next : current);
    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const next: State = response.ok ? { kind: "user", user: (await response.json()).user } : { kind: "anonymous", offline: response.status >= 500 };
        settle(next);
      })
      .catch(() => { if (!controller.signal.aborted) settle({ kind: "anonymous", offline: true }); });
    return () => controller.abort();
  }, []);

  if (state.kind === "user") return <OperationsConsole user={state.user}/>;
  if (state.kind === "demo") return <OperationsConsole user={null}/>;
  return <LoginScreen loading={state.kind === "loading"} offline={state.kind === "anonymous" && state.offline} onLogin={(user) => setState({ kind: "user", user })} onDemo={() => setState({ kind: "demo" })}/>;
}

function LoginScreen({ loading, offline, onLogin, onDemo }: { loading: boolean; offline: boolean; onLogin: (user: SessionUser) => void; onDemo: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No fue posible iniciar sesión.");
      setPassword("");
      onLogin(body.user);
    } catch (error) {
      setError(error instanceof Error ? error.message : "No fue posible iniciar sesión.");
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="login-shell">
    <section className="panel login-card" aria-labelledby="login-title">
      <div className="brand login-brand"><span className="brand-mark"><Icon name="shield" size={27}/></span><span><strong>VIGIA<span>●</span></strong><small>INTELIGENCIA COMUNITARIA</small></span></div>
      <h1 id="login-title">Inicia sesión</h1>
      <p>Las consultas, el video de las cámaras y las exportaciones requieren una cuenta autorizada y quedan registradas.</p>
      <form onSubmit={submit}>
        <fieldset disabled={loading || submitting}>
          <label>Correo<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required/></label>
          <label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required/></label>
          <button className="primary-action" type="submit">{submitting ? <><span className="spinner"/>Validando…</> : <>Entrar<Icon name="arrow" size={17}/></>}</button>
        </fieldset>
      </form>
      {error && <p className="error-message" role="alert">{error}</p>}
      {offline && <p className="form-help" role="status"><Icon name="layers" size={15}/>El servicio central no responde. Puedes revisar la consola con datos de ejemplo.</p>}
      <button className="text-action login-demo" type="button" onClick={onDemo}>Explorar demo<Icon name="arrow" size={14}/></button>
    </section>
  </main>;
}
