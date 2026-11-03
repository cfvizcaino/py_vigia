"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icon";

/** Copies the checksum; falls back to selecting it when the clipboard is not allowed. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2200);
    return () => window.clearTimeout(timer);
  }, [state]);
  return <button type="button" className="copy-button" onClick={() => navigator.clipboard.writeText(value).then(() => setState("copied"), () => setState("failed"))} aria-label={label}>
    <Icon name={state === "copied" ? "check" : "copy"} size={16}/>
    <span aria-live="polite">{state === "copied" ? "Copiado" : state === "failed" ? "Selecciónalo y copia" : "Copiar"}</span>
  </button>;
}

export type Section = { id: string; label: string };

/** The manual's index: follows the section being read and stays at hand while scrolling. */
export function AppIndex({ sections }: { sections: Section[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  // On phones the index is a row of chips: keep the current one in view.
  useEffect(() => {
    if (!window.matchMedia("(max-width: 860px)").matches) return;
    document.querySelector(`.app-index a[href="#${active}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [active]);
  useEffect(() => {
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
      const current = sections.find((section) => (visible.get(section.id) ?? 0) > 0);
      if (current) setActive(current.id);
    }, { rootMargin: "-20% 0px -55% 0px", threshold: [0, .01] });
    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sections]);
  return <nav className="app-index" aria-label="Contenido de la guía">
    <ol>{sections.map((section) => <li key={section.id}><a href={`#${section.id}`} aria-current={active === section.id ? "location" : undefined}>{section.label}</a></li>)}</ol>
  </nav>;
}
