"use client";

import { useMemo, useState } from "react";
import { VigiaMap } from "@/components/vigia-map";

type IconName = "grid" | "camera" | "search" | "route" | "shield" | "clock" | "chevron";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    camera: <><path d="M14.5 5 13 3H8L6.5 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="4"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    route: <><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h2a4 4 0 0 0 4-4V9a4 4 0 0 1 4-4"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

const cameras = [
  { id: "CAM-01", name: "Carrera 53", detail: "Calle 80 · sentido norte", status: "En línea", lng: -74.8172, lat: 11.0131 },
  { id: "CAM-02", name: "Calle 84", detail: "Carrera 51B · sentido este", status: "En línea", lng: -74.8137, lat: 11.0094 },
  { id: "CAM-03", name: "Parque Venezuela", detail: "Carrera 44 · sentido sur", status: "En línea", lng: -74.8069, lat: 11.005 },
  { id: "CAM-04", name: "Calle 72", detail: "Carrera 43 · sin conexión", status: "Sin conexión", lng: -74.802, lat: 10.9988 },
];

const detections = [
  { camera: "CAM-01", time: "14:32:08", label: "Automóvil blanco", confidence: 94 },
  { camera: "CAM-02", time: "14:33:41", label: "Automóvil blanco", confidence: 89 },
  { camera: "CAM-03", time: "14:35:16", label: "Automóvil blanco", confidence: 82 },
];

export default function Home() {
  const [activeNav, setActiveNav] = useState("Resumen");
  const [selectedCamera, setSelectedCamera] = useState("CAM-02");
  const [searched, setSearched] = useState(true);
  const [vehicleType, setVehicleType] = useState("Automóvil");
  const [color, setColor] = useState("Blanco");
  const online = cameras.filter((camera) => camera.status === "En línea").length;
  const routePoints = useMemo(() => searched ? cameras.slice(0, 3) : [], [searched]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="shield" size={22}/></span><div><strong>VIGIA</strong><small>Centro de monitoreo</small></div></div>
        <nav className="main-nav" aria-label="Navegación principal">
          {[{ label: "Resumen", icon: "grid" }, { label: "Cámaras", icon: "camera" }, { label: "Consultas", icon: "search" }, { label: "Trayectorias", icon: "route" }].map((item) => (
            <button key={item.label} className={activeNav === item.label ? "active" : ""} onClick={() => setActiveNav(item.label)}><Icon name={item.icon as IconName}/>{item.label}</button>
          ))}
        </nav>
        <div className="privacy-note"><Icon name="shield"/><div><b>Procesamiento privado</b><span>El video permanece en cada dispositivo.</span></div></div>
        <div className="profile"><span className="avatar">CV</span><div><b>Cristian Vizcaíno</b><small>Administrador</small></div><Icon name="chevron" size={15}/></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div><p className="eyebrow">Panel operativo</p><h1>{activeNav}</h1></div><div className="system-status"><span className="pulse"/>Sistema operativo <small>Actualizado ahora</small></div></header>

        <div className="metrics">
          <article><span className="metric-icon green"><Icon name="camera"/></span><div><small>Dispositivos activos</small><strong>{online}<em>/ {cameras.length}</em></strong></div><span className="trend">75%</span></article>
          <article><span className="metric-icon blue"><Icon name="search"/></span><div><small>Detecciones hoy</small><strong>247</strong></div><span className="trend">+18%</span></article>
          <article><span className="metric-icon violet"><Icon name="route"/></span><div><small>Consultas realizadas</small><strong>12</strong></div><span className="trend neutral">Hoy</span></article>
          <article><span className="metric-icon amber"><Icon name="clock"/></span><div><small>Tiempo de respuesta</small><strong>1.8<em> s</em></strong></div><span className="trend">Normal</span></article>
        </div>

        <section className="content-grid">
          <article className="map-card">
            <div className="card-heading"><div><span className="section-kicker">Red colaborativa</span><h2>Mapa de dispositivos</h2></div><div className="legend"><span><i className="online"/>En línea</span><span><i className="offline"/>Sin conexión</span></div></div>
            <VigiaMap cameras={cameras} selectedId={selectedCamera} onSelect={setSelectedCamera} routePoints={routePoints}/>
            <div className="map-footer"><span><b>4</b> dispositivos en el área</span><span><b>{searched ? 3 : 0}</b> detecciones relacionadas</span><button onClick={() => setSearched(false)}>Limpiar ruta</button></div>
          </article>

          <aside className="query-card">
            <div className="card-heading"><div><span className="section-kicker">Nueva búsqueda</span><h2>Consultar vehículo</h2></div><span className="query-icon"><Icon name="search"/></span></div>
            <label>Tipo de vehículo<select value={vehicleType} onChange={(event) => setVehicleType(event.target.value)}><option>Automóvil</option><option>Motocicleta</option></select></label>
            <label>Color<select value={color} onChange={(event) => setColor(event.target.value)}><option>Blanco</option><option>Negro</option><option>Gris / plata</option><option>Rojo</option><option>Azul</option><option>Desconocido</option></select></label>
            <div className="field-row"><label>Fecha<input type="date" defaultValue="2026-08-13"/></label><label>Hora aprox.<input type="time" defaultValue="14:30"/></label></div>
            <label>Radio de búsqueda<div className="range-label"><input type="range" min="100" max="2000" defaultValue="500"/><output>500 m</output></div></label>
            <button className="primary-action" onClick={() => setSearched(true)}><Icon name="search"/>Buscar en dispositivos cercanos</button>
            <p className="form-help"><Icon name="shield" size={15}/>La consulta solo solicitará metadatos a cámaras dentro del área.</p>
          </aside>
        </section>

        <section className="lower-grid">
          <article className="detections-card">
            <div className="card-heading"><div><span className="section-kicker">Consulta #VIG-0012</span><h2>Trayectoria estimada</h2></div>{searched && <span className="confidence">87% de confianza</span>}</div>
            {searched ? <div className="timeline">{detections.map((item, index) => <div className="detection" key={item.camera}><span className="timeline-dot">{index + 1}</span><div><b>{item.label}</b><small>{item.camera} · {item.time}</small></div><span className="match">{item.confidence}%</span></div>)}</div> : <div className="empty-state">Realiza una consulta para visualizar una trayectoria.</div>}
          </article>
          <article className="devices-card">
            <div className="card-heading"><div><span className="section-kicker">Estado en vivo</span><h2>Dispositivos</h2></div><button>Ver todos</button></div>
            <div className="device-list">{cameras.map((camera) => <button key={camera.id} className={selectedCamera === camera.id ? "selected" : ""} onClick={() => setSelectedCamera(camera.id)}><span className={`camera-dot ${camera.status === "En línea" ? "" : "off"}`}><Icon name="camera" size={16}/></span><div><b>{camera.name}</b><small>{camera.id} · {camera.detail}</small></div><span className={camera.status === "En línea" ? "status-online" : "status-offline"}>{camera.status}</span></button>)}</div>
          </article>
        </section>
      </section>
    </main>
  );
}
