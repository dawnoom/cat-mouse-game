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
};

function resize() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.width = Math.max(1, window.innerWidth);
  state.height = Math.max(1, window.innerHeight);
  canvas.width = Math.floor(state.width * state.dpr);
  canvas.height = Math.floor(state.height * state.dpr);
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
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

function routeDurationForDistance(distance, speed) {
  return clamp((distance / Math.max(1, speed)) * rand(0.8, 1.12), 1.25, 4.6);
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
  const minDistance = Math.min(state.width, state.height) * rand(0.56, 0.92);
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
    phase: "dash",
    phaseUntil: performance.now() + 1000,
    routeStartX: start.x,
    routeStartY: start.y,
    destX: start.x,
    destY: start.y,
    routeElapsed: 0,
    routeDuration: 2,
    routeCurve: rand(-1, 1),
    moveBlend: 1,
    stride: rand(0, Math.PI * 2),
    tailWobble: rand(0, Math.PI * 2),
    tailSeed: rand(0, Math.PI * 2),
    blink: rand(0, 4),
    speedBase: 240,
    caught: false,
    respawnAt: 0,
    colors: BLUE_MOUSE,
  };
  chooseNextPhase(mouse, performance.now(), true);
  return mouse;
}

function syncMice() {
  while (state.targets.length < MOUSE_COUNT) state.targets.push(spawnMouse());
  while (state.targets.length > MOUSE_COUNT) state.targets.pop();
}

function chooseNextPhase(target, now, forceMove = false) {
  const next = forceMove ? "dash" : choose(["dash", "dash", "run", "run", "pause", "peek"]);
  target.phase = next;
  target.moveBlend = next === "pause" || next === "peek" ? target.moveBlend : Math.max(target.moveBlend, 0.45);

  if (next === "pause" || next === "peek") {
    target.phaseUntil = now + rand(next === "peek" ? 260 : 420, next === "peek" ? 760 : 1250);
    target.vx = 0;
    target.vy = 0;
    return;
  }

  const from = { x: target.x, y: target.y };
  const allowExit = Math.random() < 0.38;
  const destination = farPoint(from, target.radius, allowExit);
  const distance = Math.hypot(destination.x - from.x, destination.y - from.y);
  const speed = next === "dash" ? rand(310, 460) : rand(185, 285);
  target.routeStartX = from.x;
  target.routeStartY = from.y;
  target.destX = destination.x;
  target.destY = destination.y;
  target.routeElapsed = 0;
  target.routeDuration = routeDurationForDistance(distance, speed);
  target.routeCurve = Math.random() < 0.48 ? 0 : rand(-1.15, 1.15);
  target.speedBase = speed;
  target.phaseUntil = now + target.routeDuration * 1000;
}

function respawnFromEdge(target, now) {
  const replacement = spawnMouse(edgePoint(target.radius, true));
  Object.assign(target, replacement);
  chooseNextPhase(target, now, true);
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
  const elementPlay = state.movementAudio?.play().catch(() => {});
  initAudio();
  if (state.audio?.state === "suspended") await state.audio.resume();
  if (state.masterGain && state.audio) {
    state.masterGain.gain.cancelScheduledValues(state.audio.currentTime);
    state.masterGain.gain.setValueAtTime(settings.volume, state.audio.currentTime);
  }
  startMovementNoise();
  playCatchSound(860, 0.22);
  await elementPlay;
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

function movementIntensity() {
  const active = state.targets.filter((target) => !target.caught);
  if (!active.length) return 0;
  const total = active.reduce((sum, target) => {
    const speed = Math.hypot(target.vx, target.vy);
    const phaseBoost = target.phase === "dash" ? 1.18 : target.phase === "run" ? 0.92 : 0.06;
    return sum + clamp((speed / 420) * target.moveBlend * phaseBoost, 0, 1);
  }, 0);
  return total / active.length;
}

function updateMovementSound(intensity) {
  const audible = state.running && settings.volume > 0 ? clamp(intensity, 0, 1) : 0;
  if (state.movementAudio) {
    state.movementAudio.volume = audible > 0.025 ? clamp(settings.volume * (0.64 + audible * 0.56), 0, 1) : 0;
    state.movementAudio.playbackRate = 0.82 + audible * 0.42;
    if (audible > 0.025 && state.movementAudio.paused) {
      state.movementAudio.play().catch(() => {});
    }
  }
  if (!state.audio || !state.plasticGain || !state.cardboardGain || !state.tapGain) return;
  const now = state.audio.currentTime;
  state.plasticGain.gain.setTargetAtTime(audible > 0.025 ? 0.18 + audible * 0.19 : 0.0001, now, 0.035);
  state.cardboardGain.gain.setTargetAtTime(audible > 0.025 ? 0.12 + audible * 0.15 : 0.0001, now, 0.045);
  state.tapGain.gain.setTargetAtTime(audible > 0.025 ? 0.08 + audible * 0.12 : 0.0001, now, 0.028);
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
    if (Math.hypot(x - target.x, y - target.y) <= target.hitRadius) {
      state.pointerCooldown.set(event.pointerId, now);
      catchTarget(target, x, y);
      return;
    }
  }
}

