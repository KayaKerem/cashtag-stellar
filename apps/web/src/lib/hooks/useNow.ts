"use client";

import { useEffect, useState } from "react";

/** Unix saniye; her `ms`'de bir güncellenir (geri sayımlar ve faz hesabı için). */
export function useNow(ms = 1000): bigint {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const id = window.setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** 3725 → "1 sa 2 dk", 125 → "2 dk 5 sn", 9 → "9 sn" */
export function formatDuration(seconds: bigint | number): string {
  let s = Math.max(0, Number(seconds));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d) return `${d} g ${h} sa`;
  if (h) return `${h} sa ${m} dk`;
  if (m) return `${m} dk ${s} sn`;
  return `${s} sn`;
}
