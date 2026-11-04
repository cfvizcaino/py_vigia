"use client";

import { animate, onScroll, stagger, utils } from "animejs";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { enter, leave, liquidMove, reducedMotion, scrollToY } from "@/lib/motion";
import { BrandMark } from "./brand";

type Actions = { onSignIn?: () => void; onDemo?: () => void };

/**
 * A link that lets the page leave before the next one arrives. An anchor on the same
 * page scrolls there smoothly instead of jumping.
 */
export function MotionLink({ href, className, children, ...rest }: { href: string; className?: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const router = useRouter();
  const pathname = usePathname();
  function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    rest.onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const [path, hash] = href.split("#");
    if (hash && (path || "/") === pathname) {
      const target = document.getElementById(hash);
      if (!target) return;
      event.preventDefault();
      scrollToY(target.getBoundingClientRect().top + window.scrollY - 24);
      window.history.replaceState(null, "", `#${hash}`);
      return;
    }
    if (reducedMotion() || (path || "/") === pathname) return;
    event.preventDefault();
    leave(".site main, .site-footer, .site-header .site-actions", () => router.push(href));
  }
  return <Link href={href} className={className} {...rest} onClick={onClick}>{children}</Link>;
}

/** Buttons when the console gate is mounted; links back to it from other pages. */
function SignInAction({ onSignIn, className }: { onSignIn?: () => void; className: string }) {
  return onSignIn ? <button type="button" className={className} onClick={onSignIn}>Inicia sesión</button> : <MotionLink className={className} href="/?entrar=1">Inicia sesión</MotionLink>;
}
function DemoAction({ onDemo, label = "Explorar demo" }: { onDemo?: () => void; label?: string }) {
  return onDemo ? <button type="button" className="pill-figma" onClick={onDemo} data-enter>{label}</button> : <MotionLink className="pill-figma" href="/?demo=1" data-enter>{label}</MotionLink>;
}