function updateTarget(target, dt, now) {
  if (target.caught) {
    target.tailWobble += dt * 12.5;
    if (now >= target.respawnAt) Object.assign(target, spawnMouse());
    return;
  }

  target.tailWobble += dt * 12.5;
  target.stride += dt * (target.phase === "dash" ? 17 : target.phase === "run" ? 10.5 : 4.2);
  target.blink += dt;

  if (now >= target.phaseUntil) {
    chooseNextPhase(target, now);
  }

  const moving = target.phase === "dash" || target.phase === "run";
  const targetBlend = moving ? 1 : 0.04;
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
    const curve = Math.sin(progress * Math.PI) * target.routeCurve * Math.min(210, distance * 0.28);
    const oldX = target.x;
    const oldY = target.y;
    target.x = sx + dx * eased + nx * curve;
    target.y = sy + dy * eased + ny * curve;
    target.vx = (target.x - oldX) / Math.max(dt, 0.001);
    target.vy = (target.y - oldY) / Math.max(dt, 0.001);
    if (progress >= 1) chooseNextPhase(target, now);
  } else {
    target.vx *= 0.84;
    target.vy *= 0.84;
  }

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
  gradient.addColorStop(0, "#f7fff4");
  gradient.addColorStop(0.48, "#eefbf8");
  gradient.addColorStop(1, "#fff8ed");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.save();
  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 18; i += 1) {
    const x = ((i * 173 + time * (10 + i * 0.6)) % (state.width + 180)) - 90;
    const y = 42 + ((i * 83) % Math.max(120, state.height - 84));
    ctx.fillStyle = i % 3 === 0 ? "#fce7b0" : i % 3 === 1 ? "#ccefeb" : "#d9efff";
    ctx.beginPath();
    ctx.ellipse(x, y, 18 + (i % 5) * 7, 8 + (i % 4) * 4, i * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMouse(target) {
  const angle = Math.atan2(target.vy, target.vx) || 0;
  const r = target.radius;
  const move = target.moveBlend;
  const stride = Math.sin(target.stride);
  const tailPhase = target.tailWobble + target.tailSeed;
  const eyeOpen = (target.blink % 4.2) > 0.16 ? 1 : 0.42;

  ctx.save();
  ctx.translate(target.x, target.y);
  ctx.rotate(angle);

  ctx.shadowColor = "rgba(52, 86, 94, 0.16)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 10;

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
  updateMovementSound(movementIntensity());

  requestAnimationFrame(frame);
}

async function startGame() {
  if (state.running || state.starting) return;
  state.starting = true;
  await unlockAudio();
  await enterCatMode();
  state.running = true;
  state.userStarted = true;
  localStorage.setItem("catMouseStarted", "1");
  startButton.classList.add("is-hidden");
  startButton.querySelector("span").textContent = "继续";
  state.starting = false;
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
  updateMovementSound(0);
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
