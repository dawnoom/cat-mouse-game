const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d", { alpha: false });
const startButton = document.querySelector("#startButton");
const hotspot = document.querySelector("#settingsHotspot");
const settingsPanel = document.querySelector("#settingsPanel");
const volumeInput = document.querySelector("#volume");
const speedInput = document.querySelector("#speed");

const settings = {
  volume: 0.62,
  speed: 1.35,
};

const MOUSE_COUNT = 1;
const BODY_SCALE = 1.72;
const TAIL_BODY_MULTIPLIER = 4.6;
const MOVING_PHASES = new Set(["reappear", "creep", "dash", "zigzag", "escape"]);
const BLUE_MOUSE = {
  body: "#66bff2",
  bodyDeep: "#3497d6",
  belly: "#f7fcff",
  ear: "#ffc2d8",
  tail: "#2e9eda",
  cheek: "#ff98bd",
  nose: "#ef8a9a",
};
const INK = "#314f59";

const state = {
  dpr: 1,
  width: 1,
  height: 1,
  targets: [],
  ripples: [],
  sparkleDust: [],
  lastTime: performance.now(),
  running: false,
  starting: false,
  userStarted: false,
  audio: null,
  masterGain: null,
  plasticGain: null,
  cardboardGain: null,
  tapGain: null,
  plasticNoise: null,
  cardboardNoise: null,
  tapNoise: null,
  movementAudio: null,
  wakeLock: null,
  pointerCooldown: new Map(),
  hideouts: [],
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

function spawnMouse(overrides = {}) {
  const radius = rand(36, 43) * BODY_SCALE;
  const start = overrides.x === undefined ? edgePoint(radius, true) : { x: overrides.x, y: overrides.y };
  const mouse = {
    id: uuid(),
    x: start.x,
    y: start.y,
    radius,
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
    speedBase: 240,
    caught: false,
    respawnAt: 0,
    colors: BLUE_MOUSE,
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
  if (phase === "reappear") return choose(["creep", "creep", "freeze"]);
  if (phase === "creep") return choose(["freeze", "dash", "zigzag"]);
  if (phase === "freeze") return choose(["dash", "dash", "zigzag", "creep"]);
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
    target.phaseUntil = now + rand(260, 1200);
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
    speed = rand(180, 260);
    target.visibility = 0.74;
  } else if (next === "creep") {
    destination = nearPoint(from, target.radius);
    speed = rand(95, 165);
    target.visibility = 1;
  } else if (next === "dash") {
    destination = farPoint(from, target.radius, false);
    speed = rand(420, 640);
    target.visibility = 1;
  } else if (next === "zigzag") {
    destination = farPoint(from, target.radius, Math.random() < 0.18);
    speed = rand(340, 520);
    target.visibility = 1;
  } else {
    destination = farPoint(from, target.radius, true);
    speed = rand(520, 720);
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
  target.routeCurve = next === "creep" ? rand(-0.45, 0.45) : Math.random() < 0.38 ? 0 : rand(-1.35, 1.35);
  target.speedBase = speed;
  target.phaseUntil = now + target.routeDuration * 1000;
  target.moveBlend = Math.max(target.moveBlend, next === "creep" ? 0.35 : 0.72);
  if (next === "dash" || next === "zigzag" || next === "escape") {
    playScrapeBurst(next === "escape" ? 0.24 : 0.17);
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
  state.plasticNoise = createNoiseSource(2.6, "plastic");
  state.plasticNoise.connect(plasticFilter);
  plasticFilter.connect(state.plasticGain);
  state.plasticGain.connect(state.masterGain);
  state.plasticNoise.start();

  const cardboardFilter = state.audio.createBiquadFilter();
  cardboardFilter.type = "bandpass";
  cardboardFilter.frequency.value = 720;
  cardboardFilter.Q.value = 1.1;
  state.cardboardGain = state.audio.createGain();
  state.cardboardGain.gain.value = 0.0001;
  state.cardboardNoise = createNoiseSource(3.1, "cardboard");
  state.cardboardNoise.connect(cardboardFilter);
  cardboardFilter.connect(state.cardboardGain);
  state.cardboardGain.connect(state.masterGain);
  state.cardboardNoise.start();

  const tapFilter = state.audio.createBiquadFilter();
  tapFilter.type = "bandpass";
  tapFilter.frequency.value = 2400;
  tapFilter.Q.value = 2.5;
  state.tapGain = state.audio.createGain();
  state.tapGain.gain.value = 0.0001;
  state.tapNoise = createNoiseSource(1.9, "tap");
  state.tapNoise.connect(tapFilter);
  tapFilter.connect(state.tapGain);
  state.tapGain.connect(state.masterGain);
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

function playCatchSound(base = rand(680, 980), duration = 0.16) {
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

  osc.connect(gain);
  sparkle.connect(gain);
  gain.connect(state.masterGain);
  osc.start(now);
  sparkle.start(now + 0.016);
  osc.stop(now + duration + 0.03);
  sparkle.stop(now + duration + 0.03);
}

function playScrapeBurst(level = 0.18) {
  if (!state.audio || !state.masterGain) return;
  const now = state.audio.currentTime;
  const length = Math.floor(state.audio.sampleRate * 0.09);
  const buffer = state.audio.createBuffer(1, length, state.audio.sampleRate);
  const data = buffer.getChannelData(0);
  let scrape = 0;
  for (let i = 0; i < length; i += 1) {
    scrape = scrape * 0.82 + (Math.random() * 2 - 1) * 0.18;
    const fade = 1 - i / length;
    data[i] = scrape * fade;
  }
  const source = state.audio.createBufferSource();
  const filter = state.audio.createBiquadFilter();
  const gain = state.audio.createGain();
  filter.type = "bandpass";
  filter.frequency.value = rand(900, 1700);
  filter.Q.value = 1.8;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(level, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  source.buffer = buffer;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(state.masterGain);
  source.start(now);
  source.stop(now + 0.1);
}

function movementProfile() {
  const active = state.targets.filter((target) => !target.caught);
  if (!active.length) return { movement: 0, plastic: 0, cardboard: 0, tap: 0, rate: 1 };
  const total = active.reduce((sum, target) => {
    const speed = Math.hypot(target.vx, target.vy);
    const speedRatio = clamp(speed / 620, 0, 1);
    const phase = target.phase;
    const base = {
      hide: { movement: 0, plastic: 0, cardboard: 0, tap: 0, rate: 0.8 },
      reappear: { movement: 0.28, plastic: 0.24, cardboard: 0.08, tap: 0.03, rate: 0.86 },
      creep: { movement: 0.22, plastic: 0.2, cardboard: 0.07, tap: 0.04, rate: 0.78 },
      freeze: { movement: 0.04, plastic: 0.035, cardboard: 0.02, tap: 0, rate: 0.72 },
      dash: { movement: 0.86, plastic: 0.42, cardboard: 0.28, tap: 0.28, rate: 1.25 },
      zigzag: { movement: 0.78, plastic: 0.36, cardboard: 0.34, tap: 0.24, rate: 1.18 },
      escape: { movement: 1, plastic: 0.48, cardboard: 0.42, tap: 0.32, rate: 1.34 },
    }[phase] || { movement: 0.2, plastic: 0.12, cardboard: 0.08, tap: 0.04, rate: 1 };
    return {
      movement: sum.movement + base.movement * (0.72 + speedRatio * 0.46) * target.moveBlend,
      plastic: sum.plastic + base.plastic * (0.72 + speedRatio * 0.48),
      cardboard: sum.cardboard + base.cardboard * (0.7 + speedRatio * 0.58),
      tap: sum.tap + base.tap * (0.55 + speedRatio * 0.75),
      rate: sum.rate + base.rate,
    };
  }, { movement: 0, plastic: 0, cardboard: 0, tap: 0, rate: 0 });
  const divisor = active.length;
  return {
    movement: clamp(total.movement / divisor, 0, 1),
    plastic: clamp(total.plastic / divisor, 0, 1),
    cardboard: clamp(total.cardboard / divisor, 0, 1),
    tap: clamp(total.tap / divisor, 0, 1),
    rate: clamp(total.rate / divisor, 0.7, 1.45),
  };
}

function updateMovementSound(profile) {
  const movement = state.running && settings.volume > 0 ? clamp(profile.movement, 0, 1) : 0;
  const plastic = state.running && settings.volume > 0 ? clamp(profile.plastic, 0, 1) : 0;
  const cardboard = state.running && settings.volume > 0 ? clamp(profile.cardboard, 0, 1) : 0;
  const tap = state.running && settings.volume > 0 ? clamp(profile.tap, 0, 1) : 0;
  if (state.movementAudio) {
    state.movementAudio.volume = movement > 0.025 ? clamp(settings.volume * (0.28 + movement * 0.56), 0, 0.88) : 0;
    state.movementAudio.playbackRate = profile.rate || 1;
    if (movement > 0.025 && state.movementAudio.paused) {
      state.movementAudio.play().catch(() => {});
    }
  }
  if (!state.audio || !state.plasticGain || !state.cardboardGain || !state.tapGain) return;
  const now = state.audio.currentTime;
  state.plasticGain.gain.setTargetAtTime(plastic > 0.02 ? 0.035 + plastic * 0.42 : 0.0001, now, 0.035);
  state.cardboardGain.gain.setTargetAtTime(cardboard > 0.02 ? 0.025 + cardboard * 0.34 : 0.0001, now, 0.045);
  state.tapGain.gain.setTargetAtTime(tap > 0.02 ? 0.018 + tap * 0.32 : 0.0001, now, 0.025);
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

function catchTarget(target, x, y) {
  if (target.caught) return;
  target.caught = true;
  target.respawnAt = performance.now() + rand(420, 900);
  addRipple(x, y, target.colors.ear);
  playCatchSound(rand(720, 1080), rand(0.12, 0.2));
}

function handlePointer(event) {
  event.preventDefault();
  if (!state.running) return;
  const now = performance.now();
  const lastHit = state.pointerCooldown.get(event.pointerId) || 0;
  if (now - lastHit < 80) return;

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  for (let i = state.targets.length - 1; i >= 0; i -= 1) {
    const target = state.targets[i];
    if (target.caught) continue;
    if (target.visibility < 0.28) continue;
    if (Math.hypot(x - target.x, y - target.y) <= target.hitRadius) {
      state.pointerCooldown.set(event.pointerId, now);
      catchTarget(target, x, y);
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

  target.tailWobble += dt * (target.phase === "freeze" ? 9.5 : target.phase === "creep" ? 11.2 : 15.8);
  target.stride += dt * (target.phase === "dash" || target.phase === "escape" ? 19 : target.phase === "zigzag" ? 16 : target.phase === "creep" ? 7.2 : 3.8);
  target.blink += dt;

  if (now >= target.phaseUntil) {
    chooseNextPhase(target, now);
  }

  const moving = MOVING_PHASES.has(target.phase);
  const targetBlend = moving ? (target.phase === "creep" || target.phase === "reappear" ? 0.62 : 1) : 0.04;
  target.moveBlend += (targetBlend - target.moveBlend) * Math.min(1, dt * (moving ? 6.8 : 8.5));

  if (moving) {
    target.routeElapsed += dt * settings.speed;
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
      ? Math.sin(progress * Math.PI * 7.5 + target.zigzagSeed) * Math.sin(progress * Math.PI) * Math.min(150, distance * 0.2)
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
}

function drawBackground(time) {
  const gradient = ctx.createLinearGradient(0, 0, state.width, state.height);
  gradient.addColorStop(0, "#f8fff6");
  gradient.addColorStop(0.5, "#f0fbf7");
  gradient.addColorStop(1, "#fff9ef");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.save();
  ctx.globalAlpha = 0.15;
  for (let i = 0; i < 14; i += 1) {
    const x = ((i * 173 + time * (5 + i * 0.25)) % (state.width + 180)) - 90;
    const y = 42 + ((i * 83) % Math.max(120, state.height - 84));
    ctx.fillStyle = i % 3 === 0 ? "#fce7b0" : i % 3 === 1 ? "#ccefeb" : "#d9efff";
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
}

function frame(time) {
  const dt = Math.min(0.04, (time - state.lastTime) / 1000 || 0);
  state.lastTime = time;

  drawBackground(time / 1000);
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

function openSettings() {
  if (settingsPanel.open) return;
  if (settingsPanel.showModal) settingsPanel.showModal();
  else settingsPanel.setAttribute("open", "");
}

function wireSettings() {
  volumeInput.addEventListener("input", () => setVolume(volumeInput.value));
  speedInput.addEventListener("input", () => {
    settings.speed = Number(speedInput.value);
  });
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