/** «Más» in the Figma navigation: holds the pages the design leaves out of the bar. */
function MoreMenu({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    if (listRef.current && !reducedMotion()) animate(listRef.current, { opacity: [0, 1], translateY: [-8, 0], scale: [.96, 1], duration: 380, ease: "outExpo" });
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return <div className="more-menu" ref={ref}>
    <button type="button" data-nav aria-expanded={open} aria-controls="more-links" aria-current={current === "app" ? "page" : undefined} onClick={() => setOpen((value) => !value)}>Más</button>
    {open && <div id="more-links" ref={listRef}><MotionLink href="/app">App Android</MotionLink></div>}
  </div>;
}

/** The navigation's drop: it rests under the current page and flows to whatever the pointer visits. */
function useNavDrop() {
  const navRef = useRef<HTMLElement>(null);
  const dropRef = useRef<HTMLSpanElement>(null);
  const restOn = (item: Element | null | undefined, instant = false) => {
    const nav = navRef.current;
    const drop = dropRef.current;
    if (!nav || !drop) return;
    if (!item) {
      drop.style.opacity = "0";
      return;
    }
    const box = (item as HTMLElement).getBoundingClientRect();
    const origin = nav.getBoundingClientRect();
    drop.style.opacity = "1";
    liquidMove(drop, "x", box.left - origin.left, box.width, instant);
  };
  const current = () => navRef.current?.querySelector('[data-nav][aria-current="page"]');
  useLayoutEffect(() => {
    restOn(current(), true);
    const onResize = () => restOn(current(), true);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const handlers = {
    onPointerOver: (event: React.PointerEvent) => restOn((event.target as Element).closest("[data-nav]")),
    onFocus: (event: React.FocusEvent) => restOn((event.target as Element).closest("[data-nav]")),
    onPointerLeave: () => restOn(current()),
    onBlur: () => restOn(current()),
  };
  return { navRef, dropRef, handlers };
}

export function SiteHeader({ current, onSignIn }: { current: "inicio" | "nosotros" | "app" } & Actions) {
  const { navRef, dropRef, handlers } = useNavDrop();
  return <header className="site-header">
    <MotionLink href="/" className="site-brand" aria-label="VIGÍA, inicio"><BrandMark size={61}/></MotionLink>
    <nav className="site-nav" aria-label="Sitio" ref={navRef} {...handlers}>
      <MotionLink href="/" data-nav aria-current={current === "inicio" ? "page" : undefined}>Home</MotionLink>
      <MotionLink href="/nosotros" data-nav aria-current={current === "nosotros" ? "page" : undefined}>Nosotros</MotionLink>
      <MotionLink href="/#soluciones" data-nav>Soluciones</MotionLink>
      <MoreMenu current={current}/>
      <span className="nav-drop" ref={dropRef} aria-hidden="true"/>
    </nav>
    <div className="site-actions">
      <SignInAction onSignIn={onSignIn} className="site-signin"/>
    </div>
  </header>;
}

/**
 * Brings a page in: elements marked data-enter rise one after another, and blocks marked
 * data-reveal (their children, when it is "stagger") rise as they scroll into view.
 */
export function SiteMotion({ children, className = "site" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || reducedMotion()) return;
    const animations = [enter(root.querySelectorAll("[data-enter]"), { step: 110, distance: 36, duration: 1100 })];
    const glow = root.querySelector(".hero-glow");
    if (glow) animations.push(animate(glow, { opacity: [0, 1], scale: [.7, 1], duration: 1800, delay: 350, ease: "outExpo" }));
    const observers = [...root.querySelectorAll<HTMLElement>("[data-reveal]")].map((block) => {
      const targets = block.dataset.reveal === "stagger" ? [...block.children] : [block];
      utils.set(targets, { opacity: 0, translateY: 56 });
      return animate(targets, {
        opacity: [0, 1], translateY: [56, 0], filter: ["blur(10px)", "blur(0px)"],
        duration: 1100, delay: stagger(130), ease: "outExpo",
        autoplay: onScroll({ target: block, enter: { target: "start", container: "end-=8%" } }),
      });
    });
    return () => { animations.forEach((animation) => animation?.revert()); observers.forEach((animation) => animation.revert()); };
  }, []);
  return <div className={className} ref={ref}>{children}</div>;
}

export function SiteClosing({ onDemo }: Actions) {
  return <section className="site-closing" aria-labelledby="closing-title" data-reveal="stagger">
    <h2 id="closing-title" className="gray-title">El siguiente movimiento es tuyo.</h2>
    <p>Descubre el potencial de VIGÍA y da el primer paso hacia una nueva forma de abordar la inteligencia vehicular.</p>
    {onDemo ? <button type="button" className="pill-figma" onClick={onDemo}>Explorar demo</button> : <MotionLink className="pill-figma" href="/?demo=1">Explorar demo</MotionLink>}
  </section>;
}

export function SiteFooter() {
  return <footer className="site-footer">
    <div className="footer-top">
      <span className="footer-brand"><BrandMark size={22}/>VIGÍA · Piloto en Barranquilla, Colombia</span>
      <nav aria-label="Pie de página"><MotionLink href="/">Inicio</MotionLink><MotionLink href="/nosotros">Nosotros</MotionLink><MotionLink href="/app">App Android</MotionLink></nav>
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

/**
 * «De la cámara al análisis»: on wide screens the section stays in view while the page
 * scrolls through it and each quarter of that scroll is one stage. The bar's drop flows
 * from stage to stage. Clicking a stage scrolls to its quarter; elsewhere it just selects.
 */
function Process() {
  const [step, setStep] = useState(0);
  const [pinned, setPinned] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLSpanElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const placed = useRef(false);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1101px)");
    const update = () => setPinned(wide.matches && !reducedMotion());
    update();
    wide.addEventListener("change", update);
    return () => wide.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!pinned || !trackRef.current) return;
    const observer = onScroll({
      target: trackRef.current,
      enter: { target: "start", container: "start" },
      leave: { target: "end", container: "end" },
      onUpdate: (self) => setStep(Math.min(STEPS.length - 1, Math.floor(self.progress * STEPS.length))),
    });
    return () => { observer.revert(); };
  }, [pinned]);

  useLayoutEffect(() => {
    const button = stepsRef.current?.querySelectorAll<HTMLElement>("[role=tab]")[step];
    if (!button) return;
    liquidMove(dropRef.current, "y", button.offsetTop, button.offsetHeight, !placed.current);
    placed.current = true;
    if (screenRef.current && !reducedMotion()) animate(screenRef.current, { opacity: [0, 1], scale: [.96, 1], filter: ["blur(8px)", "blur(0px)"], duration: 700, ease: "outExpo" });
  }, [step]);

  function select(index: number) {
    const track = trackRef.current;
    if (!pinned || !track) {
      setStep(index);
      return;
    }
    const top = track.getBoundingClientRect().top + window.scrollY;
    const range = track.offsetHeight - window.innerHeight;
    scrollToY(top + range * (index + .5) / STEPS.length);
  }

  function onStepKey(event: React.KeyboardEvent, index: number) {
    const next = event.key === "ArrowDown" || event.key === "ArrowRight" ? index + 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? index - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = (next + STEPS.length) % STEPS.length;
    select(target);
    setStep(target);
    document.getElementById(`step-tab-${STEPS[target].id}`)?.focus();
  }

  return <section className={`process ${pinned ? "pinned" : ""}`} id="proceso" aria-labelledby="process-title">
    <div className="process-track" ref={trackRef}>
      <div className="process-pin">
        <h2 id="process-title" className="gray-title">De la cámara al análisis.</h2>
        <p className="process-lede">De cada imagen, una pista. De cada pista, una posible ruta.</p>
        <div className="process-body">
          <div className="process-steps" role="tablist" aria-orientation="vertical" aria-label="Etapas de VIGÍA" ref={stepsRef}>
            <span className="process-drop" ref={dropRef} aria-hidden="true"/>
            {STEPS.map((item, index) => <button key={item.id} id={`step-tab-${item.id}`} role="tab" type="button" aria-selected={step === index} aria-controls={`step-panel-${item.id}`} tabIndex={step === index ? 0 : -1} onClick={() => select(index)} onKeyDown={(event) => onStepKey(event, index)}>
              <b>{item.title}</b><span>{item.text}</span>
            </button>)}
          </div>
          <div className="process-stage" id={`step-panel-${STEPS[step].id}`} role="tabpanel" aria-labelledby={`step-tab-${STEPS[step].id}`}>
            <div className="process-screen" key={STEPS[step].id} ref={screenRef}>{STEPS[step].scene}</div>
          </div>
        </div>
      </div>
    </div>
  </section>;
}

