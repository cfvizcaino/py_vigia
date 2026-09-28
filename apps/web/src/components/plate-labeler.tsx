"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

type PlateBox = { x: number; y: number; width: number; height: number };
type Frame = { name: string; annotated: boolean; boxCount: number };
type Draft = { startX: number; startY: number; currentX: number; currentY: number };

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function draftToBox(draft: Draft): PlateBox {
  const x = Math.min(draft.startX, draft.currentX);
  const y = Math.min(draft.startY, draft.currentY);
  return {
    x,
    y,
    width: Math.abs(draft.currentX - draft.startX),
    height: Math.abs(draft.currentY - draft.startY),
  };
}

export function PlateLabeler() {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [boxes, setBoxes] = useState<PlateBox[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const drawingRef = useRef<HTMLDivElement>(null);
  const currentFrame = frames[currentIndex];
  const currentFrameName = currentFrame?.name;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/labeling/frames", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se encontraron los fotogramas.");
        return response.json() as Promise<{ frames: Frame[] }>;
      })
      .then((data) => setFrames(data.frames))
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setMessage(error.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!currentFrameName) return;
    const controller = new AbortController();
    fetch(`/api/labeling/annotations/${encodeURIComponent(currentFrameName)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo cargar la anotación.");
        return response.json() as Promise<{ boxes: PlateBox[] }>;
      })
      .then((data) => {
        setBoxes(data.boxes);
        setDirty(false);
        setLoading(false);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setMessage(error.message);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [currentFrameName]);

  const completed = useMemo(() => frames.filter((frame) => frame.annotated).length, [frames]);
  const progress = frames.length ? Math.round((completed / frames.length) * 100) : 0;

  function pointFromEvent(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = drawingRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  }

  function startDrawing(event: React.PointerEvent<HTMLDivElement>) {
    if (loading || saving || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    setDraft({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y });
  }

  function continueDrawing(event: React.PointerEvent<HTMLDivElement>) {
    if (!draft) return;
    const point = pointFromEvent(event);
    setDraft((value) => value && { ...value, currentX: point.x, currentY: point.y });
  }

  function finishDrawing(event: React.PointerEvent<HTMLDivElement>) {
    if (!draft) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    const finished = draftToBox({ ...draft, currentX: point.x, currentY: point.y });
    setDraft(null);
    if (finished.width < 0.002 || finished.height < 0.002) return;
    setBoxes((current) => [...current, finished]);
    setDirty(true);
    setMessage("");
  }

  async function save(next = false) {
    if (!currentFrame) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/labeling/annotations/${encodeURIComponent(currentFrame.name)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boxes }),
      });
      if (!response.ok) throw new Error("No se pudo guardar. Intenta nuevamente.");
      setFrames((current) => current.map((frame, index) => index === currentIndex ? { ...frame, annotated: true, boxCount: boxes.length } : frame));
      setDirty(false);
      setMessage(boxes.length ? `${boxes.length} placa${boxes.length === 1 ? "" : "s"} guardada${boxes.length === 1 ? "" : "s"}.` : "Fotograma guardado sin placas.");
      if (next && currentIndex < frames.length - 1) {
        setLoading(true);
        setMessage("");
        setDraft(null);
        setCurrentIndex((index) => index + 1);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  function goTo(index: number) {
    if (index < 0 || index >= frames.length || index === currentIndex) return;
    if (dirty && !window.confirm("Hay cambios sin guardar. ¿Quieres cambiar de imagen y descartarlos?")) return;
    setLoading(true);
    setMessage("");
    setDraft(null);
    setCurrentIndex(index);
  }

  if (!frames.length && !loading) {
    return <section className="labeler-empty"><b>No se pudo abrir el dataset</b><span>{message}</span><code>apps/vision/datasets/plates/source_phone_01/images/raw</code></section>;
  }

  return (
    <section className="labeler-layout">
      <article className="labeler-card">
        <header className="labeler-heading">
          <div><span className="section-kicker">Dataset local · clase plate</span><h2>Etiquetar placas</h2></div>
          <div className="labeler-progress"><span>{completed} de {frames.length} listas</span><div><i style={{ width: `${progress}%` }}/></div><b>{progress}%</b></div>
        </header>

        <div className="labeler-toolbar">
          <button onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === 0 || saving}>← Anterior</button>
          <strong>{currentFrame?.name ?? "Cargando..."}</strong>
          <span>Zoom</span>
          {[1, 1.5, 2, 3].map((level) => <button key={level} className={zoom === level ? "active" : ""} onClick={() => setZoom(level)}>{level}×</button>)}
          <button onClick={() => goTo(currentIndex + 1)} disabled={currentIndex >= frames.length - 1 || saving}>Siguiente →</button>
        </div>

        <div className="annotation-scroll">
          <div className="annotation-stage" style={{ width: `${zoom * 100}%` }}>
            {currentFrame && (
              <Image
                src={`/api/labeling/frames/${encodeURIComponent(currentFrame.name)}`}
                alt={`Fotograma ${currentFrame.name}`}
                fill
                sizes="100vw"
                unoptimized
                draggable={false}
              />
            )}
            <div
              ref={drawingRef}
              className="drawing-layer"
              onPointerDown={startDrawing}
              onPointerMove={continueDrawing}
              onPointerUp={finishDrawing}
              onPointerCancel={() => setDraft(null)}
            >
              {boxes.map((box, index) => <span key={`${box.x}-${box.y}-${index}`} className="plate-box" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}><b>plate {index + 1}</b></span>)}
              {draft && (() => { const box = draftToBox(draft); return <span className="plate-box draft" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}/>; })()}
              {loading && <span className="annotation-loading">Cargando fotograma…</span>}
            </div>
          </div>
        </div>

        <footer className="labeler-actions">
          <div>
            <button onClick={() => { setBoxes((current) => current.slice(0, -1)); setDirty(true); }} disabled={!boxes.length || saving}>Deshacer última</button>
            <button className="danger-text" onClick={() => { setBoxes([]); setDirty(true); }} disabled={!boxes.length || saving}>Borrar cajas</button>
          </div>
          <span className={message.includes("No se pudo") ? "save-message error" : "save-message"}>{message || `${boxes.length} caja${boxes.length === 1 ? "" : "s"} en esta imagen${dirty ? " · sin guardar" : ""}`}</span>
          <div>
            <button onClick={() => save(false)} disabled={saving || loading}>{saving ? "Guardando…" : boxes.length ? "Guardar" : "Guardar sin placas"}</button>
            <button className="primary-save" onClick={() => save(true)} disabled={saving || loading}>{saving ? "Guardando…" : "Guardar y siguiente"}</button>
          </div>
        </footer>
      </article>

      <aside className="labeler-side">
        <div className="labeler-help"><span className="section-kicker">Cómo hacerlo</span><h3>Dibuja una caja ajustada</h3><p>Arrastra desde una esquina de la placa hasta la opuesta. Incluye placas visibles aunque el texto no sea legible.</p><ul><li>No incluyas el parachoques.</li><li>No marques avisos ni calcomanías.</li><li>Usa zoom para las placas pequeñas.</li></ul></div>
        <div className="frame-list">
          <div className="frame-list-heading"><b>Fotogramas</b><span>{completed}/{frames.length}</span></div>
          {frames.map((frame, index) => (
            <button key={frame.name} className={index === currentIndex ? "current" : ""} onClick={() => goTo(index)}>
              <span className={frame.annotated ? "frame-check done" : "frame-check"}>{frame.annotated ? "✓" : index + 1}</span>
              <span>{frame.name}<small>{frame.annotated ? frame.boxCount ? `${frame.boxCount} placa${frame.boxCount === 1 ? "" : "s"}` : "Sin placas" : "Pendiente"}</small></span>
            </button>
          ))}
        </div>
      </aside>
    </section>
  );
}
