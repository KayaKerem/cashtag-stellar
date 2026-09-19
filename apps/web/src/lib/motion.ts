"use client";

import { useEffect, useRef, useState } from "react";

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Eleman görünür alandayken true. `once` ise ilk görünüşten sonra true kalır. */
export function useInView<T extends Element>(options?: { once?: boolean; rootMargin?: string }) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  const once = options?.once ?? false;
  const rootMargin = options?.rootMargin ?? "0px 0px -10% 0px";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once, rootMargin]);

  return [ref, inView] as const;
}

/**
 * Sıralı adım sayacı: `active` iken her `interval` ms'de bir 0..steps-1 arasında ilerler, sonra başa döner.
 * `durations` verilirse adım başına farklı bekleme süresi kullanılır.
 */
export function useLoop(steps: number, interval: number | number[], active: boolean) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) return;
    const wait = Array.isArray(interval) ? interval[step % interval.length] : interval;
    const id = window.setTimeout(() => setStep((s) => (s + 1) % steps), wait);
    return () => window.clearTimeout(id);
  }, [step, steps, interval, active]);
  return step;
}

/** `target`'a `ms` içinde sayarak yaklaşan değer (easeOutCubic). Hedef değişince kaldığı yerden devam eder. */
export function useCountUp(target: number, ms = 900, active = true) {
  const [value, setValue] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    if (!active) {
      setValue(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = origin + (target - origin) * eased;
      setValue(v);
      from.current = v;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, active]);

  return value;
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
