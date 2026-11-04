"use client";

import { animate } from "animejs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { enter, leave, reducedMotion } from "@/lib/motion";
import { BrandMark } from "./brand";
import { Icon } from "./icon";
import { OperationsConsole } from "./operations-console";
import { Landing } from "./site";

export type SessionUser = { id: string; email: string; display_name: string; role: "operator" | "admin" };
type State = { kind: "loading" } | { kind: "anonymous"; offline: boolean } | { kind: "user"; user: SessionUser } | { kind: "demo" };
type Screen = "landing" | "login";

/** `/?entrar=1` and `/?demo=1` come from pages outside the gate, such as /nosotros. */
function requestedEntry() {
  const params = new URLSearchParams(window.location.search);
  return params.has("demo") ? "demo" : params.has("entrar") ? "login" : null;
}

/** Dropped only once the session answer is used, so a remounted effect still sees it. */
function forgetEntry() {
  if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
}

/**
 * Chooses what to render. It is not a security boundary: every API route
 * re-checks the session on the server and the backend enforces roles.
 */
export function ConsoleGate() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [screen, setScreen] = useState<Screen>("landing");

  useEffect(() => {
    const controller = new AbortController();
    const entry = requestedEntry();
    // A late answer must not undo a choice made meanwhile (e.g. opening the demo).
    const settle = (next: State) => setState((current) => current.kind === "loading" ? next : current);
    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const next: State = response.ok ? { kind: "user", user: (await response.json()).user } : { kind: "anonymous", offline: response.status >= 500 };
        forgetEntry();
        if (next.kind === "anonymous" && entry === "demo") settle({ kind: "demo" });
        else { if (entry === "login") setScreen("login"); settle(next); }
      })
      .catch(() => { if (!controller.signal.aborted) { forgetEntry(); if (entry === "login") setScreen("login"); settle({ kind: "anonymous", offline: true }); } });
    return () => controller.abort();
  }, []);

  if (state.kind === "user") return <OperationsConsole user={state.user}/>;
  if (state.kind === "demo") return <OperationsConsole user={null}/>;
  if (state.kind === "loading") return <main className="splash" aria-busy="true"><BrandMark size={56} title="VIGÍA"/><span className="visually-hidden">Comprobando la sesión…</span></main>;
  // Each screen leaves before the next one comes in.
  const openDemo = () => leave("main, .site-header, .site-footer", () => setState({ kind: "demo" }));
  if (screen === "login") return <LoginScreen offline={state.offline} onLogin={(user) => leave(".login-shell", () => setState({ kind: "user", user }))} onDemo={openDemo} onBack={() => leave(".login-shell", () => setScreen("landing"))}/>;
  return <Landing onSignIn={() => leave(".site", () => { setScreen("login"); window.scrollTo(0, 0); })} onDemo={openDemo}/>;
}

function LoginScreen({ offline, onLogin, onDemo, onBack }: { offline: boolean; onLogin: (user: SessionUser) => void; onDemo: () => void; onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const cardRef = useRef<HTMLElement>(null);

  // The card rises out of a blur, then its pieces follow one after another.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || reducedMotion()) return;
    const rise = animate(card, { opacity: [0, 1], translateY: [48, 0], scale: [.96, 1], filter: ["blur(12px)", "blur(0px)"], duration: 1000, ease: "outExpo" });
    const parts = enter(card.querySelectorAll(".brand-mark, h1, :scope > p, .login-field, .login-submit, .login-demo"), { delay: 180, step: 70, distance: 18, duration: 800 });
    const back = animate(".login-back", { opacity: [0, 1], translateX: [-24, 0], duration: 800, delay: 300, ease: "outExpo" });
    return () => { rise.revert(); parts?.revert(); back.revert(); };
  }, []);

  // A refused sign-in shakes the card, the way a door does not open.
  useEffect(() => {
    if (!error || !cardRef.current || reducedMotion()) return;
    animate(cardRef.current, { translateX: [{ to: -14 }, { to: 12 }, { to: -8 }, { to: 5 }, { to: 0 }], duration: 520, ease: "inOutSine" });
  }, [error]);

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
    <button type="button" className="back-button login-back" onClick={onBack} aria-label="Volver al inicio"><Icon name="back" size={38}/></button>
    <section className="login-card" aria-labelledby="login-title" ref={cardRef}>
      <BrandMark size={61}/>
      <h1 id="login-title" className="figma-title">Inicia sesión</h1>
      <p>Las consultas, los recortes y las exportaciones requieren una cuenta autorizada y quedan registradas. Las cuentas las crea un administrador.</p>
      <form onSubmit={submit}>
        <fieldset disabled={submitting}>
          <label className="login-field"><span>Correo</span>
            <span className="login-input"><Icon name="user" size={30}/><input type="email" autoComplete="username" placeholder="nombre@dominio.co" value={email} onChange={(event) => setEmail(event.target.value)} required/></span>
          </label>
          <label className="login-field"><span>Contraseña</span>
            <span className="login-input"><Icon name="lock" size={30}/><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required/></span>
          </label>
          <button className="pill-figma login-submit" type="submit">{submitting ? <><span className="spinner"/>Validando…</> : "Entrar"}</button>
        </fieldset>
      </form>
      {error && <p className="error-message" role="alert">{error}</p>}
      {offline && <p className="login-note" role="status"><Icon name="alert" size={22}/>El servicio central no responde. Puedes revisar la consola con datos de ejemplo.</p>}
      <button className="text-link login-demo" type="button" onClick={onDemo}>Explorar demo sin cuenta</button>
    </section>
  </main>;
}
