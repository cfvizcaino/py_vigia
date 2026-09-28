"use client";

import { useEffect, useRef, useState } from "react";
import { AttributionControl, type GeoJSONSource, Map as MapLibreMap, Marker, NavigationControl, Popup, setWorkerUrl } from "maplibre-gl";
import { type Device, STATUS_LABELS } from "@/lib/monitoring";
import { Icon } from "./icon";

type Point = { lng: number; lat: number };
type RouteMode = "none" | "loading" | "road-network" | "camera-chord";
type Props = { cameras: Device[]; selectedId: string; onSelect: (id: string) => void; routePoints: Point[]; routeMode: RouteMode; radius: number; center?: Point };

function circle(center: Point, meters: number) {
  return Array.from({ length: 65 }, (_, index) => {
    const angle = index / 64 * Math.PI * 2;
    return [center.lng + Math.cos(angle) * meters / (111_320 * Math.cos(center.lat * Math.PI / 180)), center.lat + Math.sin(angle) * meters / 111_320];
  });
}

function fitPoints(map: MapLibreMap, points: Point[]) {
  if (points.length < 2) return;
  map.fitBounds([[Math.min(...points.map((p) => p.lng)), Math.min(...points.map((p) => p.lat))], [Math.max(...points.map((p) => p.lng)), Math.max(...points.map((p) => p.lat))]], { padding: 85, maxZoom: 15, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500 });
}

export function VigiaMap({ cameras, selectedId, onSelect, routePoints, routeMode, radius, center }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">("loading");
  const [routeVisible, setRouteVisible] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    let map: MapLibreMap;
    try {
      setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      map = new MapLibreMap({
        container: containerRef.current,
        style: { version: 8, sources: { openstreetmap: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' } }, layers: [{ id: "openstreetmap", type: "raster", source: "openstreetmap", paint: { "raster-saturation": -0.65 } }] },
        center: [-74.810, 11.009], zoom: 13.4, attributionControl: false,
      });
    } catch {
      // Defer React state updates out of effect setup, including WebGL failures.
      const timer = window.setTimeout(() => setMapStatus("error"), 0);
      return () => window.clearTimeout(timer);
    }
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    const timeout = window.setTimeout(() => setMapStatus("error"), 12_000);
    map.on("load", () => {
      map.addSource("vigia-radius", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "vigia-radius-fill", type: "fill", source: "vigia-radius", paint: { "fill-color": "#15b6a4", "fill-opacity": 0.08 } });
      map.addLayer({ id: "vigia-radius-line", type: "line", source: "vigia-radius", paint: { "line-color": "#118d80", "line-width": 1.5, "line-dasharray": [4, 3] } });
      map.addSource("vigia-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "vigia-route-shadow", type: "line", source: "vigia-route", paint: { "line-color": "#fff", "line-width": 9, "line-opacity": 0.9 } });
      map.addLayer({ id: "vigia-route", type: "line", source: "vigia-route", paint: { "line-color": "#de6025", "line-width": 4, "line-dasharray": [2, 1] } });
      window.clearTimeout(timeout);
      setMapStatus("ready");
    });
    map.on("error", () => { setMapStatus("error"); });
    map.on("idle", () => {
      if (map.areTilesLoaded()) { window.clearTimeout(timeout); setMapStatus("ready"); }
      setRouteVisible(Boolean(map.getLayer("vigia-route") && map.queryRenderedFeatures({ layers: ["vigia-route"] }).length));
    });
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(containerRef.current);
    const markers = markersRef.current;
    return () => { window.clearTimeout(timeout); resize.disconnect(); markers.forEach((marker) => marker.remove()); markers.clear(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    markers.forEach((marker) => marker.remove());
    markers.clear();
    cameras.forEach((camera) => {
      const element = document.createElement("button");
      element.className = `map-camera ${camera.kind} ${camera.status === "offline" ? "offline" : ""} ${camera.external_id === selectedId ? "selected" : ""}`;
      element.setAttribute("aria-label", `${camera.external_id} · ${camera.name}`);
      element.setAttribute("aria-pressed", String(camera.external_id === selectedId));
      element.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3"/></svg>';
      const label = document.createElement("span");
      label.textContent = camera.external_id;
      element.append(label);
      element.onclick = () => onSelect(camera.external_id);
      const popup = document.createElement("div");
      const title = document.createElement("b");
      title.textContent = camera.name;
      const detail = document.createElement("p");
      detail.textContent = `${camera.external_id} · ${STATUS_LABELS[camera.status] ?? camera.status}`;
      popup.append(title, detail);
      markers.set(camera.external_id, new Marker({ element }).setLngLat([camera.lng, camera.lat]).setPopup(new Popup({ offset: 28 }).setDOMContent(popup)).addTo(map));
    });
    return () => { markers.forEach((marker) => marker.remove()); markers.clear(); };
  }, [cameras, onSelect, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      (map.getSource("vigia-route") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: routePoints.length < 2 ? [] : [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routePoints.map((point) => [point.lng, point.lat]) } }] });
      if (map.getLayer("vigia-route")) map.setPaintProperty("vigia-route", "line-dasharray", routeMode === "road-network" ? undefined : [2, 1]);
      (map.getSource("vigia-radius") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: center ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circle(center, radius)] } }] : [] });
    };
    if (map.getSource("vigia-route")) update();
    else map.once("load", update);
    return () => { map.off("load", update); };
  }, [routePoints, routeMode, radius, center]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || routePoints.length < 2) return;
    const fit = () => fitPoints(map, routePoints);
    if (map.getSource("vigia-route")) fit();
    else map.once("load", fit);
    return () => { map.off("load", fit); };
  }, [routePoints]);

  function recenter() {
    const points = routePoints.length ? routePoints : cameras;
    if (points.length > 1 && mapRef.current) fitPoints(mapRef.current, points);
    else mapRef.current?.flyTo({ center: center ? [center.lng, center.lat] : [-74.810, 11.009], zoom: 13.4 });
  }

  return <div className="map-wrapper" data-route-visible={routeVisible}>
    <div ref={containerRef} className="map-canvas" aria-label="Mapa de dispositivos VIGIA en Barranquilla"/>
    <div className="map-overlay-label"><span className="small-orbit"/><span>RED COLABORATIVA<b>{cameras.length} nodos en el mapa</b></span></div>
    <button className="map-recenter" onClick={recenter} aria-label="Centrar mapa en la red" title="Centrar mapa en la red"><Icon name="pin" size={18}/></button>
    {mapStatus === "loading" && <div className="map-status"><span className="spinner"/>Cargando cartografía de Barranquilla…</div>}
    {mapStatus === "error" && <div className="map-status error" role="status"><Icon name="layers" size={24}/><b>Cartografía no disponible</b><span>Se necesita conexión a internet y soporte WebGL. Puedes seleccionar cámaras desde la lista y consultar sus detecciones.</span></div>}
    <span className="map-coordinate">BARRANQUILLA / ATLÁNTICO <span>CO</span></span>
  </div>;
}
