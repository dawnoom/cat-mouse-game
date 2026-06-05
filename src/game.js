const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d", { alpha: false });
const startButton = document.querySelector("#startButton");
const hotspot = document.querySelector("#settingsHotspot");
const settingsPanel = document.querySelector("#settingsPanel");
const volumeInput = document.querySelector("#volume");
const speedInput = document.querySelector("#speed");
const speedValue = document.querySelector("#speedValue");
const speedPresetButtons = Array.from(document.querySelectorAll(".speed-preset"));
const themeButton = document.querySelector("#themeButton");
const themePanel = document.querySelector("#themePanel");
const themeOptionButtons = Array.from(document.querySelectorAll(".theme-option"));

const settings = {
  volume: 0.62,
  speed: 1.05,
};

const MOUSE_COUNT = 1;
const BODY_SCALE = 1.72;
const TAIL_BODY_MULTIPLIER = 4.6;
const MOVING_PHASES = new Set(["reappear", "creep", "dash", "zigzag", "escape"]);
const ADAPTIVE_NO_TOUCH_MS = 30000;
const ADAPTIVE_WATCH_MS = 12000;
const FAST_HIT_WINDOW_MS = 3200;
const BLUE_MOUSE = {
  kind: "mouse",
  body: "#66bff2",
  bodyDeep: "#3497d6",
  belly: "#f7fcff",
  ear: "#ffc2d8",
  tail: "#2e9eda",
  cheek: "#ff98bd",
  nose: "#ef8a9a",
};
const INK = "#314f59";
const THEMES = {
  mouse: {
    id: "mouse",
    label: "小老鼠",
    colors: BLUE_MOUSE,
    bg: ["#f8fff6", "#f0fbf7", "#fff9ef"],
    accents: ["#fce7b0", "#ccefeb", "#d9efff"],
    paper: ["#fff8dc", "#f2ead5", "#d9eef4", "#cfe7e2"],
    sound: { rustle: "rustle", move: "steps", scare: "scare", catch: "rustle" },
  },
  yarn: {
    id: "yarn",
    label: "亮蓝毛线球",
    colors: {
      kind: "yarn",
      body: "#18a7ff",
      bodyDeep: "#0275cf",
      belly: "#dff7ff",
      tail: "#0b8fe8",
      cheek: "#7bdcff",
      ear: "#a8ecff",
      nose: "#fff8ca",
    },
    bg: ["#f5fdff", "#eaf9ff", "#f8fff7"],
    accents: ["#b9efff", "#d8f5ff", "#a8e8ff"],
    paper: ["#dff7ff", "#bdeeff", "#81d8ff", "#f3fdff"],
    sound: { rustle: "yarn", move: "yarn", scare: "scrape", catch: "yarn" },
  },
  paper: {
    id: "paper",
    label: "浅绿纸团",
    colors: {
      kind: "paper",
      body: "#b8e8c9",
      bodyDeep: "#69ba8c",
      belly: "#edfff1",
      tail: "#8bd1a8",
      cheek: "#d9f8ce",
      ear: "#cef1d8",
      nose: "#82bd8f",
    },
    bg: ["#fbfff3", "#effbeb", "#f8fff8"],
    accents: ["#d7f4cc", "#bce8c7", "#ecf8c8"],
    paper: ["#e8ffe9", "#c8f0cf", "#a8dfb5", "#f6fff2"],
    sound: { rustle: "paper", move: "rustle", scare: "scare", catch: "paper" },
  },
};

const state = {
  dpr: 1,
  width: 1,
  height: 1,
  targets: [],
  ripples: [],
  sparkleDust: [],
  paperBits: [],
  lastTime: performance.now(),
  running: false,
  starting: false,
  userStarted: false,
  audio: null,
  masterGain: null,
  plasticGain: null,
  cardboardGain: null,
  tapGain: null,
  plasticPanner: null,
  cardboardPanner: null,
  tapPanner: null,
  plasticNoise: null,
  cardboardNoise: null,
  tapNoise: null,
  movementAudio: null,
  wakeLock: null,
  pointerCooldown: new Map(),
  hideouts: [],
  themeId: "mouse",
  adaptive: {
    lastCatchAt: performance.now(),
    lastPointerAt: performance.now(),
    hitStreak: 0,
    noTouchAssist: 0,
    watchAssist: 0,
    challenge: 0,
    soundCue: 0,
    targetScale: 1,
    speedScale: 1,
    tailBoost: 1,
    curveBoost: 1,
  },
};

