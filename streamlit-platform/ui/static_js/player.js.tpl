// Custom video player logic. Tokens ($events, $cues, $labels, $video_url) are
// substituted by ui/player.py via string.Template. Everything below is plain
// client-side JS -- no Python round-trip, so play/pause/seek never triggers a
// Streamlit rerun.
(function () {
  const video   = document.getElementById('nbp-video');
  const events  = $events;   // [{kind,t_start,t_end,duration,severity}, ...]
  const cues    = $cues;     // {warning:"data:...", critical:"data:...", microsleep:"data:...", full_closure:"data:..."}
  const L       = $labels;   // translated strings

  const scrub       = document.getElementById('nbp-scrub');
  const scrubPlayed  = document.getElementById('nbp-scrub-played');
  const scrubBuf     = document.getElementById('nbp-scrub-buffered');
  const scrubHandle  = document.getElementById('nbp-scrub-handle');
  const scrubTip     = document.getElementById('nbp-scrub-tip');
  const playBtn      = document.getElementById('nbp-play');
  const timeLabel    = document.getElementById('nbp-time');
  const speedSel     = document.getElementById('nbp-speed');
  const alertBox     = document.getElementById('nbp-alert');
  const fullscreenBtn= document.getElementById('nbp-fullscreen');

  const ICON_PLAY  = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

  function fmt(t) {
    if (!isFinite(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = (t - m * 60).toFixed(1).padStart(4, '0');
    return m + ':' + s;
  }

  // ---- scrub bar event ticks (severity-coloured) ----
  const SEV_COLOR = { info: '$accent', warning: '$warning', critical: '$danger' };
  function layoutTicks() {
    const dur = video.duration || 1;
    document.querySelectorAll('.nbp-scrub-tick').forEach(function (el) { el.remove(); });
    events.forEach(function (ev) {
      const el = document.createElement('div');
      el.className = 'nbp-scrub-tick';
      el.style.left = (Math.min(ev.t_start / dur, 0.995) * 100) + '%';
      el.style.background = SEV_COLOR[ev.severity] || '$accent';
      el.title = ev.kind + ' (' + ev.duration.toFixed(2) + 's)';
      scrub.appendChild(el);
    });
  }

  // ---- audio cue scheduling ----
  const audioEls = {};
  Object.keys(cues).forEach(function (kind) {
    const a = document.createElement('audio');
    a.preload = 'auto';
    a.src = cues[kind];
    audioEls[kind] = a;
  });
  const CUE_FOR_EVENT = { micro_sleep: 'microsleep', full_closure: 'full_closure', yawn: 'warning' };
  let fired = new Set();
  let lastCheckedTime = -1.0;
  let audioUnlocked = false;

  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    Object.values(audioEls).forEach(function (a) {
      try {
        const p = a.play();
        if (p) {
          p.then(function () { a.pause(); a.currentTime = 0; }).catch(function () {});
        }
      } catch (e) {}
    });
  }

  function maybeFireCues(t) {
    // Re-arm cues if the user seeks backward past a point they already fired.
    if (lastCheckedTime >= 0 && t < lastCheckedTime - 0.3) {
      fired = new Set();
    }
    const prevT = lastCheckedTime >= 0 ? lastCheckedTime : (t - 0.4);
    lastCheckedTime = t;

    events.forEach(function (ev, idx) {
      // Range intersection between [prevT, t] and event timestamp
      const passedInThisTick = (ev.t_start >= prevT - 0.08 && ev.t_start <= t + 0.15);
      const isCurrentlyActive = (t >= ev.t_start && t <= ev.t_end + 0.1);

      if ((passedInThisTick || isCurrentlyActive) && !fired.has(idx)) {
        fired.add(idx);
        const cueKind = CUE_FOR_EVENT[ev.kind] || (ev.severity === 'critical' ? 'critical' : 'warning');
        if (cueKind && audioEls[cueKind] && !video.muted) {
          try {
            audioEls[cueKind].currentTime = 0;
            const p = audioEls[cueKind].play();
            if (p) p.catch(function () {});
          } catch (e) {}
        }
        if (ev.severity === 'warning' || ev.severity === 'critical' || ev.kind === 'micro_sleep' || ev.kind === 'full_closure') {
          showAlert(ev.severity, ev.kind);
        }
      }
    });
  }

  let alertTimer = null;
  function showAlert(severity, kind) {
    alertBox.className = 'nbp-alert show ' + (severity || 'warning');
    alertBox.textContent = (L[kind] || kind) + (severity === 'critical' ? ' 🚨!' : ' ⚠️');
    clearTimeout(alertTimer);
    alertTimer = setTimeout(function () { alertBox.classList.remove('show'); }, 2500);
  }

  // ---- transport controls ----
  function togglePlay() {
    unlockAudio();
    if (video.paused) { video.play(); } else { video.pause(); }
  }
  playBtn.addEventListener('click', togglePlay);
  video.addEventListener('click', togglePlay);
  video.addEventListener('play',  function () { unlockAudio(); playBtn.innerHTML = ICON_PAUSE; });
  video.addEventListener('pause', function () { playBtn.innerHTML = ICON_PLAY; });

  document.getElementById('nbp-back5').addEventListener('click', function () {
    video.currentTime = Math.max(0, video.currentTime - 5);
  });
  document.getElementById('nbp-fwd5').addEventListener('click', function () {
    video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 5);
  });
  document.getElementById('nbp-frameback').addEventListener('click', function () {
    video.currentTime = Math.max(0, video.currentTime - (1 / 30));
  });
  document.getElementById('nbp-frameforward').addEventListener('click', function () {
    video.currentTime = Math.min(video.duration || 1e9, video.currentTime + (1 / 30));
  });
  speedSel.addEventListener('change', function () { video.playbackRate = parseFloat(speedSel.value); });
  fullscreenBtn.addEventListener('click', function () {
    const box = document.querySelector('.nbp-wrap');
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else if (box.requestFullscreen) { box.requestFullscreen(); }
  });

  // ---- scrub bar ----
  function seekFromClientX(clientX) {
    const rect = scrub.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    video.currentTime = frac * (video.duration || 0);
  }
  let dragging = false;
  scrub.addEventListener('mousedown', function (e) { dragging = true; seekFromClientX(e.clientX); });
  window.addEventListener('mousemove', function (e) {
    if (dragging) seekFromClientX(e.clientX);
    const rect = scrub.getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top - 4 && e.clientY <= rect.bottom + 4) {
      const frac = (e.clientX - rect.left) / rect.width;
      const tt = frac * (video.duration || 0);
      scrubTip.style.left = (frac * 100) + '%';
      scrubTip.style.display = 'block';
      scrubTip.textContent = fmt(tt);
    } else if (!dragging) {
      scrubTip.style.display = 'none';
    }
  });
  window.addEventListener('mouseup', function () { dragging = false; });

  video.addEventListener('timeupdate', function () {
    const dur = video.duration || 1;
    const pct = Math.min(100, (video.currentTime / dur) * 100);
    scrubPlayed.style.width = pct + '%';
    scrubHandle.style.left = pct + '%';
    timeLabel.textContent = fmt(video.currentTime) + ' / ' + fmt(dur);
    maybeFireCues(video.currentTime);
  });
  video.addEventListener('progress', function () {
    if (video.buffered.length && video.duration) {
      const end = video.buffered.end(video.buffered.length - 1);
      scrubBuf.style.width = Math.min(100, (end / video.duration) * 100) + '%';
    }
  });
  // ---- position persistence across Streamlit reruns ----
  // st.iframe() has no channel back to Python (unlike a real custom
  // component), so a rerun triggered by ANYTHING outside this iframe --
  // sidebar theme/language toggle, model switch, another widget entirely --
  // rebuilds this iframe from scratch and would restart playback at 0:00.
  // localStorage is per-origin and survives that rebuild with no server
  // round-trip at all. Keyed by the video's own URL, so different clips
  // (raw vs annotated, different runs) never collide.
  const POS_KEY = 'nb-player-pos::' + '$video_url';
  let lastSaved = 0;
  video.addEventListener('timeupdate', function () {
    // Throttle to ~1 write/sec -- timeupdate can fire many times/sec.
    if (video.currentTime - lastSaved >= 1 || video.currentTime < lastSaved) {
      lastSaved = video.currentTime;
      try { localStorage.setItem(POS_KEY, String(video.currentTime)); } catch (e) {}
    }
  });

  video.addEventListener('loadedmetadata', function () {
    layoutTicks();
    let resumeAt = $start_at;
    if (!resumeAt) {
      try {
        const saved = parseFloat(localStorage.getItem(POS_KEY));
        if (isFinite(saved) && saved > 0 && saved < video.duration - 0.5) { resumeAt = saved; }
      } catch (e) {}
    }
    if (resumeAt > 0) { video.currentTime = resumeAt; }
  });

  // ---- keyboard shortcuts (only while this iframe has focus) ----
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'SELECT') return;
    switch (e.key) {
      case ' ': case 'k': e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft':  video.currentTime = Math.max(0, video.currentTime - 5); break;
      case 'ArrowRight': video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 5); break;
      case 'j': video.currentTime = Math.max(0, video.currentTime - 10); break;
      case 'l': video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 10); break;
      case 'f': fullscreenBtn.click(); break;
    }
  });
})();
