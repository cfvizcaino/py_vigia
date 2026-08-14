"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type VisionStatus = {
  status: string;
  cameraId: string;
  cameraModel: string;
  frameNumber: number;
  processingFps: number;
  lastFrameAt: string | null;
  activeDetections: number;
  activePlateDetections: number;
  plateDetectionEnabled: boolean;
  errorCode: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  running: "En vivo",
  connecting: "Conectando",
  reconnecting: "Reconectando",
  "loading-model": "Cargando modelo",
  offline: "Servicio detenido",
  error: "Error",
  stopped: "Detenida",
};

export function CameraPreview({ active, large = false }: { active: boolean; large?: boolean }) {
  const [status, setStatus] = useState<VisionStatus | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const response = await fetch("/api/vision/status", { cache: "no-store" });
        const nextStatus = (await response.json()) as VisionStatus;
        if (cancelled) return;
        setStatus(nextStatus);
        if (nextStatus.status === "running") setPreviewUrl((current) => current ?? `/api/vision/stream?t=${Date.now()}`);
        else setPreviewUrl(null);
      } catch {
        if (!cancelled) setStatus(null);
      }
    }

    refresh();
    const interval = window.setInterval(refresh, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const isLive = status?.status === "running";
  const showPreview = active && previewUrl && isLive;

  return (
    <article className={`camera-preview-card ${active ? "active" : ""} ${large ? "large" : ""}`}>
      <div className="card-heading">
        <div><span className="section-kicker">Cámara física · CAM-01</span><h2>Tapo C110</h2></div>
        <span className={`live-badge ${isLive ? "online" : ""}`}><i/>{STATUS_LABELS[status?.status ?? "offline"] ?? status?.status}</span>
      </div>
      <div className="preview-frame">
        {showPreview ? (
          <Image src={previewUrl} alt="Transmisión procesada de la cámara Tapo C110" fill sizes={large ? "(max-width: 1050px) 100vw, 72vw" : "(max-width: 1050px) 100vw, 32vw"} priority unoptimized onError={() => setPreviewUrl(null)}/>
        ) : (
          <div className="preview-placeholder">
            <span className="preview-camera-icon">◉</span>
            <b>{active ? "Inicia el servicio de visión" : "Selecciona CAM-01"}</b>
            <small>{active ? "La vista aparecerá sin exponer el RTSP al navegador." : "Las demás cámaras son simuladas."}</small>
          </div>
        )}
        {showPreview && <span className="preview-overlay">YOLO · {status.activeDetections} vehículos · {status.activePlateDetections ?? 0} placas</span>}
      </div>
      <div className="preview-meta"><span><b>{status?.processingFps ?? 0} FPS</b> procesados</span><span><b>{status?.activeDetections ?? 0}</b> vehículos · <b>{status?.activePlateDetections ?? 0}</b> placas</span></div>
    </article>
  );
}
