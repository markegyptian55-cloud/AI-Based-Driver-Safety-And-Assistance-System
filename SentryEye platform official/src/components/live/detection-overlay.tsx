// Pure canvas overlay. Reads latest detections from a ref via rAF so it stays
// smooth regardless of inference latency. No AI logic here.
//
// Resource rules:
//  - exactly one rAF loop per mounted overlay; cancelled on unmount and while
//    the tab is hidden (a hidden tab must not schedule paint work at all);
//  - repaints are skipped when neither the detection set nor the element size
//    changed, so a paused/idle session costs no GPU work.

import { useEffect, useRef, useState } from "react";
import type { Detection } from "@/features/inference/types";

const RISK_COLOR: Record<string, string> = {
  eye_closed: "#f97316", // orange
  yawn: "#ef4444", // red
  eye_open: "#22d3ee", // cyan
};

// High-contrast palette: maximum-luminance hues that stay distinguishable on a
// dark cabin feed and for the most common colour-vision deficiencies. Paired
// with a black halo stroke so a box is readable over any background.
const HC_COLOR: Record<string, string> = {
  eye_closed: "#ffb000", // amber
  yawn: "#ff2d2d", // red
  eye_open: "#00ffff", // cyan
};

// Short label text keeps the pill narrow so side-by-side eyes stay readable.
const SHORT_LABEL: Record<string, string> = {
  eye_closed: "closed",
  eye_open: "open",
  yawn: "yawn",
};

