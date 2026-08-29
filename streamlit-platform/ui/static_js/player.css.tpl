/* Custom video player -- injected into the components.v1.html iframe.
   Tokens ($bg, $accent, ...) are substituted by ui/player.py via
   string.Template so this file can be edited without touching Python. */

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: $bg; font-family: $font; }

.nbp-wrap {
  position: relative;
  width: 100%;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid $border;
  direction: ltr; /* video controls stay LTR even in Arabic -- a mirrored
                     scrub bar reads backwards regardless of language */
}

.nbp-video-box { position: relative; width: 100%; background: #000; }
.nbp-video { width: 100%; display: block; background: #000; }

.nbp-alert {
  position: absolute; top: 10px; left: 10px; right: 10px;
  padding: 8px 14px; border-radius: 8px;
  font-size: 13px; font-weight: 700; letter-spacing: .02em;
  display: none; align-items: center; gap: 8px;
  backdrop-filter: blur(6px);
  border: 1px solid currentColor;
}
.nbp-alert.show { display: flex; }
.nbp-alert.warning  { color: $warning; background: rgba(255,176,64,.16); }
.nbp-alert.critical { color: $danger;  background: rgba(255,77,94,.18); animation: nbp-pulse 1s ease-in-out infinite; }
@keyframes nbp-pulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(255,77,94,.5); }
  50%     { box-shadow: 0 0 0 8px rgba(255,77,94,0); }
}

.nbp-controls {
  background: $panel;
  padding: 8px 12px 10px;
}

.nbp-scrub {
  position: relative;
  height: 20px;
  cursor: pointer;
  margin-bottom: 6px;
}
.nbp-scrub-track {
  position: absolute; top: 8px; left: 0; right: 0; height: 4px;
  background: $track; border-radius: 2px; overflow: hidden;
}
.nbp-scrub-buffered {
  position: absolute; top: 0; left: 0; height: 100%;
  background: $bufferred; width: 0%;
}
.nbp-scrub-played {
  position: absolute; top: 0; left: 0; height: 100%;
  background: $accent; width: 0%;
}
.nbp-scrub-tick {
  position: absolute; top: 8px; width: 3px; height: 4px;
  border-radius: 1px; opacity: .9;
}
.nbp-scrub-handle {
  position: absolute; top: 3px; width: 12px; height: 12px;
  background: $accent; border-radius: 50%; transform: translateX(-6px);
  box-shadow: 0 0 0 3px rgba(0,0,0,.25);
}
.nbp-scrub-tip {
  position: absolute; bottom: 22px; transform: translateX(-50%);
  background: $panel2; border: 1px solid $border; color: $text;
  padding: 3px 7px; border-radius: 6px; font-size: 11px;
  white-space: nowrap; display: none; pointer-events: none;
}

.nbp-row { display: flex; align-items: center; gap: 6px; }
.nbp-row.between { justify-content: space-between; }

.nbp-btn {
  background: transparent; border: none; color: $text;
  cursor: pointer; padding: 6px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px;
}
.nbp-btn:hover { background: $panel2; color: $accent; }
.nbp-btn svg { width: 18px; height: 18px; fill: currentColor; }
.nbp-btn.big { width: 38px; height: 38px; }
.nbp-btn.big svg { width: 22px; height: 22px; }

.nbp-time {
  font-family: $mono; font-size: 12px; color: $muted;
  min-width: 96px; text-align: center; user-select: none;
}

.nbp-speed {
  background: $panel2; color: $text; border: 1px solid $border;
  border-radius: 6px; font-size: 11px; padding: 4px 6px; cursor: pointer;
}

.nbp-hint {
  font-size: 10px; color: $muted; text-align: center; padding-top: 2px;
}