export function Landing({ onSignIn, onDemo }: Required<Actions>) {
  return <SiteMotion>
    <SiteHeader current="inicio" onSignIn={onSignIn}/>
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title" data-enter>De observaciones aisladas a <span>recorridos posibles.</span></h1>
        <p data-enter>VIGÍA convierte las detecciones de tus cámaras en trayectorias estimadas de vehículos, en segundos.</p>
        <DemoAction onDemo={onDemo}/>
        <div className="hero-glow" aria-hidden="true"/>
        <figure className="hero-frame" data-enter>
          <Image src="/landing/consola-figma.webp" alt="Consola de VIGÍA en modo demostración: trayectoria estimada de un automóvil blanco con dos rutas candidatas, su recorrido por cámaras y el mapa de Barranquilla" width={1600} height={773} priority sizes="(max-width: 900px) 100vw, 1200px"/>
        </figure>
      </section>

      <section className="solutions" id="soluciones" aria-labelledby="solutions-title">
        <h2 id="solutions-title" className="gray-title" data-reveal>Inteligencia que conecta cada observación.</h2>
        <MotionLink className="explore-link" href="/#proceso">Explorar soluciones</MotionLink>
        <div className="solution-grid" data-reveal="stagger">
          <article className="solution detection"><div className="solution-visual"><DetectionVisual/></div><h3>Detección inteligente</h3><p>Identificamos vehículos y analizamos características como su tipo y color mediante modelos de visión por computador.</p></article>
          <article className="solution network"><div className="solution-visual framed"><NetworkVisual/></div><h3>Procesamiento distribuido</h3><p>Procesamos imágenes cerca de las cámaras y conectamos los eventos relevantes en una plataforma central.</p></article>
          <article className="solution routes"><div className="solution-visual framed"><RouteVisual/></div><h3>Análisis de recorridos</h3><p>Relacionamos observaciones para visualizar y explorar posibles trayectorias vehiculares.</p></article>
        </div>
      </section>

      <Process/>

      <SiteClosing onDemo={onDemo}/>
    </main>
    <SiteFooter/>
  </SiteMotion>;
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
