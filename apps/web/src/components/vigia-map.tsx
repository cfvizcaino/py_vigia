"use client";

import { useEffect, useRef } from "react";
import { AttributionControl, GeoJSONSource, Map as MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";

type Camera = { id: string; name: string; status: string; lng: number; lat: number };

export function VigiaMap({ cameras, selectedId, onSelect, routePoints }: { cameras: Camera[]; selectedId: string; onSelect: (id: string) => void; routePoints: Camera[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const markers = markersRef.current;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [-74.81, 11.006],
      zoom: 13.5,
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
      map.addSource("vigia-route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } } });
      map.addLayer({ id: "vigia-route-shadow", type: "line", source: "vigia-route", paint: { "line-color": "#fff", "line-width": 8, "line-opacity": 0.9 } });
      map.addLayer({ id: "vigia-route", type: "line", source: "vigia-route", paint: { "line-color": "#047857", "line-width": 4, "line-dasharray": [1.2, 1.1] } });
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

  return <div ref={containerRef} className="map-canvas" aria-label="Mapa de dispositivos VIGIA"/>;
}
