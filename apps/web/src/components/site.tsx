"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "./brand";

type Actions = { onSignIn?: () => void; onDemo?: () => void };

/** Buttons when the console gate is mounted; links back to it from other pages. */
function SignInAction({ onSignIn, className }: { onSignIn?: () => void; className: string }) {
  return onSignIn ? <button type="button" className={className} onClick={onSignIn}>Inicia sesión</button> : <Link className={className} href="/?entrar=1">Inicia sesión</Link>;
}
function DemoAction({ onDemo, label = "Explorar demo" }: { onDemo?: () => void; label?: string }) {
  return onDemo ? <button type="button" className="pill-figma" onClick={onDemo}>{label}</button> : <Link className="pill-figma" href="/?demo=1">{label}</Link>;
}

/** «Más» in the Figma navigation: holds the pages the design leaves out of the bar. */
function MoreMenu({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return <div className="more-menu" ref={ref}>
    <button type="button" aria-expanded={open} aria-controls="more-links" aria-current={current === "app" ? "page" : undefined} onClick={() => setOpen((value) => !value)}>Más</button>
    {open && <div id="more-links"><Link href="/app">App Android</Link></div>}
  </div>;
}

export function SiteHeader({ current, onSignIn }: { current: "inicio" | "nosotros" | "app" } & Actions) {
  return <header className="site-header">
    <Link href="/" className="site-brand" aria-label="VIGÍA, inicio"><BrandMark size={61}/></Link>
    <nav className="site-nav" aria-label="Sitio">
      <Link href="/" aria-current={current === "inicio" ? "page" : undefined}>Home</Link>
      <Link href="/nosotros" aria-current={current === "nosotros" ? "page" : undefined}>Nosotros</Link>
      <Link href="/#soluciones">Soluciones</Link>
      <MoreMenu current={current}/>
    </nav>
    <div className="site-actions">
      {/* Accounts are created by an administrator: «Regístrate» leads to sign-in, which says so. */}
      <Link className="site-register" href="/?entrar=1">Regístrate</Link>
      <SignInAction onSignIn={onSignIn} className="site-signin"/>
    </div>
  </header>;
}

export function SiteClosing({ onDemo }: Actions) {
  return <section className="site-closing" aria-labelledby="closing-title">
    <h2 id="closing-title" className="gray-title">El siguiente movimiento es tuyo.</h2>
    <p>Descubre el potencial de VIGÍA y da el primer paso hacia una nueva forma de abordar la inteligencia vehicular.</p>
    <DemoAction onDemo={onDemo}/>
  </section>;
}

export function SiteFooter() {
  return <footer className="site-footer">
    <div className="footer-top">
      <span className="footer-brand"><BrandMark size={22}/>VIGÍA · Piloto en Barranquilla, Colombia</span>
      <nav aria-label="Pie de página"><Link href="/">Inicio</Link><Link href="/nosotros">Nosotros</Link><Link href="/app">App Android</Link></nav>
    </div>
    <LegalNotice/>
  </footer>;
}

/** Rights and legal notices, shared by the public site and the download page. */
export function LegalNotice() {
  return <div className="legal">
    <p><b>© {COPYRIGHT_YEAR} Equipo VIGÍA. Todos los derechos reservados.</b> Trayectorias estimadas: no constituyen una identificación confirmada.</p>
    <p>Datos personales (Ley 1581 de 2012): el video se procesa en las cámaras y teléfonos del piloto y al servidor solo llegan metadatos. Los recortes y las placas se guardan 7 días, solo los ve un administrador y cada acceso queda registrado.</p>
    <p>Android es una marca de Google LLC. iPhone es una marca de Apple Inc. Usa software y datos de terceros con sus propias licencias: Ultralytics YOLO (AGPL-3.0), OpenStreetMap (ODbL, © colaboradores de OpenStreetMap) y Material Symbols de Google (Apache-2.0).</p>
  </div>;
}

const COPYRIGHT_YEAR = 2026;

const STEPS: { id: string; title: string; text: string; scene: ReactNode }[] = [
  { id: "captura", title: "Captura", text: "Una cámara o dispositivo compatible registra la presencia de vehículos.", scene: <CaptureScene/> },
  { id: "analisis", title: "Análisis", text: "Nuestros modelos procesan las imágenes, detectan vehículos y extraen características relevantes.", scene: <AnalysisScene/> },
  { id: "conexion", title: "Conexión", text: "Los eventos se envían de forma segura a la plataforma central.", scene: <ConnectionScene/> },
  { id: "exploracion", title: "Exploración", text: "La consola relaciona las observaciones y propone recorridos posibles, cada uno con su puntaje y su evidencia.", scene: <ExplorationScene/> },
];

export function Landing({ onSignIn, onDemo }: Required<Actions>) {
  const [step, setStep] = useState(0);

  function onStepKey(event: React.KeyboardEvent, index: number) {
    const next = event.key === "ArrowDown" || event.key === "ArrowRight" ? index + 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? index - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = (next + STEPS.length) % STEPS.length;
    setStep(target);
    document.getElementById(`step-tab-${STEPS[target].id}`)?.focus();
  }

  return <div className="site">
    <SiteHeader current="inicio" onSignIn={onSignIn}/>
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">De observaciones aisladas a <span>recorridos posibles.</span></h1>
        <p>VIGÍA convierte las detecciones de tus cámaras en trayectorias estimadas de vehículos, en segundos.</p>
        <DemoAction onDemo={onDemo}/>
        <div className="hero-glow" aria-hidden="true"/>
        <figure className="hero-frame">
          <Image src="/landing/consola-figma.webp" alt="Consola de VIGÍA en modo demostración: trayectoria estimada de un automóvil blanco con dos rutas candidatas, su recorrido por cámaras y el mapa de Barranquilla" width={1600} height={773} priority sizes="(max-width: 900px) 100vw, 1200px"/>
        </figure>
      </section>

      <section className="solutions" id="soluciones" aria-labelledby="solutions-title">
        <h2 id="solutions-title" className="gray-title">Inteligencia que conecta cada observación.</h2>
        <a className="explore-link" href="#proceso">Explorar soluciones</a>
        <div className="solution-grid">
          <article className="solution detection"><div className="solution-visual"><DetectionVisual/></div><h3>Detección inteligente</h3><p>Identificamos vehículos y analizamos características como su tipo y color mediante modelos de visión por computador.</p></article>
          <article className="solution network"><div className="solution-visual framed"><NetworkVisual/></div><h3>Procesamiento distribuido</h3><p>Procesamos imágenes cerca de las cámaras y conectamos los eventos relevantes en una plataforma central.</p></article>
          <article className="solution routes"><div className="solution-visual framed"><RouteVisual/></div><h3>Análisis de recorridos</h3><p>Relacionamos observaciones para visualizar y explorar posibles trayectorias vehiculares.</p></article>
        </div>
      </section>

      <section className="process" id="proceso" aria-labelledby="process-title">
        <h2 id="process-title" className="gray-title">De la cámara al análisis.</h2>
        <p className="process-lede">De cada imagen, una pista. De cada pista, una posible ruta.</p>
        <div className="process-body">
          <div className="process-steps" role="tablist" aria-orientation="vertical" aria-label="Etapas de VIGÍA">
            {STEPS.map((item, index) => <button key={item.id} id={`step-tab-${item.id}`} role="tab" type="button" aria-selected={step === index} aria-controls={`step-panel-${item.id}`} tabIndex={step === index ? 0 : -1} onClick={() => setStep(index)} onKeyDown={(event) => onStepKey(event, index)}>
              <b>{item.title}</b><span>{item.text}</span>
            </button>)}
          </div>
          <div className="process-stage" id={`step-panel-${STEPS[step].id}`} role="tabpanel" aria-labelledby={`step-tab-${STEPS[step].id}`}>
            <div className="process-screen" key={STEPS[step].id}>{STEPS[step].scene}</div>
          </div>
        </div>
      </section>

      <SiteClosing onDemo={onDemo}/>
    </main>
    <SiteFooter/>
  </div>;
}

/* Diagrams: exact geometry describing what each stage does, not pictures. */

function DetectionVisual() {
  return <svg className="visual-svg" viewBox="0 0 280 200" aria-hidden="true">
    <defs><radialGradient id="det-glow"><stop offset="0" stopColor="var(--violet)" stopOpacity=".55"/><stop offset="1" stopColor="var(--violet)" stopOpacity="0"/></radialGradient></defs>
    <circle cx="140" cy="100" r="96" fill="url(#det-glow)"/>
    <path d="M84 70h-14v14m140-14h14v14M84 150H70v-14m140 14h14v-14" stroke="var(--ink)" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    <path d="M96 128v-14l14-22h60l14 22v14z" fill="none" stroke="var(--violet-soft)" strokeWidth="2"/>
    <circle cx="112" cy="130" r="8" fill="var(--canvas)" stroke="var(--violet-soft)" strokeWidth="2"/><circle cx="168" cy="130" r="8" fill="var(--canvas)" stroke="var(--violet-soft)" strokeWidth="2"/>
    <rect x="70" y="40" width="112" height="22" rx="11" fill="var(--violet)"/>
    <text x="126" y="55" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="var(--font-body)">Automóvil · blanco</text>
  </svg>;
}

function NetworkVisual() {
  const nodes = [[60, 50], [220, 44], [46, 150], [228, 156], [140, 30]];
  return <svg className="visual-svg" viewBox="0 0 280 200" aria-hidden="true">
    {nodes.map(([x, y]) => <line key={`${x}${y}`} x1={x} y1={y} x2="140" y2="100" stroke="var(--violet-soft)" strokeOpacity=".5" strokeWidth="1.5" strokeDasharray="3 5"/>)}
    {nodes.map(([x, y]) => <circle key={`n${x}${y}`} cx={x} cy={y} r="7" fill="var(--surface-3)" stroke="var(--violet-soft)" strokeWidth="2"/>)}
    <circle cx="140" cy="100" r="18" fill="var(--violet)"/>
    <path d="M132 100h16m-8-8v16" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
  </svg>;
}

function RouteVisual() {
  const stops = [[78, 140], [120, 96], [176, 112], [206, 60]];
  return <svg className="visual-svg" viewBox="0 0 280 200" aria-hidden="true">
    <path d="M56 70h168M56 124h168M108 24v152M168 24v152" stroke="var(--line)" strokeWidth="1"/>
    <polyline points={stops.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--violet-soft)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>
    {stops.map(([x, y], index) => <g key={x}><circle cx={x} cy={y} r="10" fill="var(--violet)"/><text x={x} y={y + 4} textAnchor="middle" fontSize="10" fill="#fff" fontFamily="var(--font-body)">{index + 1}</text></g>)}
  </svg>;
}

function CaptureScene() {
  return <svg viewBox="0 0 520 340" aria-hidden="true">
    <path d="M0 250 520 180M0 320 520 230" stroke="var(--line-strong)" strokeWidth="2"/>
    <path d="M0 285 520 205" stroke="var(--line-strong)" strokeDasharray="18 16" strokeWidth="2"/>
    <g className="scene-drive"><rect x="150" y="214" width="96" height="44" rx="12" fill="var(--surface-3)" stroke="var(--violet-soft)" strokeWidth="2"/><rect x="138" y="198" width="122" height="74" rx="6" fill="none" stroke="var(--violet)" strokeWidth="2.5"/></g>
    <path d="M40 40h-16v16m472-16h16v16M40 300H24v-16m472 16h16v-16" stroke="var(--ink)" strokeWidth="2.5" fill="none"/>
    <circle cx="52" cy="70" r="6" fill="var(--violet)"/><text x="66" y="75" fill="var(--muted)" fontSize="14" fontFamily="var(--font-body)">CAM-01 · 2 s por evento</text>
  </svg>;
}

function AnalysisScene() {
  const rows: [string, string][] = [["Tipo", "Automóvil"], ["Color", "Blanco"], ["Confianza", "0,91"], ["Dirección", "Norte"]];
  return <svg viewBox="0 0 520 340" aria-hidden="true">
    <rect x="40" y="60" width="200" height="140" rx="16" fill="var(--surface-3)"/>
    <rect x="70" y="100" width="140" height="70" rx="6" fill="none" stroke="var(--violet)" strokeWidth="2.5"/>
    <path d="M240 130h50" stroke="var(--violet-soft)" strokeWidth="2" strokeDasharray="4 6"/>
    {rows.map(([key, value], index) => <g key={key} transform={`translate(300 ${70 + index * 52})`}>
      <rect width="190" height="40" rx="20" fill="var(--surface-2)"/>
      <text x="20" y="25" fill="var(--muted)" fontSize="14" fontFamily="var(--font-body)">{key}</text>
      <text x="172" y="25" textAnchor="end" fill="var(--ink)" fontSize="14" fontFamily="var(--font-body)">{value}</text>
    </g>)}
  </svg>;
}

function ConnectionScene() {
  return <svg viewBox="0 0 520 340" aria-hidden="true">
    {[70, 170, 270].map((y) => <g key={y}><rect x="40" y={y - 22} width="110" height="44" rx="22" fill="var(--surface-2)"/><circle cx="64" cy={y} r="6" fill="var(--violet-soft)"/><text x="80" y={y + 5} fill="var(--ink)" fontSize="13" fontFamily="var(--font-body)">Edge</text>
      <path className="scene-packet" d={`M150 ${y}C250 ${y} 280 170 360 170`} fill="none" stroke="var(--violet)" strokeWidth="2" strokeDasharray="6 8"/></g>)}
    <rect x="360" y="110" width="128" height="120" rx="24" fill="var(--violet)"/>
    <text x="424" y="165" textAnchor="middle" fill="#fff" fontSize="15" fontFamily="var(--font-body)">Centro</text>
    <text x="424" y="186" textAnchor="middle" fill="#fff" fillOpacity=".75" fontSize="11" fontFamily="var(--font-body)">solo metadatos</text>
  </svg>;
}

function ExplorationScene() {
  const stops = [[90, 250], [190, 170], [300, 196], [420, 90]];
  return <svg viewBox="0 0 520 340" aria-hidden="true">
    <path d="M0 120h520M0 220h520M140 0v340M260 0v340M380 0v340" stroke="var(--line)"/>
    <circle cx="190" cy="170" r="120" fill="var(--violet)" fillOpacity=".08" stroke="var(--violet)" strokeOpacity=".5" strokeDasharray="5 6"/>
    <polyline className="scene-route" points={stops.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--violet-soft)" strokeWidth="4" strokeLinejoin="round"/>
    {stops.map(([x, y], index) => <g key={x}><circle cx={x} cy={y} r="13" fill="var(--violet)"/><text x={x} y={y + 5} textAnchor="middle" fill="#fff" fontSize="12" fontFamily="var(--font-body)">{index + 1}</text></g>)}
    <rect x="330" y="250" width="160" height="50" rx="25" fill="var(--surface-2)"/>
    <text x="352" y="281" fill="var(--ink)" fontSize="14" fontFamily="var(--font-body)">Ruta 1 · 82 / 100</text>
  </svg>;
}
