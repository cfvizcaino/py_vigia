"use client";

import { animate, createSpring, stagger, type JSAnimation } from "animejs";

/** Visitors who ask for less motion get the final state at once (the e2e tests run this way). */
export function reducedMotion() {
  return typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A soft spring with a little overshoot: the drop arrives, bulges and settles. */
export const dropSpring = createSpring({ mass: 1, stiffness: 170, damping: 15 });
const EASE_OUT = "outExpo";

/** Elements rise into place one after another, coming out of a slight blur. */
export function enter(targets: Element | Element[] | NodeListOf<Element> | string | null, options: { delay?: number; step?: number; distance?: number; duration?: number } = {}) {
  if (!targets || reducedMotion()) return null;
  const { delay = 0, step = 70, distance = 28, duration = 900 } = options;
  return animate(targets, {
    opacity: [0, 1],
    translateY: [distance, 0],
    filter: ["blur(8px)", "blur(0px)"],
    duration,
    delay: stagger(step, { start: delay }),
    ease: EASE_OUT,
  });
}

/** The page leaves upwards and fades; `done` runs when it is gone (or at once without motion). */
export function leave(targets: Element | Element[] | NodeListOf<Element> | string, done: () => void) {
  if (reducedMotion()) {
    done();
    return;
  }
  animate(targets, {
    opacity: [1, 0],
    translateY: [0, -18],
    filter: ["blur(0px)", "blur(6px)"],
    duration: 340,
    ease: "inQuad",
    onComplete: done,
  });
}

/**
 * Moves an indicator like a drop of water: it travels on a spring and stretches along
 * the way (longer and thinner while moving, a small bulge when it lands).
 */
export function liquidMove(element: HTMLElement | null, axis: "x" | "y", to: number, size?: number, instant = false): JSAnimation | null {
  if (!element) return null;
  const translate = axis === "x" ? "translateX" : "translateY";
  const stretch = axis === "x" ? "scaleX" : "scaleY";
  const squeeze = axis === "x" ? "scaleY" : "scaleX";
  const sizeProperty = axis === "x" ? "width" : "height";
  if (instant || reducedMotion()) {
    element.style.transform = `${translate}(${to}px)`;
    if (size !== undefined) element.style[sizeProperty] = `${size}px`;
    return null;
  }
  animate(element, {
    [stretch]: [{ to: 1.55, duration: 160, ease: "outQuad" }, { to: 1, duration: 520, ease: "outElastic(1, .55)" }],
    [squeeze]: [{ to: .72, duration: 160, ease: "outQuad" }, { to: 1, duration: 520, ease: "outElastic(1, .55)" }],
  });
  return animate(element, { [translate]: to, ...(size !== undefined ? { [sizeProperty]: size } : {}), ease: dropSpring });
}

/** Smoothly scrolls the page to a vertical position. */
export function scrollToY(y: number) {
  const root = document.scrollingElement ?? document.documentElement;
  if (reducedMotion()) {
    root.scrollTop = y;
    return;
  }
  animate(root, { scrollTop: y, duration: 1100, ease: "inOutQuart" });
}

/** Counts a number up to its new value inside an element. */
export function countTo(element: HTMLElement | null, value: number) {
  if (!element) return;
  const from = Number(element.dataset.value ?? 0);
  element.dataset.value = String(value);
  if (reducedMotion() || from === value) {
    element.textContent = String(value);
    return;
  }
  const counter = { n: from };
  animate(counter, { n: value, duration: 700, ease: EASE_OUT, onUpdate: () => { element.textContent = String(Math.round(counter.n)); } });
}