export function DetectionOverlay({
  detectionsRef,
  video,
  mirrored = false,
  highContrast = false,
}: {
  detectionsRef: React.RefObject<Detection[]>;
  video: HTMLVideoElement | null;
  /**
   * Thicker strokes, a black halo and a high-luminance palette. Adds no extra
   * elements to the frame — the same boxes, just readable in daylight.
   */
  highContrast?: boolean;
  /**
   * True when the video element itself is CSS-flipped (selfie preview). Boxes
   * are mirrored in canvas maths instead of flipping the canvas, so labels stay
   * readable and the model's coordinates are never touched.
   */
  mirrored?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!video) return;
    let raf = 0;
    let lastDets: Detection[] | null = null;
    let lastW = -1;
    let lastH = -1;
    let lastVw = -1;
    let lastVh = -1;

    // Render-time interpolation.
    //
    // Inference runs at 15-20 FPS while the screen paints at 60. Drawing the
    // raw model output makes boxes step once per inference; instead every
    // painted frame eases the drawn box toward the newest detection, so the
    // overlay glides at display rate without touching detection data.
    //
    // Identity: the model emits no track id, so a box is keyed by its semantic
    // group plus its left-to-right rank inside that group. That is stable for
    // "left eye / right eye / mouth" and can never lerp a box across faces —
    // an unmatched key simply starts at its own position.
    const LERP = 0.35;
    type Smoothed = { x: number; y: number; w: number; h: number; conf: number };
    let tracks = new Map<string, Smoothed>();
    let animating = false;


    const keyOf = (d: Detection, rank: number) =>
      `${d.semantic.startsWith("eye") ? "eye" : d.semantic}:${rank}`;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = video.clientWidth;
      const h = video.clientHeight;
      if (w === 0 || h === 0) return;
      const dets = detectionsRef.current ?? [];
      // Intrinsic size decides where the picture actually sits inside the
      // element: with object-contain the element is letterboxed, so drawing on
      // the full element box would offset every detection by the bar size.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const sameInput =
        dets === lastDets && w === lastW && h === lastH && vw === lastVw && vh === lastVh;
      // Even with an unchanged detection set the overlay keeps painting while
      // any track is still easing toward its target position.
      if (sameInput && !animating) return;
      lastDets = dets;
      lastW = w;
      lastH = h;
      lastVw = vw;
      lastVh = vh;

      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      // Content rect (object-contain math). The full sensor frame is visible on
      // both phones and desktops, so detections map without crop or fake zoom.
      let cw = w;
      let ch = h;
      let ox = 0;
      let oy = 0;
      if (vw > 0 && vh > 0) {
        const scale = Math.min(w / vw, h / vh);
        cw = vw * scale;
        ch = vh * scale;
        ox = (w - cw) / 2;
        oy = (h - ch) / 2;
      }

      // Label placement rules (deterministic, no leader lines):
      //  - eyes are split into a LEFT and a RIGHT group by comparing each eye
      //    box centre with the midpoint BETWEEN the eyes (not the picture
      //    centre, which breaks when the face is off-centre);
      //  - the left eye's label grows outward to the left of the left eye and
      //    the right eye's label grows outward to the right of the right eye,
      //    so the two pills can never meet in the middle of the face;
      //  - mouth labels sit under the mouth box, out of the eye band.
      const LH = highContrast ? 20 : 16;
      ctx.font = highContrast
        ? "bold 14px 'JetBrains Mono', monospace"
        : "12px 'JetBrains Mono', monospace";

      // Rank each detection inside its semantic group by horizontal position
      // (in model space, so mirroring never reshuffles identities).
      const ranked = dets.map((d, i) => ({ d, i }));
      const groupCounters = new Map<string, number>();
      const sortedForRank = [...ranked].sort((a, b) => a.d.bbox[0] - b.d.bbox[0]);
      const keyByIndex = new Map<number, string>();
      for (const { d, i } of sortedForRank) {
        const group = d.semantic.startsWith("eye") ? "eye" : d.semantic;
        const rank = groupCounters.get(group) ?? 0;
        groupCounters.set(group, rank + 1);
        keyByIndex.set(i, keyOf(d, rank));
      }

      const nextTracks = new Map<string, Smoothed>();
      animating = false;

      const boxes = dets.map((d, i) => {
        const [nx, ny, nw, nh] = d.bbox;
        // Mirrored preview: reflect x within the content rect so the box lands
        // on the same eye the driver sees. Detection data is untouched.
        const px = mirrored ? ox + cw - (nx + nw) * cw : ox + nx * cw;
        const target: Smoothed = {
          x: px,
          y: oy + ny * ch,
          w: nw * cw,
          h: nh * ch,
          conf: d.confidence,
        };
        const key = keyByIndex.get(i) ?? `${d.semantic}:${i}`;
        const prev = tracks.get(key);
        const smoothed: Smoothed = prev
          ? {
              x: prev.x + (target.x - prev.x) * LERP,
              y: prev.y + (target.y - prev.y) * LERP,
              w: prev.w + (target.w - prev.w) * LERP,
              h: prev.h + (target.h - prev.h) * LERP,
              conf: prev.conf + (target.conf - prev.conf) * LERP,
            }
          : target;
        // Sub-pixel residue is invisible: stop animating once it is tiny, so an
        // idle overlay costs nothing.
        if (
          Math.abs(smoothed.x - target.x) > 0.4 ||
          Math.abs(smoothed.y - target.y) > 0.4 ||
          Math.abs(smoothed.w - target.w) > 0.4 ||
          Math.abs(smoothed.h - target.h) > 0.4
        ) {
          animating = true;
        }
        nextTracks.set(key, smoothed);
        return {
          d,
          x: smoothed.x,
          y: smoothed.y,
          w: smoothed.w,
          h: smoothed.h,
          conf: smoothed.conf,
        };

      });
      // Boxes that disappeared this frame drop out of the map, so a returning
      // detection never eases in from a stale position.
      tracks = nextTracks;




      const eyes = boxes.filter(
        (b) => b.d.semantic === "eye_open" || b.d.semantic === "eye_closed",
      );
      // Midpoint between the outermost eye centres; with a single eye the split
      // degrades gracefully to "this eye is the left one".
      const eyeCentres = eyes.map((b) => b.x + b.w / 2);
      const eyeSplit =
        eyeCentres.length > 1
          ? (Math.min(...eyeCentres) + Math.max(...eyeCentres)) / 2
          : ox + cw / 2;

      for (const b of boxes) {
        const palette = highContrast ? HC_COLOR : RISK_COLOR;
        const color = palette[b.d.semantic] ?? (highContrast ? "#00ffff" : "#22d3ee");
        if (highContrast) {
          // Halo first, box on top: the outline survives a bright background.
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = 6;
          ctx.strokeRect(b.x, b.y, b.w, b.h);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = highContrast ? 3 : 2;
        ctx.strokeRect(b.x, b.y, b.w, b.h);

        const short = SHORT_LABEL[b.d.semantic] ?? b.d.semantic;
        const label = `${short} ${(b.conf * 100).toFixed(0)}%`;
        const tw = ctx.measureText(label).width + 8;

        const isEye = b.d.semantic === "eye_open" || b.d.semantic === "eye_closed";
        let lx: number;
        let ly: number;

        if (isEye) {
          const isLeftEye = b.x + b.w / 2 <= eyeSplit;
          // Left eye: pill ends at the box's left edge and extends further left.
          // Right eye: pill starts at the box's right edge and extends right.
          lx = isLeftEye ? b.x - tw - 2 : b.x + b.w + 2;
          ly = b.y - LH - 2;
          if (ly < oy) ly = b.y; // no headroom: sit level with the eye instead
          // If the outward side is clipped by the frame, tuck the pill against
          // the frame edge on that same side — never across to the other eye.
          if (lx < ox) lx = ox;
          if (lx + tw > ox + cw) lx = ox + cw - tw;
        } else {
          // Mouth: centred just under its box, clear of the eye band.
          lx = b.x + b.w / 2 - tw / 2;
          ly = b.y + b.h + 2;
          if (ly + LH > oy + ch) ly = Math.max(oy, b.y - LH - 2);
        }

        lx = Math.max(ox, Math.min(lx, ox + cw - tw));
        ly = Math.max(oy, Math.min(ly, oy + ch - LH));

        if (highContrast) {
          ctx.fillStyle = "#000000";
          ctx.fillRect(lx - 2, ly - 2, tw + 4, LH + 4);
        }
        ctx.fillStyle = color;
        ctx.fillRect(lx, ly, tw, LH);
        ctx.fillStyle = "#000000";
        ctx.fillText(label, lx + 4, ly + LH - 5);
      }


    };


    const startLoop = () => {
      if (raf) return;
      raf = requestAnimationFrame(draw);
    };
    const stopLoop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => {
      if (document.hidden) stopLoop();
      else {
        // Force one repaint after the tab wakes up.
        lastDets = null;
        startLoop();
      }
    };

    if (!document.hidden) startLoop();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopLoop();
    };
  }, [detectionsRef, video, mirrored, highContrast]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      />
      {/* The canvas itself is unreadable to assistive tech, so what it draws is
          also announced as text — throttled to 1 Hz so it stays followable. */}
      <DetectionAnnouncer detectionsRef={detectionsRef} />
    </>
  );
}

function DetectionAnnouncer({
  detectionsRef,
}: {
  detectionsRef: React.RefObject<Detection[]>;
}) {
  const [text, setText] = useState("");

  useEffect(() => {
    const id = window.setInterval(() => {
      const dets = detectionsRef.current ?? [];
      if (!dets.length) {
        setText("No face features detected");
        return;
      }
      const counts = new Map<string, number>();
      for (const d of dets) counts.set(d.label, (counts.get(d.label) ?? 0) + 1);
      setText(
        [...counts.entries()]
          .map(([label, n]) => `${n} ${SHORT_LABEL[label] ?? label}`)
          .join(", "),
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [detectionsRef]);

  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {text}
    </p>
  );
}

