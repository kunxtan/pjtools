/* CineScope sound effects — generated with the Web Audio API (no audio files).
 *
 * Sound is OFF by default (the 🔊/🔇 button in the navbar turns it on, and the
 * choice is remembered). The AudioContext is only created after the user
 * presses something on the page, or on the page that loads right after they
 * pressed save/delete (so the "saved" clapper sound can play).
 *
 * Usage: CineAudio.play("click" | "clapper" | "film" | "cash" |
 *                       "blockbuster" | "hit" | "breakeven" | "flop")
 */
const CineAudio = (() => {
  const STORAGE_KEY = "cinescope-sound";
  const ACTION_KEY = "cinescope-user-action"; // set when a form is submitted
  const ACTION_WINDOW_MS = 10000;
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let enabled = readPreference();
  let userHasPressed = false;

  function readPreference() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "on";
    } catch (error) {
      return false;
    }
  }

  function savePreference() {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
    } catch (error) {
      /* storage may be blocked; the setting then lasts for this page only */
    }
  }

  function ensureContext() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function getNoiseBuffer() {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }

  // Gain envelope: quick attack, exponential decay.
  function envelope(start, duration, volume, attack = 0.005) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    gain.connect(master);
    return gain;
  }

  function tone({ freq, endFreq, type = "sine", start, duration, volume = 0.3, attack, vibrato = 0 }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 6;
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + duration);
    }
    osc.connect(envelope(start, duration, volume, attack));
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  function noise({ start, duration, volume = 0.3, filter = "bandpass", freq = 2000, q = 1 }) {
    const source = ctx.createBufferSource();
    source.buffer = getNoiseBuffer();
    const biquad = ctx.createBiquadFilter();
    biquad.type = filter;
    biquad.frequency.value = freq;
    biquad.Q.value = q;
    source.connect(biquad).connect(envelope(start, duration, volume, 0.002));
    source.start(start);
    source.stop(start + duration + 0.05);
  }

  function melody(t, notes, { type = "triangle", gap = 0.13, volume = 0.22, last = 0.6 } = {}) {
    notes.forEach((freq, i) => {
      const isLast = i === notes.length - 1;
      tone({ freq, type, start: t + i * gap, duration: isLast ? last : gap * 1.6, volume });
    });
  }

  const sounds = {
    click(t) {
      tone({ freq: 1800, endFreq: 1100, type: "square", start: t, duration: 0.04, volume: 0.06 });
    },

    // Clapperboard "clack": sharp wooden snap + low body thump
    clapper(t) {
      noise({ start: t, duration: 0.08, volume: 0.9, filter: "highpass", freq: 1800, q: 0.7 });
      noise({ start: t, duration: 0.05, volume: 0.6, filter: "bandpass", freq: 3200, q: 2 });
      tone({ freq: 190, endFreq: 70, start: t, duration: 0.14, volume: 0.55 });
    },

    // Projector film rolling: fast mechanical ticks over a low hum
    film(t) {
      for (let i = 0; i < 30; i++) {
        noise({ start: t + i * 0.042, duration: 0.014, volume: 0.22, freq: 2800, q: 3 });
      }
      tone({ freq: 55, type: "sawtooth", start: t, duration: 1.3, volume: 0.03, attack: 0.1 });
    },

    // Cash register: drawer ticks followed by a bell "ching"
    cash(t) {
      for (let i = 0; i < 6; i++) {
        noise({ start: t + i * 0.05, duration: 0.02, volume: 0.3, freq: 1500, q: 4 });
      }
      tone({ freq: 1318.5, start: t + 0.34, duration: 0.9, volume: 0.22 });
      tone({ freq: 2637, start: t + 0.34, duration: 0.6, volume: 0.1 });
      tone({ freq: 1760, start: t + 0.42, duration: 0.9, volume: 0.18 });
    },

    // Simulator verdicts
    blockbuster(t) {
      melody(t, [523.25, 659.25, 783.99, 1046.5], { type: "sawtooth", volume: 0.12, last: 0.9 });
      melody(t, [261.63, 329.63, 392, 523.25], { type: "triangle", volume: 0.18, last: 0.9 });
      noise({ start: t + 0.39, duration: 1.0, volume: 0.18, filter: "highpass", freq: 6000, q: 0.5 });
    },

    hit(t) {
      melody(t, [587.33, 783.99, 987.77], { type: "triangle", gap: 0.12, volume: 0.24, last: 0.55 });
    },

    breakeven(t) {
      melody(t, [523.25, 523.25], { type: "square", gap: 0.18, volume: 0.07, last: 0.35 });
    },

    // "Sad trombone"
    flop(t) {
      const steps = [[392, 370], [370, 349.23], [349.23, 329.63]];
      steps.forEach(([from, to], i) => {
        tone({ freq: from, endFreq: to, type: "sawtooth", start: t + i * 0.42, duration: 0.4, volume: 0.1 });
      });
      tone({ freq: 329.63, endFreq: 293.66, type: "sawtooth", start: t + 1.26, duration: 1.0,
             volume: 0.1, vibrato: 7 });
    },
  };

  // The page that loads right after the user pressed "save" / "delete" may play
  // its confirmation sound: that press started this navigation.
  function cameFromUserAction() {
    try {
      const at = Number(sessionStorage.getItem(ACTION_KEY));
      sessionStorage.removeItem(ACTION_KEY);
      return at > 0 && Date.now() - at < ACTION_WINDOW_MS;
    } catch (error) {
      return false;
    }
  }

  function markUserAction() {
    try {
      sessionStorage.setItem(ACTION_KEY, String(Date.now()));
    } catch (error) {
      /* storage blocked: the next page simply stays silent */
    }
  }

  function play(name) {
    if (!enabled || !sounds[name]) return;
    // The AudioContext only starts after the user has pressed something.
    if (!userHasPressed) userHasPressed = cameFromUserAction();
    if (!userHasPressed) return;
    const context = ensureContext();
    if (!context) return;

    if (context.state === "running") {
      sounds[name](context.currentTime + 0.01);
      return;
    }
    // Not running yet (e.g. right after a page load). Play only if the browser
    // allows it straight away, so a sound never fires late on a random click.
    const requestedAt = performance.now();
    context.resume().then(() => {
      if (context.state === "running" && performance.now() - requestedAt < 400) {
        sounds[name](context.currentTime + 0.01);
      }
    });
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    userHasPressed = true; // called from a click on the sound button
    savePreference();
    if (enabled) ensureContext();
  }

  // Start the AudioContext after the first user gesture (if sound is on).
  function unlockOnFirstGesture() {
    const unlock = () => {
      userHasPressed = true;
      if (enabled) ensureContext();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

  unlockOnFirstGesture();

  return {
    play,
    setEnabled,
    markUserAction,
    isEnabled: () => enabled,
  };
})();
