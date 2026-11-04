"use client";

import { animate, spring, stagger, type JSAnimation } from "animejs";
import Lenis from "lenis";

/** Visitors who ask for less motion get the final state at once (the e2e tests run this way). */
export function reducedMotion() {
  return typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A soft spring with a little overshoot: the drop arrives, bulges and settles. */
export const dropSpring = spring({ mass: 1, stiffness: 170, damping: 15 });
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

/**
 * The same drop, for indicators that follow the page's scroll: it glides and stretches a
 * little while moving but never overshoots, so scrolling does not feel like it bounces.
 */
export function glide(element: HTMLElement | null, axis: "x" | "y", to: number, size?: number, instant = false) {
  if (!element) return;
  const translate = axis === "x" ? "translateX" : "translateY";
  const stretch = axis === "x" ? "scaleX" : "scaleY";
  const sizeProperty = axis === "x" ? "width" : "height";
  if (instant || reducedMotion()) {
    element.style.transform = `${translate}(${to}px)`;
    if (size !== undefined) element.style[sizeProperty] = `${size}px`;
    return;
  }
  animate(element, { [stretch]: [{ to: 1.18, duration: 260, ease: "outSine" }, { to: 1, duration: 420, ease: "inOutSine" }] });
  animate(element, { [translate]: to, ...(size !== undefined ? { [sizeProperty]: size } : {}), duration: 680, ease: "inOutCubic" });
}

// Ease in and out, no overshoot: the page accelerates gently and settles without a bounce.
const easeInOutCubic = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
let lenis: Lenis | null = null;

/**
 * Smooth scrolling for the public pages: the wheel glides with a soft inertia instead of
 * jumping by steps, and in-page links travel there. Off for visitors who ask for less
 * motion and on touch screens (their own scrolling already has momentum).
 */
export function startSmoothScroll() {
  if (reducedMotion() || lenis) return () => {};
  const instance = new Lenis({ lerp: .085, wheelMultiplier: .9, smoothWheel: true, autoRaf: true, allowNestedScroll: true, stopInertiaOnNavigate: true });
  lenis = instance;
  // Links to a section of this same page travel there instead of jumping (the section's
  // scroll-margin-top is kept, so a sticky index never covers its heading).
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.("a[href]");
    if (!(link instanceof HTMLAnchorElement)) return;
    const url = new URL(link.href);
    if (!url.hash || url.origin !== location.origin || url.pathname !== location.pathname) return;
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!target) return;
    event.preventDefault();
    scrollToElement(target);
    history.replaceState(history.state, "", url.hash);
  };
  document.addEventListener("click", onClick);
  return () => {
    document.removeEventListener("click", onClick);
    instance.destroy();
    if (lenis === instance) lenis = null;
  };
}

/** Scrolls to an element, keeping its scroll-margin-top (24 px when it has none). */
export function scrollToElement(target: Element) {
  const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 24;
  // offsetTop ignores transforms, so a section still waiting for its reveal (moved down
  // until it appears) is measured where it will end up.
  let top = 0;
  for (let node = target as HTMLElement | null; node; node = node.offsetParent as HTMLElement | null) top += node.offsetTop;
  scrollToY(top - margin);
}

/** Smoothly scrolls the page to a vertical position. */
export function scrollToY(y: number) {
  if (reducedMotion()) {
    window.scrollTo({ top: y, behavior: "instant" });
    return;
  }
  if (lenis) {
    lenis.scrollTo(y, { duration: 1.1, easing: easeInOutCubic });
    return;
  }
  window.scrollTo({ top: y, behavior: "smooth" });
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