function resize() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.width = Math.max(1, window.innerWidth);
  state.height = Math.max(1, window.innerHeight);
  canvas.width = Math.floor(state.width * state.dpr);
  canvas.height = Math.floor(state.height * state.dpr);
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  state.hideouts = createHideouts();
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function choose(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function activeTheme() {
  return THEMES[state.themeId] || THEMES.mouse;
}

function setTheme(themeId) {
  if (!THEMES[themeId]) return;
  state.themeId = themeId;
  for (const button of themeOptionButtons) {
    button.classList.toggle("is-active", button.dataset.theme === themeId);
  }
  themeButton.textContent = THEMES[themeId].label;
  themeButton.setAttribute("aria-expanded", "false");
  themePanel.hidden = true;
  state.ripples.length = 0;
  state.sparkleDust.length = 0;
  state.paperBits.length = 0;
  state.targets = state.targets.map(() => spawnMouse());
}

function uuid() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function createHideouts() {
  const w = state.width;
  const h = state.height;
  return [
    { x: -16, y: h * 0.22, rx: 72, ry: 108, angle: 0.1 },
    { x: w + 16, y: h * 0.68, rx: 84, ry: 124, angle: -0.12 },
    { x: w * 0.52, y: -18, rx: 128, ry: 58, angle: 0.04 },
    { x: w * 0.22, y: h + 18, rx: 122, ry: 62, angle: -0.08 },
  ];
}

function routeDurationForDistance(distance, speed) {
  return clamp((distance / Math.max(1, speed)) * rand(0.74, 1.08), 0.65, 4.2);
}

function edgePoint(radius, inset = false) {
  const side = Math.floor(rand(0, 4));
  const outside = inset ? radius * 1.5 : radius * 3.8;
  if (side === 0) return { x: -outside, y: rand(radius, state.height - radius) };
  if (side === 1) return { x: state.width + outside, y: rand(radius, state.height - radius) };
  if (side === 2) return { x: rand(radius, state.width - radius), y: -outside };
  return { x: rand(radius, state.width - radius), y: state.height + outside };
}

function farPoint(from, radius, allowExit = false) {
  const minDistance = Math.min(state.width, state.height) * rand(0.62, 0.98);
  const maxAttempts = 28;
  for (let i = 0; i < maxAttempts; i += 1) {
    const point = Math.random() < 0.18 || allowExit
      ? edgePoint(radius)
      : {
          x: rand(radius * 1.2, state.width - radius * 1.2),
          y: rand(radius * 1.2, state.height - radius * 1.2),
        };
    if (Math.hypot(point.x - from.x, point.y - from.y) >= minDistance || i === maxAttempts - 1) {
      return point;
    }
  }
  return edgePoint(radius);
}

function nearPoint(from, radius) {
  const distance = rand(Math.min(state.width, state.height) * 0.16, Math.min(state.width, state.height) * 0.38);
  const angle = rand(0, Math.PI * 2);
  return {
    x: clamp(from.x + Math.cos(angle) * distance, radius * 1.15, state.width - radius * 1.15),
    y: clamp(from.y + Math.sin(angle) * distance, radius * 1.15, state.height - radius * 1.15),
  };
}

function adaptiveSpeedForPhase(phase) {
  const adaptive = state.adaptive;
  const calmDown = 1 - adaptive.noTouchAssist * 0.34;
  const challengeBoost = phase === "dash" || phase === "zigzag" || phase === "escape"
    ? 1 + adaptive.challenge * 0.32
    : 1 + adaptive.challenge * 0.08;
  const watchSlowdown = phase === "creep" || phase === "reappear" ? 1 - adaptive.watchAssist * 0.18 : 1;
  return clamp(calmDown * challengeBoost * watchSlowdown, 0.58, 1.46);
}

function adaptiveCurveZeroChance(phase) {
  if (phase === "creep") return 0.18;
  return clamp(0.38 - state.adaptive.challenge * 0.28, 0.08, 0.42);
}

function updateAdaptive(now) {
  if (!state.running) return;
  const adaptive = state.adaptive;
  const noCatchMs = now - adaptive.lastCatchAt;
  const noTouchTarget = noCatchMs >= ADAPTIVE_NO_TOUCH_MS ? 1 : 0;
  const watchTarget = noCatchMs >= ADAPTIVE_WATCH_MS ? 1 : 0;
  const decayTarget = adaptive.hitStreak >= 2 ? clamp(adaptive.hitStreak / 4, 0, 1) : 0;

  adaptive.noTouchAssist += (noTouchTarget - adaptive.noTouchAssist) * 0.018;
  adaptive.watchAssist += (watchTarget - adaptive.watchAssist) * 0.026;
  adaptive.challenge += (decayTarget - adaptive.challenge) * 0.022;
  adaptive.soundCue = clamp(adaptive.noTouchAssist * 0.52 + adaptive.watchAssist * 0.2, 0, 0.72);
  adaptive.targetScale = 1 + adaptive.noTouchAssist * 0.28;
  adaptive.speedScale = 1 - adaptive.noTouchAssist * 0.3 + adaptive.challenge * 0.2;
  adaptive.tailBoost = 1 + adaptive.watchAssist * 1.15 + adaptive.noTouchAssist * 0.25;
  adaptive.curveBoost = 1 + adaptive.challenge * 0.85;

  if (noCatchMs > FAST_HIT_WINDOW_MS * 2.4 && adaptive.hitStreak > 0) {
    adaptive.hitStreak = Math.max(0, adaptive.hitStreak - 0.012);
  }

  for (const target of state.targets) {
    if (!target.baseRadius) target.baseRadius = target.radius;
    const desiredRadius = target.baseRadius * adaptive.targetScale;
    target.radius += (desiredRadius - target.radius) * 0.045;
    target.hitRadius = target.radius * 1.16;
  }
}

function resetAdaptive(now) {
  Object.assign(state.adaptive, {
    lastCatchAt: now,
    lastPointerAt: now,
    hitStreak: 0,
    noTouchAssist: 0,
    watchAssist: 0,
    challenge: 0,
    soundCue: 0,
    targetScale: 1,
    speedScale: 1,
    tailBoost: 1,
    curveBoost: 1,
  });
  for (const target of state.targets) {
    if (target.baseRadius) {
      target.radius = target.baseRadius;
      target.hitRadius = target.radius * 1.16;
    }
  }
}

function getAdaptiveDebugState() {
  return {
    hitStreak: Math.round(state.adaptive.hitStreak * 100) / 100,
    noTouchAssist: Math.round(state.adaptive.noTouchAssist * 100) / 100,
    watchAssist: Math.round(state.adaptive.watchAssist * 100) / 100,
    challenge: Math.round(state.adaptive.challenge * 100) / 100,
    targetScale: Math.round(state.adaptive.targetScale * 100) / 100,
    speedScale: Math.round(state.adaptive.speedScale * 100) / 100,
    tailBoost: Math.round(state.adaptive.tailBoost * 100) / 100,
    curveBoost: Math.round(state.adaptive.curveBoost * 100) / 100,
  };
}

function spawnMouse(overrides = {}) {
  const radius = rand(36, 43) * BODY_SCALE;
  const start = overrides.x === undefined ? edgePoint(radius, true) : { x: overrides.x, y: overrides.y };
  const theme = activeTheme();
  const mouse = {
    id: uuid(),
    x: start.x,
    y: start.y,
    radius,
    baseRadius: radius,
    hitRadius: radius * 1.16,
    vx: 0,
    vy: 0,
    phase: "hide",
    previousPhase: "hide",
    phaseUntil: performance.now() + 1000,
    routeStartX: start.x,
    routeStartY: start.y,
    destX: start.x,
    destY: start.y,
    routeElapsed: 0,
    routeDuration: 2,
    routeCurve: rand(-1, 1),
    moveBlend: 1,
    visibility: 1,
    trail: [],
    zigzagSeed: rand(0, Math.PI * 2),
    stride: rand(0, Math.PI * 2),
    tailWobble: rand(0, Math.PI * 2),
    tailSeed: rand(0, Math.PI * 2),
    blink: rand(0, 4),
    paperSeed: rand(0, 1000),
    speedBase: 240,
    caught: false,
    respawnAt: 0,
    colors: theme.colors,
    scaredUntil: 0,
  };
  chooseNextPhase(mouse, performance.now(), "reappear");
  return mouse;
}

function syncMice() {
  while (state.targets.length < MOUSE_COUNT) state.targets.push(spawnMouse());
  while (state.targets.length > MOUSE_COUNT) state.targets.pop();
}

function nextPhaseAfter(phase) {
  if (phase === "hide") return "reappear";
  if (phase === "reappear") return choose(state.adaptive.watchAssist > 0.35 ? ["creep", "freeze", "freeze"] : ["creep", "creep", "freeze"]);
  if (phase === "creep") return choose(state.adaptive.watchAssist > 0.35 ? ["freeze", "freeze", "dash", "zigzag"] : ["freeze", "dash", "zigzag"]);
  if (phase === "freeze") return choose(state.adaptive.watchAssist > 0.35 ? ["dash", "zigzag", "creep", "creep"] : ["dash", "dash", "zigzag", "creep"]);
  if (phase === "dash") return choose(["freeze", "zigzag", "escape"]);
  if (phase === "zigzag") return choose(["freeze", "dash", "escape"]);
  if (phase === "escape") return "hide";
  return "creep";
}

function chooseNextPhase(target, now, forcedPhase = null) {
  const next = forcedPhase || nextPhaseAfter(target.phase);
  target.previousPhase = target.phase;
  target.phase = next;
  target.zigzagSeed = rand(0, Math.PI * 2);

  if (next === "hide") {
    target.visibility = 0;
    target.moveBlend = 0;
    target.phaseUntil = now + rand(520, 1400);
    target.vx = 0;
    target.vy = 0;
    target.trail.length = 0;
    return;
  }

  if (next === "freeze") {
    target.visibility = 1;
    target.phaseUntil = now + rand(260, 1200 + state.adaptive.watchAssist * 1100);
    target.vx = 0;
    target.vy = 0;
    return;
  }

  const from = { x: target.x, y: target.y };
  let destination;
  let speed;

  if (next === "reappear") {
    const start = edgePoint(target.radius, true);
    target.x = start.x;
    target.y = start.y;
    target.routeStartX = start.x;
    target.routeStartY = start.y;
    destination = nearPoint({ x: clamp(start.x, 0, state.width), y: clamp(start.y, 0, state.height) }, target.radius);
    speed = rand(180, 260) * adaptiveSpeedForPhase(next);
    target.visibility = 0.74;
    playEventNoise(activeTheme().sound.rustle, target.x, 0.11 + state.adaptive.soundCue * 0.06, 0.14);
  } else if (next === "creep") {
    destination = nearPoint(from, target.radius);
    speed = rand(95, 165) * adaptiveSpeedForPhase(next);
    target.visibility = 1;
    if (Math.random() < 0.58) playEventNoise(activeTheme().sound.rustle, target.x, 0.055 + state.adaptive.soundCue * 0.04, 0.1);
  } else if (next === "dash") {
    destination = farPoint(from, target.radius, false);
    speed = rand(420, 640) * adaptiveSpeedForPhase(next);
    target.visibility = 1;
  } else if (next === "zigzag") {
    destination = farPoint(from, target.radius, Math.random() < 0.18);
    speed = rand(340, 520) * adaptiveSpeedForPhase(next);
    target.visibility = 1;
  } else {
    destination = farPoint(from, target.radius, true);
    speed = rand(520, 720) * adaptiveSpeedForPhase(next);
    target.visibility = 1;
  }

  if (next !== "reappear") {
    target.routeStartX = from.x;
    target.routeStartY = from.y;
  }
  const routeFrom = { x: target.routeStartX, y: target.routeStartY };
  const distance = Math.hypot(destination.x - routeFrom.x, destination.y - routeFrom.y);
  target.destX = destination.x;
  target.destY = destination.y;
  target.routeElapsed = 0;
  target.routeDuration = routeDurationForDistance(distance, speed);
  target.routeCurve = next === "creep"
    ? rand(-0.45, 0.45)
    : Math.random() < adaptiveCurveZeroChance(next)
      ? 0
      : rand(-1.35, 1.35) * state.adaptive.curveBoost;
  target.speedBase = speed;
  target.phaseUntil = now + target.routeDuration * 1000;
  target.moveBlend = Math.max(target.moveBlend, next === "creep" ? 0.35 : 0.72);
  if (next === "dash" || next === "zigzag" || next === "escape") {
    playEventNoise(next === "dash" ? activeTheme().sound.move : activeTheme().sound.scare, target.x, next === "escape" ? 0.24 : 0.17, next === "dash" ? 0.14 : 0.16);
  }
}

function respawnFromEdge(target, now) {
  const replacement = spawnMouse(edgePoint(target.radius, true));
  Object.assign(target, replacement);
  chooseNextPhase(target, now, "reappear");
}

function initAudio() {
  if (state.audio) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  state.audio = new AudioContext();
  state.masterGain = state.audio.createGain();
  state.masterGain.gain.value = settings.volume;
  state.masterGain.connect(state.audio.destination);
}

function initMovementElementAudio() {
  if (state.movementAudio) return;
  state.movementAudio = new Audio(createMovementWavDataUri());
  state.movementAudio.loop = true;
  state.movementAudio.preload = "auto";
  state.movementAudio.volume = 0;
  state.movementAudio.playsInline = true;
}

function writeWavHeader(view, sampleRate, length) {
  let offset = 0;
  const dataSize = length * 2;
  const writeString = (value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset, value.charCodeAt(i));
      offset += 1;
    }
  };

  writeString("RIFF");
  view.setUint32(offset, 36 + dataSize, true); offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * 2, true); offset += 4;
  view.setUint16(offset, 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeString("data");
  view.setUint32(offset, dataSize, true); offset += 4;
  return offset;
}

