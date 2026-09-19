import { ImageResponse } from "next/og";

export const alt = "ClipRail · Provable pay-per-view";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#131313",
          color: "#f2f2f0",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "#dbff00",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#131313",
              fontSize: 40,
              fontWeight: 700,
            }}
          >
            #
          </div>
          <div style={{ fontSize: 40, fontWeight: 600 }}>ClipRail</div>
          <div style={{ marginLeft: "auto", fontSize: 24, color: "#9a9ca1", border: "2px solid #333", borderRadius: 999, padding: "8px 20px" }}>
            Stellar testnet
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 600, letterSpacing: -3, lineHeight: 1.05 }}>
            Every view is proven.
          </div>
          <div style={{ fontSize: 76, fontWeight: 600, letterSpacing: -3, lineHeight: 1.05, color: "#dbff00" }}>
            Every payout follows the rules.
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 28, color: "#c7c9cc" }}>
          <span>Numbers proven</span>
          <span style={{ color: "#555" }}>·</span>
          <span>One human, once</span>
          <span style={{ color: "#555" }}>·</span>
          <span>Rules never change</span>
        </div>
      </div>
    ),
    size,
  );
}
