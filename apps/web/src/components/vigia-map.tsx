"use client";

import { useEffect, useRef, useState } from "react";
import { AttributionControl, GeoJSONSource, Map as MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";

type Camera = { id: string; name: string; status: string; lng: number; lat: number };

export function VigiaMap({ cameras, selectedId, onSelect, routePoints }: { cameras: Camera[]; selectedId: string; onSelect: (id: string) => void; routePoints: Camera[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const markers = markersRef.current;
    let hasLoaded = false;
    const map = new MapLibreMap({
      container: containerRef.current,
      // Inline raster style: avoids depending on a remote style JSON and keeps
      // the prototype free of provider tokens.
      style: {
        version: 8,
        sources: {
          "openstreetmap": {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "openstreetmap", type: "raster", source: "openstreetmap" }],
      },
      center: [-74.8100, 11.0060],
      zoom: 13.7,
      attributionControl: false,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    cameras.forEach((camera) => {
      const element = document.createElement("button");
      element.className = `map-camera ${camera.status !== "En línea" ? "offline" : ""}`;
      element.setAttribute("aria-label", camera.name);
      element.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14.5 5 13 3H8L6.5 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="4"/></svg>';
      element.onclick = () => onSelect(camera.id);
      const marker = new Marker({ element }).setLngLat([camera.lng, camera.lat]).setPopup(new Popup({ offset: 24 }).setHTML(`<b>${camera.name}</b><br><span>${camera.id} · ${camera.status}</span>`)).addTo(map);
      markers.set(camera.id, marker);
    });
    map.on("load", () => {
      hasLoaded = true;
      setMapStatus("ready");
      map.addSource("vigia-route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } } });
      map.addLayer({ id: "vigia-route-shadow", type: "line", source: "vigia-route", paint: { "line-color": "#fff", "line-width": 8, "line-opacity": 0.9 } });
      map.addLayer({ id: "vigia-route", type: "line", source: "vigia-route", paint: { "line-color": "#047857", "line-width": 4, "line-dasharray": [1.2, 1.1] } });
    });
    map.on("error", (event) => {
      console.error("No fue posible cargar el mapa base", event.error);
      if (!hasLoaded) setMapStatus("error");
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; markers.clear(); };
  }, [cameras, onSelect]);

  useEffect(() => {
    markersRef.current.forEach((marker, id) => marker.getElement().classList.toggle("selected", id === selectedId));
  }, [selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => (map.getSource("vigia-route") as GeoJSONSource | undefined)?.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routePoints.map((point) => [point.lng, point.lat]) } });
    if (map.loaded()) update(); else map.once("load", update);
  }, [routePoints]);

  return <div className="map-wrapper">
    <div ref={containerRef} className="map-canvas" aria-label="Mapa de dispositivos VIGIA en Barranquilla"/>
    {mapStatus === "loading" && <div className="map-status"><span className="map-spinner"/>Cargando mapa de Barranquilla…</div>}
    {mapStatus === "error" && <div className="map-status error"><b>No se pudo cargar el mapa base.</b><span>Verifica la conexión a internet y recarga la página.</span></div>}
  </div>;
}