function createMovementWavDataUri() {
  const sampleRate = 24000;
  const seconds = 3.8;
  const length = Math.floor(sampleRate * seconds);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  let offset = writeWavHeader(view, sampleRate, length);
  let scrape = 0;
  let heldPlastic = 0;
  let seed = Math.random() * 10;

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    if (i % 270 === 0) heldPlastic = Math.random() * 2 - 1;
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const noise = (seed / 4294967296) * 2 - 1;
    scrape = scrape * 0.965 + noise * 0.035;
    const fastStep = Math.max(0, Math.sin(t * Math.PI * 11.6));
    const tinyStep = fastStep ** 10;
    const crinkleGate = Math.random() > 0.918 ? 1 : 0.18;
    const plastic = (heldPlastic * 0.36 + noise * crinkleGate) * (0.38 + tinyStep * 0.82);
    const cardboard = scrape * (0.68 + 0.32 * Math.sin(t * Math.PI * 4.2));
    const squeak = Math.sin(t * Math.PI * 2 * 2600) * (Math.random() > 0.996 ? 0.24 : 0);
    const sample = clamp(plastic * 0.5 + cardboard * 0.42 + tinyStep * noise * 0.28 + squeak, -1, 1) * 0.82;
    view.setInt16(offset, sample * 32767, true);
    offset += 2;
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function createNoiseSource(seconds, kind) {
  const length = Math.floor(state.audio.sampleRate * seconds);
  const buffer = state.audio.createBuffer(1, length, state.audio.sampleRate);
  const data = buffer.getChannelData(0);
  let held = 0;
  let scrape = 0;
  for (let i = 0; i < length; i += 1) {
    const t = i / state.audio.sampleRate;
    if (kind === "plastic") {
      if (i % 420 === 0) held = Math.random() * 2 - 1;
      const snap = Math.random() > 0.942 ? Math.random() * 2 - 1 : held * 0.26;
      data[i] = snap * (0.42 + 0.58 * Math.max(0, Math.sin(t * Math.PI * 11.5)) ** 8);
    } else if (kind === "tap") {
      const step = Math.max(0, Math.sin(t * Math.PI * 10.8)) ** 16;
      data[i] = (Math.random() * 2 - 1) * step;
    } else {
      scrape = scrape * 0.955 + (Math.random() * 2 - 1) * 0.045;
      data[i] = scrape * (0.65 + 0.35 * Math.sin(t * Math.PI * 5.1));
    }
  }

  const source = state.audio.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

function startMovementNoise() {
  if (!state.audio || !state.masterGain || state.plasticNoise) return;

  const plasticFilter = state.audio.createBiquadFilter();
  plasticFilter.type = "highpass";
  plasticFilter.frequency.value = 1800;
  plasticFilter.Q.value = 0.8;
  state.plasticGain = state.audio.createGain();
  state.plasticGain.gain.value = 0.0001;
  state.plasticPanner = state.audio.createStereoPanner ? state.audio.createStereoPanner() : null;
  state.plasticNoise = createNoiseSource(2.6, "plastic");
  state.plasticNoise.connect(plasticFilter);
  plasticFilter.connect(state.plasticGain);
  if (state.plasticPanner) {
    state.plasticGain.connect(state.plasticPanner);
    state.plasticPanner.connect(state.masterGain);
  } else {
    state.plasticGain.connect(state.masterGain);
  }
  state.plasticNoise.start();

  const cardboardFilter = state.audio.createBiquadFilter();
  cardboardFilter.type = "bandpass";
  cardboardFilter.frequency.value = 720;
  cardboardFilter.Q.value = 1.1;
  state.cardboardGain = state.audio.createGain();
  state.cardboardGain.gain.value = 0.0001;
  state.cardboardPanner = state.audio.createStereoPanner ? state.audio.createStereoPanner() : null;
  state.cardboardNoise = createNoiseSource(3.1, "cardboard");
  state.cardboardNoise.connect(cardboardFilter);
  cardboardFilter.connect(state.cardboardGain);
  if (state.cardboardPanner) {
    state.cardboardGain.connect(state.cardboardPanner);
    state.cardboardPanner.connect(state.masterGain);
  } else {
    state.cardboardGain.connect(state.masterGain);
  }
  state.cardboardNoise.start();

  const tapFilter = state.audio.createBiquadFilter();
  tapFilter.type = "bandpass";
  tapFilter.frequency.value = 2400;
  tapFilter.Q.value = 2.5;
  state.tapGain = state.audio.createGain();
  state.tapGain.gain.value = 0.0001;
  state.tapPanner = state.audio.createStereoPanner ? state.audio.createStereoPanner() : null;
  state.tapNoise = createNoiseSource(1.9, "tap");
  state.tapNoise.connect(tapFilter);
  tapFilter.connect(state.tapGain);
  if (state.tapPanner) {
    state.tapGain.connect(state.tapPanner);
    state.tapPanner.connect(state.masterGain);
  } else {
    state.tapGain.connect(state.masterGain);
  }
  state.tapNoise.start();
}

async function unlockAudio() {
  initMovementElementAudio();
  state.movementAudio?.play().catch(() => {});
  initAudio();
  if (state.audio?.state === "suspended") await state.audio.resume();
  if (state.masterGain && state.audio) {
    state.masterGain.gain.cancelScheduledValues(state.audio.currentTime);
    state.masterGain.gain.setValueAtTime(settings.volume, state.audio.currentTime);
  }
  startMovementNoise();
  playCatchSound(860, 0.22);
}

function setVolume(value) {
  settings.volume = Number(value);
  if (state.masterGain && state.audio) {
    state.masterGain.gain.setTargetAtTime(settings.volume, state.audio.currentTime, 0.03);
  }
}

function speedLabel(value) {
  if (value < 0.9) return "很慢";
  if (value < 1.2) return "温和";
  if (value < 1.55) return "标准";
  return "快";
}

function setSpeed(value) {
  const speed = clamp(Number(value), Number(speedInput.min), Number(speedInput.max));
  settings.speed = speed;
  speedInput.value = speed.toFixed(2);
  speedValue.textContent = speedLabel(speed);
  for (const button of speedPresetButtons) {
    button.classList.toggle("is-active", Math.abs(Number(button.dataset.speed) - speed) < 0.03);
  }
}

function panForX(x) {
  return clamp((x / Math.max(1, state.width)) * 2 - 1, -0.85, 0.85);
}

function connectWithPan(sourceNode, gainNode, x) {
  if (!state.audio || !state.masterGain) return;
  const panner = state.audio.createStereoPanner ? state.audio.createStereoPanner() : null;
  if (panner) {
    panner.pan.value = panForX(x);
    sourceNode.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(state.masterGain);
  } else {
    sourceNode.connect(gainNode);
    gainNode.connect(state.masterGain);
  }
}

function playCatchSound(base = rand(680, 980), duration = 0.16, x = state.width / 2) {
  if (!state.audio || !state.masterGain) return;
  const now = state.audio.currentTime;
  const gain = state.audio.createGain();
  const osc = state.audio.createOscillator();
  const sparkle = state.audio.createOscillator();

  osc.type = "sine";
  sparkle.type = "triangle";
  osc.frequency.setValueAtTime(base, now);
  osc.frequency.exponentialRampToValueAtTime(base * 1.45, now + duration);
  sparkle.frequency.setValueAtTime(base * 2.4, now + 0.012);
  sparkle.frequency.exponentialRampToValueAtTime(base * 2.9, now + duration * 0.75);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.38, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  const panner = state.audio.createStereoPanner ? state.audio.createStereoPanner() : null;
  if (panner) panner.pan.value = panForX(x);
  osc.connect(gain);
  sparkle.connect(gain);
  if (panner) {
    gain.connect(panner);
    panner.connect(state.masterGain);
  } else {
    gain.connect(state.masterGain);
  }
  osc.start(now);
  sparkle.start(now + 0.016);
  osc.stop(now + duration + 0.03);
  sparkle.stop(now + duration + 0.03);
}

function playEventNoise(kind, x, level = 0.16, duration = 0.12) {
  if (!state.audio || !state.masterGain) return;
  const now = state.audio.currentTime;
  const length = Math.floor(state.audio.sampleRate * duration);
  const buffer = state.audio.createBuffer(1, length, state.audio.sampleRate);
  const data = buffer.getChannelData(0);
  let scrape = 0;
  let held = 0;
  for (let i = 0; i < length; i += 1) {
    if (i % 240 === 0) held = Math.random() * 2 - 1;
    const t = i / state.audio.sampleRate;
    const noise = Math.random() * 2 - 1;
    scrape = scrape * 0.82 + noise * 0.18;
    const fade = 1 - i / length;
    if (kind === "rustle") {
      data[i] = (noise * 0.5 + held * 0.28) * fade * (Math.random() > 0.72 ? 1 : 0.32);
    } else if (kind === "yarn") {
      const soft = Math.sin(t * Math.PI * 2 * 420) * 0.16 + scrape * 0.62 + noise * 0.18;
      data[i] = soft * fade * (0.38 + 0.62 * Math.max(0, Math.sin(t * Math.PI * 9)) ** 2);
    } else if (kind === "paper") {
      const crackle = Math.random() > 0.62 ? noise : held * 0.34;
      data[i] = (crackle * 0.72 + scrape * 0.28) * fade * (Math.random() > 0.48 ? 1 : 0.22);
    } else if (kind === "steps") {
      const pulse = Math.max(0, Math.sin(t * Math.PI * 18)) ** 10;
      data[i] = (noise * 0.55 + scrape * 0.45) * pulse * fade;
    } else if (kind === "scare") {
      const pulse = Math.max(0, Math.sin(t * Math.PI * 28)) ** 4;
      data[i] = (noise * 0.7 + scrape * 0.45) * Math.max(pulse, 0.22) * fade;
    } else {
      data[i] = scrape * fade;
    }
  }
  const source = state.audio.createBufferSource();
  const filter = state.audio.createBiquadFilter();
  const gain = state.audio.createGain();
  filter.type = kind === "rustle" || kind === "paper" ? "highpass" : "bandpass";
  filter.frequency.value = kind === "paper" ? rand(2100, 3600) : kind === "rustle" ? rand(1700, 2600) : kind === "yarn" ? rand(420, 980) : kind === "steps" ? rand(1500, 2600) : rand(900, 1800);
  filter.Q.value = kind === "rustle" || kind === "paper" ? 0.8 : 1.8;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(level, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.buffer = buffer;
  source.connect(filter);
  connectWithPan(filter, gain, x);
  source.start(now);
  source.stop(now + duration + 0.02);
}

function playScrapeBurst(level = 0.18, x = state.width / 2) {
  playEventNoise("scrape", x, level, 0.09);
}

function movementProfile() {
  const active = state.targets.filter((target) => !target.caught);
  if (!active.length) return { movement: 0, plastic: 0, cardboard: 0, tap: 0, rate: 1, pan: 0 };
  const total = active.reduce((sum, target) => {
    const speed = Math.hypot(target.vx, target.vy);
    const speedRatio = clamp(speed / 620, 0, 1);
    const phase = target.phase;
    const base = {
      hide: { movement: 0, plastic: 0, cardboard: 0, tap: 0, rate: 0.8 },
      reappear: { movement: 0.16, plastic: 0.12, cardboard: 0.035, tap: 0.015, rate: 0.86 },
      creep: { movement: 0.12, plastic: 0.09, cardboard: 0.025, tap: 0.012, rate: 0.78 },
      freeze: { movement: 0.006, plastic: 0.004, cardboard: 0.003, tap: 0, rate: 0.72 },
      dash: { movement: 0.44, plastic: 0.2, cardboard: 0.13, tap: 0.13, rate: 1.25 },
      zigzag: { movement: 0.38, plastic: 0.17, cardboard: 0.16, tap: 0.11, rate: 1.18 },
      escape: { movement: 0.5, plastic: 0.23, cardboard: 0.2, tap: 0.14, rate: 1.34 },
    }[phase] || { movement: 0.2, plastic: 0.12, cardboard: 0.08, tap: 0.04, rate: 1 };
    return {
      movement: sum.movement + (base.movement + state.adaptive.soundCue * 0.12) * (0.72 + speedRatio * 0.46) * target.moveBlend,
      plastic: sum.plastic + (base.plastic + state.adaptive.soundCue * 0.2) * (0.72 + speedRatio * 0.48),
      cardboard: sum.cardboard + (base.cardboard + state.adaptive.soundCue * 0.1) * (0.7 + speedRatio * 0.58),
      tap: sum.tap + (base.tap + state.adaptive.noTouchAssist * 0.06) * (0.55 + speedRatio * 0.75),
      rate: sum.rate + base.rate,
      pan: sum.pan + panForX(target.x) * clamp(base.movement + speedRatio, 0.12, 1),
      panWeight: sum.panWeight + clamp(base.movement + speedRatio, 0.12, 1),
    };
  }, { movement: 0, plastic: 0, cardboard: 0, tap: 0, rate: 0, pan: 0, panWeight: 0 });
  const divisor = active.length;
  return {
    movement: clamp(total.movement / divisor, 0, 1),
    plastic: clamp(total.plastic / divisor, 0, 1),
    cardboard: clamp(total.cardboard / divisor, 0, 1),
    tap: clamp(total.tap / divisor, 0, 1),
    rate: clamp(total.rate / divisor, 0.7, 1.45),
    pan: clamp(total.pan / Math.max(0.001, total.panWeight), -0.85, 0.85),
  };
}

function updateMovementSound(profile) {
  const movement = state.running && settings.volume > 0 ? clamp(profile.movement, 0, 1) : 0;
  const plastic = state.running && settings.volume > 0 ? clamp(profile.plastic, 0, 1) : 0;
  const cardboard = state.running && settings.volume > 0 ? clamp(profile.cardboard, 0, 1) : 0;
  const tap = state.running && settings.volume > 0 ? clamp(profile.tap, 0, 1) : 0;
  const pan = profile.pan || 0;
  if (state.movementAudio) {
    state.movementAudio.volume = movement > 0.025 ? clamp(settings.volume * (0.28 + movement * 0.56), 0, 0.88) : 0;
    state.movementAudio.playbackRate = profile.rate || 1;
    if (movement > 0.025 && state.movementAudio.paused) {
      state.movementAudio.play().catch(() => {});
    }
  }
  if (!state.audio || !state.plasticGain || !state.cardboardGain || !state.tapGain) return;
  const now = state.audio.currentTime;
  if (state.plasticPanner) state.plasticPanner.pan.setTargetAtTime(pan, now, 0.06);
  if (state.cardboardPanner) state.cardboardPanner.pan.setTargetAtTime(pan, now, 0.06);
  if (state.tapPanner) state.tapPanner.pan.setTargetAtTime(pan, now, 0.04);
  state.plasticGain.gain.setTargetAtTime(plastic > 0.02 ? 0.018 + plastic * 0.22 : 0.0001, now, 0.04);
  state.cardboardGain.gain.setTargetAtTime(cardboard > 0.02 ? 0.012 + cardboard * 0.18 : 0.0001, now, 0.05);
  state.tapGain.gain.setTargetAtTime(tap > 0.02 ? 0.01 + tap * 0.18 : 0.0001, now, 0.03);
}

function addRipple(x, y, color) {
  state.ripples.push({ x, y, color, age: 0, ttl: 0.6 });
  for (let i = 0; i < 8; i += 1) {
    state.sparkleDust.push({
      x,
      y,
      vx: rand(-110, 110),
      vy: rand(-110, 110),
      age: 0,
      ttl: rand(0.35, 0.7),
      color: choose(["#fff4a8", "#9fe7ff", "#ffc4da"]),
    });
  }
}

function addPaperBurst(x, y) {
  const colors = activeTheme().paper;
  for (let i = 0; i < 22; i += 1) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(70, 260);
    state.paperBits.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spin: rand(-7, 7),
      angle: rand(0, Math.PI * 2),
      width: rand(8, 18),
      height: rand(5, 14),
      age: 0,
      ttl: rand(0.55, 1.15),
      color: choose(colors),
    });
  }
}

