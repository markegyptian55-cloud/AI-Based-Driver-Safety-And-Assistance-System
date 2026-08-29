import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";

import videoAsset from "@/assets/sentryeye-intro.mp4.asset.json";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * Full-page background clip for the sign-in page. Always muted — browsers only
 * autoplay muted video — with a separate dialog player for sound.
 */
export function IntroVideoBackground() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {!reducedMotion && (
        <video
          src={videoAsset.url}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/70" />
      <div className="absolute inset-0 bg-background/40" />
    </div>
  );
}

/** Button + dialog that plays the same clip with sound and controls. */
export function WatchFullVideoButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    el.currentTime = 0;
    el.muted = false;
    void el.play().catch(() => undefined);
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className={`gap-2 bg-background/70 backdrop-blur ${className ?? ""}`}
        onClick={() => setOpen(true)}
      >
        <Play className="h-4 w-4" aria-hidden="true" />
        Watch full video
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl border-primary/20 bg-card/95 p-2 sm:p-4">
          <DialogTitle className="sr-only">SentryEye product walkthrough</DialogTitle>
          {open && (
            <video
              ref={ref}
              src={videoAsset.url}
              controls
              autoPlay
              playsInline
              className="aspect-video w-full rounded-md"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