function toMouseLocal(target, x, y) {
  const angle = -(Math.atan2(target.vy, target.vx) || 0);
  const dx = x - target.x;
  const dy = y - target.y;
  return {
    x: dx * Math.cos(angle) - dy * Math.sin(angle),
    y: dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

function ellipseHit(local, cx, cy, rx, ry) {
  const nx = (local.x - cx) / rx;
  const ny = (local.y - cy) / ry;
  return nx * nx + ny * ny <= 1;
}

function bodyHit(target, x, y) {
  const r = target.radius;
  const local = toMouseLocal(target, x, y);
  return ellipseHit(local, -r * 0.1, 0, r * 0.92, r * 0.66)
    || ellipseHit(local, r * 0.52, 0, r * 0.7, r * 0.6);
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq, 0, 1);
  const px = start.x + dx * t;
  const py = start.y + dy * t;
  return Math.hypot(point.x - px, point.y - py);
}

function tailPoint(target, p) {
  const r = target.radius;
  const move = target.moveBlend;
  const tailPhase = target.tailWobble + target.tailSeed;
  const amp = r * (0.58 + 0.38 * p) * (1.08 + move * 0.35);
  const tailScale = target.colors.kind === "yarn" ? 0.72 : 1;
  return {
    x: -r * (0.72 + TAIL_BODY_MULTIPLIER * tailScale * p),
    y: Math.sin(tailPhase + p * 8.4 + Math.sin(tailPhase * 0.47 + p * 3.5) * 0.95) * amp,
  };
}

function tailHit(target, x, y) {
  if (target.colors.kind === "paper") return false;
  const local = toMouseLocal(target, x, y);
  let previous = { x: -target.radius * 0.72, y: target.radius * 0.05 };
  const threshold = Math.max(24, target.radius * 0.26);
  for (let i = 1; i <= 10; i += 1) {
    const next = tailPoint(target, i / 10);
    if (pointToSegmentDistance(local, previous, next) <= threshold) return true;
    previous = next;
  }
  return false;
}

function catchTarget(target, x, y) {
  if (target.caught) return;
  const now = performance.now();
  const adaptive = state.adaptive;
  adaptive.hitStreak = now - adaptive.lastCatchAt <= FAST_HIT_WINDOW_MS ? adaptive.hitStreak + 1 : 1;
  adaptive.lastCatchAt = now;
  adaptive.lastPointerAt = now;
  adaptive.noTouchAssist *= 0.35;
  adaptive.watchAssist *= 0.25;
  adaptive.challenge = clamp(adaptive.challenge + (adaptive.hitStreak >= 2 ? 0.18 : 0.06), 0, 1);
  target.caught = true;
  target.respawnAt = now + rand(420, 900);
  addRipple(x, y, target.colors.ear);
  addPaperBurst(x, y);
  playEventNoise(activeTheme().sound.catch, x, 0.24, 0.18);
  playCatchSound(rand(720, 1080), rand(0.1, 0.16), x);
}

function scareTargetFromTail(target, x, y) {
  const now = performance.now();
  if (now < target.scaredUntil) return;
  target.scaredUntil = now + 720;
  target.caught = false;
  target.phase = "escape";
  target.previousPhase = "tail-hit";
  target.routeStartX = target.x;
  target.routeStartY = target.y;
  const destination = farPoint({ x: target.x, y: target.y }, target.radius, true);
  target.destX = destination.x;
  target.destY = destination.y;
  const distance = Math.hypot(destination.x - target.x, destination.y - target.y);
  const speed = rand(620, 860) * adaptiveSpeedForPhase("escape");
  target.routeElapsed = 0;
  target.routeDuration = routeDurationForDistance(distance, speed);
  target.routeCurve = rand(-1.8, 1.8) * (1 + state.adaptive.challenge * 0.5);
  target.moveBlend = 1;
  target.visibility = 1;
  target.zigzagSeed = rand(0, Math.PI * 2);
  target.phaseUntil = now + target.routeDuration * 1000;
  addRipple(x, y, target.colors.tail);
  playEventNoise(activeTheme().sound.scare, x, 0.26, 0.18);
  playScrapeBurst(0.22, x);
}

function handlePointer(event) {
  event.preventDefault();
  if (!state.running) return;
  const now = performance.now();
  state.adaptive.lastPointerAt = now;
  const lastHit = state.pointerCooldown.get(event.pointerId) || 0;
  if (now - lastHit < 80) return;

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  for (let i = state.targets.length - 1; i >= 0; i -= 1) {
    const target = state.targets[i];
    if (target.caught) continue;
    if (target.visibility < 0.28) continue;
    if (bodyHit(target, x, y)) {
      state.pointerCooldown.set(event.pointerId, now);
      catchTarget(target, x, y);
      return;
    }
    if (tailHit(target, x, y)) {
      state.pointerCooldown.set(event.pointerId, now);
      scareTargetFromTail(target, x, y);
      return;
    }
  }
}

function updateTarget(target, dt, now) {
  if (target.caught) {
    target.tailWobble += dt * 14.5;
    if (now >= target.respawnAt) Object.assign(target, spawnMouse());
    return;
  }

  target.tailWobble += dt * (target.phase === "freeze" ? 9.5 : target.phase === "creep" ? 11.2 : 15.8) * state.adaptive.tailBoost;
  target.stride += dt * (target.phase === "dash" || target.phase === "escape" ? 19 : target.phase === "zigzag" ? 16 : target.phase === "creep" ? 7.2 : 3.8);
  target.blink += dt;

  if (now >= target.phaseUntil) {
    chooseNextPhase(target, now);
  }

  const moving = MOVING_PHASES.has(target.phase);
  const targetBlend = moving ? (target.phase === "creep" || target.phase === "reappear" ? 0.62 : 1) : 0.04;
  target.moveBlend += (targetBlend - target.moveBlend) * Math.min(1, dt * (moving ? 6.8 : 8.5));

  if (moving) {
    target.routeElapsed += dt * settings.speed * state.adaptive.speedScale;
    const progress = clamp(target.routeElapsed / target.routeDuration, 0, 1);
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - ((-2 * progress + 2) ** 2) / 2;
    const sx = target.routeStartX;
    const sy = target.routeStartY;
    const dx = target.destX - sx;
    const dy = target.destY - sy;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / distance;
    const ny = dx / distance;
    const curveBase = Math.sin(progress * Math.PI) * target.routeCurve * Math.min(230, distance * 0.3);
    const zigzag = target.phase === "zigzag"
      ? Math.sin(progress * Math.PI * (7.5 + state.adaptive.challenge * 2.2) + target.zigzagSeed) * Math.sin(progress * Math.PI) * Math.min(150 + state.adaptive.challenge * 80, distance * 0.22)
      : 0;
    const curve = curveBase + zigzag;
    const oldX = target.x;
    const oldY = target.y;
    target.x = sx + dx * eased + nx * curve;
    target.y = sy + dy * eased + ny * curve;
    target.vx = (target.x - oldX) / Math.max(dt, 0.001);
    target.vy = (target.y - oldY) / Math.max(dt, 0.001);
    if (Math.hypot(target.vx, target.vy) > 80) {
      target.trail.unshift({ x: oldX, y: oldY, age: 0, size: target.radius * rand(0.18, 0.32) });
      target.trail.length = Math.min(target.trail.length, target.phase === "creep" ? 4 : 9);
    }
    if (progress >= 1) chooseNextPhase(target, now);
  } else {
    target.vx *= 0.84;
    target.vy *= 0.84;
  }

  for (const mark of target.trail) mark.age += dt;
  target.trail = target.trail.filter((mark) => mark.age < 0.45);
  target.visibility += ((target.phase === "hide" ? 0 : 1) - target.visibility) * Math.min(1, dt * 8);

  const exitMargin = target.radius * 4.8;
  if (
    target.x < -exitMargin ||
    target.x > state.width + exitMargin ||
    target.y < -exitMargin ||
    target.y > state.height + exitMargin
  ) {
    respawnFromEdge(target, now);
  }
}

function updateEffects(dt) {
  for (const ripple of state.ripples) ripple.age += dt;
  state.ripples = state.ripples.filter((ripple) => ripple.age < ripple.ttl);

  for (const dot of state.sparkleDust) {
    dot.age += dt;
    dot.x += dot.vx * dt;
    dot.y += dot.vy * dt;
    dot.vx *= 0.94;
    dot.vy *= 0.94;
  }
  state.sparkleDust = state.sparkleDust.filter((dot) => dot.age < dot.ttl);

  for (const bit of state.paperBits) {
    bit.age += dt;
    bit.x += bit.vx * dt;
    bit.y += bit.vy * dt;
    bit.vy += 210 * dt;
    bit.vx *= 0.985;
    bit.vy *= 0.985;
    bit.angle += bit.spin * dt;
  }
  state.paperBits = state.paperBits.filter((bit) => bit.age < bit.ttl);
}

function drawBackground(time) {
  const theme = activeTheme();
  const gradient = ctx.createLinearGradient(0, 0, state.width, state.height);
  gradient.addColorStop(0, theme.bg[0]);
  gradient.addColorStop(0.5, theme.bg[1]);
  gradient.addColorStop(1, theme.bg[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.save();
  ctx.globalAlpha = 0.15;
  for (let i = 0; i < 14; i += 1) {
    const x = ((i * 173 + time * (5 + i * 0.25)) % (state.width + 180)) - 90;
    const y = 42 + ((i * 83) % Math.max(120, state.height - 84));
    ctx.fillStyle = theme.accents[i % theme.accents.length];
    ctx.beginPath();
    ctx.ellipse(x, y, 14 + (i % 5) * 6, 7 + (i % 4) * 3, i * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  drawHideouts(time);
}

function drawHideouts(time) {
  ctx.save();
  for (const [index, hole] of state.hideouts.entries()) {
    const pulse = 0.92 + Math.sin(time * 1.2 + index) * 0.04;
    ctx.translate(hole.x, hole.y);
    ctx.rotate(hole.angle);
    ctx.fillStyle = "rgba(181, 217, 209, 0.22)";
    ctx.beginPath();
    ctx.ellipse(0, 0, hole.rx * pulse, hole.ry * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(70, 126, 139, 0.1)";
    ctx.beginPath();
    ctx.ellipse(0, 0, hole.rx * 0.62 * pulse, hole.ry * 0.58 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }
  ctx.restore();
}

function drawMouse(target) {
  if (target.colors.kind === "yarn") {
    drawYarnBall(target);
    return;
  }
  if (target.colors.kind === "paper") {
    drawPaperBall(target);
    return;
  }
  if (target.visibility <= 0.03) return;
  const angle = Math.atan2(target.vy, target.vx) || 0;
  const r = target.radius;
  const move = target.moveBlend;
  const stride = Math.sin(target.stride);
  const tailPhase = target.tailWobble + target.tailSeed;
  const eyeOpen = (target.blink % 4.2) > 0.16 ? 1 : 0.42;

  drawTrail(target);

  ctx.save();
  ctx.translate(target.x, target.y);
  ctx.rotate(angle);
  ctx.globalAlpha = clamp(target.visibility, 0, 1);

  ctx.shadowColor = "rgba(52, 86, 94, 0.16)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 10;

  ctx.strokeStyle = target.colors.tail;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.78)";
  ctx.lineWidth = Math.max(10, r * 0.19);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.72, r * 0.05);
  for (let i = 1; i <= 8; i += 1) {
    const p = i / 8;
    const x = -r * (0.72 + TAIL_BODY_MULTIPLIER * p);
    const amp = r * (0.58 + 0.38 * p) * (1.08 + move * 0.35);
    const y = Math.sin(tailPhase + p * 8.4 + Math.sin(tailPhase * 0.47 + p * 3.5) * 0.95) * amp;
    const prevP = (i - 0.5) / 8;
    const cx = -r * (0.72 + TAIL_BODY_MULTIPLIER * prevP);
    const cy = Math.sin(tailPhase + prevP * 8.4 + Math.sin(tailPhase * 0.47 + prevP * 3.5) * 0.95) * amp * 0.9;
    ctx.quadraticCurveTo(cx, cy, x, y);
  }
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = target.colors.tail;
  ctx.lineWidth = Math.max(7, r * 0.13);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.72, r * 0.05);
  const segments = 8;
  for (let i = 1; i <= segments; i += 1) {
    const p = i / segments;
    const x = -r * (0.72 + TAIL_BODY_MULTIPLIER * p);
    const amp = r * (0.58 + 0.38 * p) * (1.08 + move * 0.35);
    const y = Math.sin(tailPhase + p * 8.4 + Math.sin(tailPhase * 0.47 + p * 3.5) * 0.95) * amp;
    const prevP = (i - 0.5) / segments;
    const cx = -r * (0.72 + TAIL_BODY_MULTIPLIER * prevP);
    const cy = Math.sin(tailPhase + prevP * 8.4 + Math.sin(tailPhase * 0.47 + prevP * 3.5) * 0.95) * amp * 0.9;
    ctx.quadraticCurveTo(cx, cy, x, y);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.84)";
  ctx.lineWidth = Math.max(5, r * 0.08);
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, 0, r * 0.89, r * 0.61, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(r * 0.52, 0, r * 0.65, r * 0.55, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = target.colors.bodyDeep;
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, r * 0.12, r * 0.86, r * 0.58, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = target.colors.body;
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, 0, r * 0.86, r * 0.58 + Math.abs(stride) * r * 0.025, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.fillStyle = target.colors.belly;
  ctx.beginPath();
  ctx.ellipse(-r * 0.16, r * 0.08, r * 0.45, r * 0.32, 0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = target.colors.body;
  ctx.beginPath();
  ctx.ellipse(r * 0.52, 0, r * 0.62, r * 0.52, 0, 0, Math.PI * 2);
  ctx.fill();

  for (const side of [-1, 1]) {
    ctx.fillStyle = target.colors.bodyDeep;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(r * 0.35, side * r * 0.41, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = target.colors.body;
    ctx.beginPath();
    ctx.arc(r * 0.38, side * r * 0.39, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = target.colors.ear;
    ctx.beginPath();
    ctx.arc(r * 0.4, side * r * 0.39, r * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#fffdf8";
  ctx.beginPath();
  ctx.ellipse(r * 0.72, -r * 0.2, r * 0.31, r * 0.31 * eyeOpen, 0, 0, Math.PI * 2);
  ctx.ellipse(r * 0.72, r * 0.2, r * 0.31, r * 0.31 * eyeOpen, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(r * 0.84, -r * 0.2, r * 0.12 * eyeOpen + r * 0.02, 0, Math.PI * 2);
  ctx.arc(r * 0.84, r * 0.2, r * 0.12 * eyeOpen + r * 0.02, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 0.86;
  ctx.beginPath();
  ctx.arc(r * 0.9, -r * 0.27, r * 0.064, 0, Math.PI * 2);
  ctx.arc(r * 0.9, r * 0.13, r * 0.064, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = target.colors.cheek;
  ctx.globalAlpha = 0.62;
  ctx.beginPath();
  ctx.arc(r * 0.56, -r * 0.31, r * 0.095, 0, Math.PI * 2);
  ctx.arc(r * 0.56, r * 0.31, r * 0.095, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = target.colors.nose;
  ctx.beginPath();
  ctx.ellipse(r * 1.08, 0, r * 0.082, r * 0.063, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(49, 79, 89, 0.22)";
  ctx.lineWidth = Math.max(3, r * 0.045);
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.16 + stride * r * 0.025, side * r * 0.45);
    ctx.lineTo(-r * 0.34 - stride * r * 0.035, side * r * 0.64);
    ctx.stroke();
  }

  ctx.restore();
}

function drawStringTail(target, color) {
  const angle = Math.atan2(target.vy, target.vx) || 0;
  const r = target.radius;
  const move = target.moveBlend;
  const tailPhase = target.tailWobble + target.tailSeed;
  ctx.save();
  ctx.translate(target.x, target.y);
  ctx.rotate(angle);
  ctx.globalAlpha = clamp(target.visibility, 0, 1);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.74)";
  ctx.lineWidth = Math.max(9, r * 0.16);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.58, r * 0.05);
  for (let i = 1; i <= 7; i += 1) {
    const p = i / 7;
    const x = -r * (0.58 + TAIL_BODY_MULTIPLIER * 0.72 * p);
    const y = Math.sin(tailPhase + p * 7.8) * r * (0.46 + p * 0.3) * (1 + move * 0.24);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(5, r * 0.1);
  ctx.beginPath();
  ctx.moveTo(-r * 0.58, r * 0.05);
  for (let i = 1; i <= 7; i += 1) {
    const p = i / 7;
    const x = -r * (0.58 + TAIL_BODY_MULTIPLIER * 0.72 * p);
    const y = Math.sin(tailPhase + p * 7.8) * r * (0.46 + p * 0.3) * (1 + move * 0.24);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawYarnBall(target) {
  if (target.visibility <= 0.03) return;
  drawTrail(target);
  drawStringTail(target, target.colors.tail);
  const angle = Math.atan2(target.vy, target.vx) || 0;
  const r = target.radius;
  const spin = target.stride * 0.16;
  ctx.save();
  ctx.translate(target.x, target.y);
  ctx.rotate(angle + spin);
  ctx.globalAlpha = clamp(target.visibility, 0, 1);
  ctx.shadowColor = "rgba(28, 103, 153, 0.18)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = target.colors.body;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
  ctx.lineWidth = Math.max(5, r * 0.08);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = target.colors.bodyDeep;
  ctx.lineWidth = Math.max(3, r * 0.045);
  for (let i = -2; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.ellipse(0, i * r * 0.13, r * 0.7, r * 0.22, i * 0.34, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(223, 247, 255, 0.74)";
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.22, r * 0.74, 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#fffdf8";
  ctx.globalAlpha *= 0.8;
  ctx.beginPath();
  ctx.arc(-r * 0.22, -r * 0.28, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPaperBall(target) {
  if (target.visibility <= 0.03) return;
  drawTrail(target);
  const angle = Math.atan2(target.vy, target.vx) || 0;
  const r = target.radius;
  ctx.save();
  ctx.translate(target.x, target.y);
  ctx.rotate(angle + Math.sin(target.stride) * 0.12);
  ctx.globalAlpha = clamp(target.visibility, 0, 1);
  ctx.shadowColor = "rgba(77, 123, 92, 0.16)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = target.colors.body;
  ctx.beginPath();
  ctx.moveTo(-r * 0.62, -r * 0.28);
  ctx.quadraticCurveTo(-r * 0.28, -r * 0.72, r * 0.32, -r * 0.58);
  ctx.quadraticCurveTo(r * 0.78, -r * 0.32, r * 0.62, r * 0.22);
  ctx.quadraticCurveTo(r * 0.38, r * 0.72, -r * 0.2, r * 0.64);
  ctx.quadraticCurveTo(-r * 0.72, r * 0.38, -r * 0.62, -r * 0.28);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
  ctx.lineWidth = Math.max(5, r * 0.08);
  ctx.stroke();
  ctx.strokeStyle = target.colors.bodyDeep;
  ctx.lineWidth = Math.max(3, r * 0.045);
  ctx.globalAlpha *= 0.72;
  for (let i = 0; i < 7; i += 1) {
    const seed = target.paperSeed + i * 17.37;
    const x1 = Math.sin(seed) * r * 0.42;
    const y1 = Math.cos(seed * 1.31) * r * 0.38;
    const cx = Math.sin(seed * 1.77) * r * 0.44;
    const cy = Math.cos(seed * 2.03) * r * 0.42;
    const x2 = Math.sin(seed * 2.41) * r * 0.42;
    const y2 = Math.cos(seed * 2.73) * r * 0.38;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTrail(target) {
  if (!target.trail.length || target.phase === "creep") return;
  ctx.save();
  for (const mark of target.trail) {
    const progress = mark.age / 0.45;
    ctx.globalAlpha = (1 - progress) * 0.16 * target.visibility;
    ctx.fillStyle = target.colors.bodyDeep;
    ctx.beginPath();
    ctx.ellipse(mark.x, mark.y, mark.size * 1.4, mark.size * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEffects() {
  for (const ripple of state.ripples) {
    const progress = ripple.age / ripple.ttl;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = ripple.color;
    ctx.lineWidth = 5 * (1 - progress) + 1;
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, 18 + progress * 82, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  for (const dot of state.sparkleDust) {
    const progress = dot.age / dot.ttl;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = dot.color;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, 3 + (1 - progress) * 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const bit of state.paperBits) {
    const progress = bit.age / bit.ttl;
    ctx.save();
    ctx.translate(bit.x, bit.y);
    ctx.rotate(bit.angle);
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = bit.color;
    ctx.strokeStyle = "rgba(81, 112, 111, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(-bit.width / 2, -bit.height / 2, bit.width, bit.height);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function frame(time) {
  const dt = Math.min(0.04, (time - state.lastTime) / 1000 || 0);
  state.lastTime = time;

  drawBackground(time / 1000);
  updateAdaptive(time);
  for (const target of state.targets) updateTarget(target, dt, time);
  updateEffects(dt);
  for (const target of state.targets) {
    if (!target.caught) drawMouse(target);
  }
  drawEffects();
  updateMovementSound(movementProfile());

  requestAnimationFrame(frame);
}

async function startGame() {
  if (state.running || state.starting) return;
  state.starting = true;
  state.running = true;
  state.userStarted = true;
  resetAdaptive(performance.now());
  localStorage.setItem("catMouseStarted", "1");
  startButton.classList.add("is-hidden");
  startButton.querySelector("span").textContent = "继续";
  state.starting = false;
  unlockAudio().catch(() => {});
  enterCatMode();
}

async function enterCatMode() {
  try {
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
  } catch {}

  try {
    if ("wakeLock" in navigator && !state.wakeLock) {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        state.wakeLock = null;
      });
    }
  } catch {}

  try {
    if (screen.orientation?.lock) await screen.orientation.lock("landscape");
  } catch {}
}

function pauseAudioForPageHide() {
  if (state.movementAudio) {
    state.movementAudio.pause();
    state.movementAudio.volume = 0;
  }
  if (state.audio?.state === "running") state.audio.suspend();
}

async function resumeAfterReturn() {
  if (!state.userStarted && localStorage.getItem("catMouseStarted") !== "1") return;
  state.running = true;
  startButton.classList.add("is-hidden");
  await enterCatMode();
  try {
    if (state.audio?.state === "suspended") await state.audio.resume();
    if (state.movementAudio) await state.movementAudio.play();
  } catch {
    startButton.classList.remove("is-hidden");
  }
}

function stopAudio() {
  state.running = false;
  if (state.masterGain && state.audio) {
    state.masterGain.gain.cancelScheduledValues(state.audio.currentTime);
    state.masterGain.gain.setValueAtTime(0.0001, state.audio.currentTime);
  }
  updateMovementSound({ movement: 0, plastic: 0, cardboard: 0, tap: 0, rate: 1 });
  if (state.audio?.state === "running") state.audio.suspend();
  if (state.movementAudio) {
    state.movementAudio.pause();
    state.movementAudio.currentTime = 0;
    state.movementAudio.volume = 0;
  }
  if (state.wakeLock) {
    state.wakeLock.release();
    state.wakeLock = null;
  }
  state.starting = false;
  startButton.classList.remove("is-hidden");
  startButton.querySelector("span").textContent = "继续";
}

window.__catMouseStopAudio = stopAudio;
window.__catMouseAdaptive = getAdaptiveDebugState;

function openSettings() {
  if (settingsPanel.open) return;
  if (settingsPanel.showModal) settingsPanel.showModal();
  else settingsPanel.setAttribute("open", "");
}

function wireSettings() {
  volumeInput.addEventListener("input", () => setVolume(volumeInput.value));
  speedInput.addEventListener("input", () => setSpeed(speedInput.value));
  for (const button of speedPresetButtons) {
    button.addEventListener("click", () => {
      setSpeed(button.dataset.speed);
    });
  }
  setSpeed(speedInput.value);
}

function wireThemeControls() {
  themeButton.addEventListener("click", (event) => {
    event.preventDefault();
    const nextHidden = !themePanel.hidden ? true : false;
    themePanel.hidden = nextHidden;
    themeButton.setAttribute("aria-expanded", String(!nextHidden));
  });
  for (const button of themeOptionButtons) {
    button.addEventListener("click", () => {
      setTheme(button.dataset.theme);
    });
  }
  document.addEventListener("pointerdown", (event) => {
    if (themePanel.hidden) return;
    if (themePanel.contains(event.target) || themeButton.contains(event.target)) return;
    themePanel.hidden = true;
    themeButton.setAttribute("aria-expanded", "false");
  });
  setTheme(state.themeId);
}

function wireHotspot() {
  let pressTimer = 0;
  const clearPress = () => {
    window.clearTimeout(pressTimer);
    pressTimer = 0;
  };

  hotspot.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    clearPress();
    pressTimer = window.setTimeout(openSettings, 2000);
  });
  hotspot.addEventListener("pointerup", clearPress);
  hotspot.addEventListener("pointercancel", clearPress);
  hotspot.addEventListener("pointerleave", clearPress);
}

function preventGestures() {
  document.addEventListener("gesturestart", (event) => event.preventDefault());
  document.addEventListener("gesturechange", (event) => event.preventDefault());
  document.addEventListener("gestureend", (event) => event.preventDefault());
  document.addEventListener("contextmenu", (event) => event.preventDefault());
}

resize();
syncMice();
wireSettings();
wireThemeControls();
wireHotspot();
preventGestures();
window.addEventListener("resize", resize);
window.addEventListener("pagehide", pauseAudioForPageHide);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") pauseAudioForPageHide();
  if (document.visibilityState === "visible") resumeAfterReturn();
});
canvas.addEventListener("pointerdown", handlePointer, { passive: false });
canvas.addEventListener("pointermove", handlePointer, { passive: false });
startButton.addEventListener("click", startGame);
startButton.addEventListener("pointerup", startGame, { passive: false });
startButton.addEventListener("touchend", (event) => {
  event.preventDefault();
  startGame();
}, { passive: false });
requestAnimationFrame(frame);
