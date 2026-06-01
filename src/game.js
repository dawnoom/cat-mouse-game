const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d", { alpha: false });
const startButton = document.querySelector("#startButton");
const hotspot = document.querySelector("#settingsHotspot");
const settingsPanel = document.querySelector("#settingsPanel");
const volumeInput = document.querySelector("#volume");
const speedInput = document.querySelector("#speed");

const settings = {
  volume: 0.48,
  speed: 0.9,
};

const BODY_SCALE = 1.5;
const TAIL_LENGTH_SCALE = 2;
const STOP_MIN_MS = 500;
const STOP_MAX_MS = 1500;

const state = {
  dpr: 1,
  width: 1,
  height: 1,
  targets: [],
  ripples: [],
  lastTime: performance.now(),
  running: false,
  starting: false,
  audio: null,
  masterGain: null,
  plasticGain: null,
  cardboardGain: null,
  plasticNoise: null,
  cardboardNoise: null,
  movementAudio: null,
  wakeLock: null,
  pointerCooldown: new Map(),
};

const mouseColors = [
  { body: "#86c9ea", belly: "#f3fbff", ear: "#f5b4cc", tail: "#5fa9d3", cheek: "#ff9fc2" },
];

const ink = "#455a56";

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

function spawnMouse(overrides = {}) {
  const radius = rand(36, 44) * BODY_SCALE;
  const margin = radius * 1.25;
  const angle = rand(0, Math.PI * 2);
  const baseSpeed = rand(86, 126);
  const now = performance.now();
  let x = overrides.x;
  let y = overrides.y;

  if (x === undefined || y === undefined) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const candidateX = rand(margin, Math.max(margin, state.width - margin));
      const candidateY = rand(margin, Math.max(margin, state.height - margin));
      const clear = state.targets.every((target) => Math.hypot(candidateX - target.x, candidateY - target.y) > (radius + target.radius) * 1.55);
      if (clear || attempt === 23) {
        x = candidateX;
        y = candidateY;
        break;
      }
    }
  }

  return {
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    x,
    y,
    radius,
    hitRadius: radius * 1.05,
    vx: Math.cos(angle) * baseSpeed,
    vy: Math.sin(angle) * baseSpeed,
    turn: rand(-0.9, 0.9),
    pathMode: Math.random() > 0.45 ? "curve" : "line",
    curveStrength: rand(-0.72, 0.72),
    boundaryMode: Math.random() > 0.45 ? "exit" : "turn",
    wobble: rand(0, Math.PI * 2),
    tailWobble: rand(0, Math.PI * 2),
    tailSeed: rand(0, Math.PI * 2),
    moving: true,
    moveBlend: 1,
    motionUntil: now + rand(4300, 7600),
    colors: choose(mouseColors),
    caught: false,
    respawnAt: 0,
  };
}

function syncMice() {
  while (state.targets.length < 1) state.targets.push(spawnMouse());
  while (state.targets.length > 1) state.targets.pop();
}

function randomizeRoute(target, now) {
  const angle = Math.atan2(target.vy, target.vx) + rand(-1.1, 1.1);
  const speed = rand(86, 132);
  target.vx = Math.cos(angle) * speed;
  target.vy = Math.sin(angle) * speed;
  target.pathMode = Math.random() > 0.45 ? "curve" : "line";
  target.curveStrength = target.pathMode === "curve" ? rand(-0.78, 0.78) : rand(-0.08, 0.08);
  target.boundaryMode = Math.random() > 0.45 ? "exit" : "turn";
  target.turn = rand(-1.2, 1.2);
  target.motionUntil = now + rand(4300, 7800);
}

function respawnFromEdge(target, now) {
  const side = Math.floor(rand(0, 4));
  const r = target.radius;
  const pad = r * 2.2;
  if (side === 0) {
    target.x = -pad;
    target.y = rand(r, state.height - r);
    target.vx = rand(86, 132);
    target.vy = rand(-45, 45);
  } else if (side === 1) {
    target.x = state.width + pad;
    target.y = rand(r, state.height - r);
    target.vx = -rand(86, 132);
    target.vy = rand(-45, 45);
  } else if (side === 2) {
    target.x = rand(r, state.width - r);
    target.y = -pad;
    target.vx = rand(-45, 45);
    target.vy = rand(86, 132);
  } else {
    target.x = rand(r, state.width - r);
    target.y = state.height + pad;
    target.vx = rand(-45, 45);
    target.vy = -rand(86, 132);
  }
  randomizeRoute(target, now);
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
  state.movementAudio.volume = settings.volume;
  state.movementAudio.playsInline = true;
}

function createMovementWavDataUri() {
  const sampleRate = 22050;
  const seconds = 1.65;
  const length = Math.floor(sampleRate * seconds);
  const dataSize = length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;

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

  let scrape = 0;
  let held = 0;
  for (let i = 0; i < length; i += 1) {
    if (i % 620 === 0) held = Math.random() * 2 - 1;
    const t = i / sampleRate;
    scrape = scrape * 0.9 + (Math.random() * 2 - 1) * 0.1;
    const crinkle = Math.random() > 0.94 ? Math.random() * 2 - 1 : held * 0.24;
    const footPulse = 0.42 + 0.58 * Math.max(0, Math.sin(t * Math.PI * 7.5));
    const slowRub = 0.52 + 0.48 * Math.sin(t * Math.PI * 3.2);
    const sample = (crinkle * 0.58 * footPulse + scrape * 0.46 * slowRub) * 0.8;
    view.setInt16(offset, Math.max(-1, Math.min(1, sample)) * 32767, true);
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

function startMovementNoise() {
  if (!state.audio || !state.masterGain || state.plasticNoise || state.cardboardNoise) return;
  const plasticFilter = state.audio.createBiquadFilter();
  plasticFilter.type = "highpass";
  plasticFilter.frequency.value = 1550;
  plasticFilter.Q.value = 0.9;
  state.plasticGain = state.audio.createGain();
  state.plasticGain.gain.value = 0.0001;
  state.plasticNoise = createLoopNoise(2.4, "crinkle");
  state.plasticNoise.connect(plasticFilter);
  plasticFilter.connect(state.plasticGain);
  state.plasticGain.connect(state.masterGain);
  state.plasticNoise.start();

  const cardboardFilter = state.audio.createBiquadFilter();
  cardboardFilter.type = "bandpass";
  cardboardFilter.frequency.value = 520;
  cardboardFilter.Q.value = 1.2;
  state.cardboardGain = state.audio.createGain();
  state.cardboardGain.gain.value = 0.0001;
  state.cardboardNoise = createLoopNoise(2.8, "scrape");
  state.cardboardNoise.connect(cardboardFilter);
  cardboardFilter.connect(state.cardboardGain);
  state.cardboardGain.connect(state.masterGain);
  state.cardboardNoise.start();
}

function createLoopNoise(seconds, kind) {
  const length = Math.floor(state.audio.sampleRate * seconds);
  const buffer = state.audio.createBuffer(1, length, state.audio.sampleRate);
  const data = buffer.getChannelData(0);
  let held = 0;
  let scrape = 0;
  for (let i = 0; i < length; i += 1) {
    if (kind === "crinkle") {
      if (i % 1400 === 0) held = Math.random() * 2 - 1;
      const tick = Math.random() > 0.965 ? Math.random() * 2 - 1 : held * 0.28;
      data[i] = tick * (0.58 + 0.42 * Math.sin((i / length) * Math.PI * 18));
    } else {
      scrape = scrape * 0.92 + (Math.random() * 2 - 1) * 0.08;
      data[i] = scrape * (0.64 + 0.36 * Math.sin((i / length) * Math.PI * 7));
    }
  }
  const source = state.audio.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

async function unlockAudio() {
  initMovementElementAudio();
  const elementPlay = state.movementAudio?.play().catch(() => {});
  initAudio();
  if (state.audio?.state === "suspended") {
    await state.audio.resume();
  }
  if (state.masterGain) {
    state.masterGain.gain.cancelScheduledValues(state.audio.currentTime);
    state.masterGain.gain.setValueAtTime(Math.max(settings.volume, 0.72), state.audio.currentTime);
  }
  startMovementNoise();
  playChime(720, 0.28);
  await elementPlay;
}

function setVolume(value) {
  settings.volume = Number(value);
  if (state.movementAudio) {
    state.movementAudio.volume = settings.volume;
  }
  if (state.masterGain && state.audio) {
    state.masterGain.gain.setTargetAtTime(settings.volume, state.audio.currentTime, 0.02);
  }
}

function playChime(base = rand(520, 820), duration = 0.16) {
  if (!state.audio || !state.masterGain) return;

  const now = state.audio.currentTime;
  const gain = state.audio.createGain();
  const osc = state.audio.createOscillator();
  const sparkle = state.audio.createOscillator();

  osc.type = "sine";
  sparkle.type = "triangle";
  osc.frequency.setValueAtTime(base, now);
  osc.frequency.exponentialRampToValueAtTime(base * 1.35, now + duration);
  sparkle.frequency.setValueAtTime(base * 2.2, now + 0.01);
  sparkle.frequency.exponentialRampToValueAtTime(base * 2.65, now + duration * 0.7);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.42, now + 0.014);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  sparkle.connect(gain);
  gain.connect(state.masterGain);
  osc.start(now);
  sparkle.start(now + 0.018);
  osc.stop(now + duration + 0.02);
  sparkle.stop(now + duration + 0.02);
}

function updateMovementSound(intensity) {
  const audible = state.running && settings.volume > 0 ? Math.max(0, Math.min(1, intensity)) : 0;
  if (state.movementAudio) {
    state.movementAudio.volume = audible > 0.03 ? Math.min(1, settings.volume * (0.72 + audible * 0.55)) : 0;
    state.movementAudio.playbackRate = 0.9 + audible * 0.22;
  }
  if (!state.audio || !state.plasticGain || !state.cardboardGain) return;
  const now = state.audio.currentTime;
  const plasticLevel = audible > 0.03 ? 0.12 + audible * 0.12 : 0.0001;
  const cardboardLevel = audible > 0.03 ? 0.09 + audible * 0.1 : 0.0001;
  state.plasticGain.gain.setTargetAtTime(plasticLevel, now, audible > 0 ? 0.05 : 0.025);
  state.cardboardGain.gain.setTargetAtTime(cardboardLevel, now, audible > 0 ? 0.06 : 0.025);
}

function addRipple(x, y, color) {
  state.ripples.push({ x, y, color, age: 0, ttl: 0.55 });
}

function catchTarget(target, x, y) {
  if (target.caught) return;
  target.caught = true;
  target.respawnAt = performance.now() + rand(650, 1500);
  addRipple(x, y, target.colors.ear);
  playChime(rand(560, 880), rand(0.1, 0.18));
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
    if (now >= target.respawnAt) {
      Object.assign(target, spawnMouse());
    }
    return;
  }

  if (now >= target.motionUntil) {
    target.moving = !target.moving;
    target.motionUntil = now + (target.moving ? rand(4300, 7800) : rand(STOP_MIN_MS, STOP_MAX_MS));
    if (target.moving) {
      randomizeRoute(target, now);
    }
  }

  const targetBlend = target.moving ? 1 : 0;
  target.moveBlend += (targetBlend - target.moveBlend) * Math.min(1, dt * (target.moving ? 5.2 : 7.5));
  target.wobble += dt * (2.1 + target.moveBlend * 7.2);
  target.tailWobble += dt * 1.35;

  const curveDrift = target.pathMode === "curve" ? target.curveStrength : 0;
  const drift = (curveDrift + Math.sin(target.wobble * 0.24) * target.turn * 0.18) * dt;
  const speed = Math.hypot(target.vx, target.vy) || 1;
  const angle = Math.atan2(target.vy, target.vx) + drift;

  target.vx = Math.cos(angle) * speed;
  target.vy = Math.sin(angle) * speed;
  target.x += target.vx * settings.speed * target.moveBlend * dt;
  target.y += target.vy * settings.speed * target.moveBlend * dt;

  const margin = target.radius * 0.92;
  const exitMargin = target.radius * 8.6;
  if (target.x < margin || target.x > state.width - margin) {
    if (target.boundaryMode === "turn") {
      target.vx *= -1;
      target.x = Math.min(Math.max(target.x, margin), state.width - margin);
      randomizeRoute(target, now);
    } else if (target.x < -exitMargin || target.x > state.width + exitMargin) {
      respawnFromEdge(target, now);
    }
  }
  if (target.y < margin || target.y > state.height - margin) {
    if (target.boundaryMode === "turn") {
      target.vy *= -1;
      target.y = Math.min(Math.max(target.y, margin), state.height - margin);
      randomizeRoute(target, now);
    } else if (target.y < -exitMargin || target.y > state.height + exitMargin) {
      respawnFromEdge(target, now);
    }
  }
}

function updateRipples(dt) {
  for (const ripple of state.ripples) ripple.age += dt;
  state.ripples = state.ripples.filter((ripple) => ripple.age < ripple.ttl);
}

function resolveMouseOverlaps() {
  for (let i = 0; i < state.targets.length; i += 1) {
    for (let j = i + 1; j < state.targets.length; j += 1) {
      const first = state.targets[i];
      const second = state.targets[j];
      if (first.caught || second.caught) continue;

      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const minDistance = (first.radius + second.radius) * 1.55;
      if (distance >= minDistance) continue;

      const nx = dx / distance;
      const ny = dy / distance;
      const push = (minDistance - distance) / 2;
      first.x -= nx * push;
      first.y -= ny * push;
      second.x += nx * push;
      second.y += ny * push;

      const firstSpeed = Math.hypot(first.vx, first.vy) || 34;
      const secondSpeed = Math.hypot(second.vx, second.vy) || 34;
      first.vx = -nx * firstSpeed;
      first.vy = -ny * firstSpeed;
      second.vx = nx * secondSpeed;
      second.vy = ny * secondSpeed;

      const firstMargin = Math.min(first.radius * 1.9, Math.max(92, Math.min(state.width, state.height) * 0.28));
      const secondMargin = Math.min(second.radius * 1.9, Math.max(92, Math.min(state.width, state.height) * 0.28));
      first.x = Math.min(Math.max(first.x, firstMargin), state.width - firstMargin);
      first.y = Math.min(Math.max(first.y, firstMargin), state.height - firstMargin);
      second.x = Math.min(Math.max(second.x, secondMargin), state.width - secondMargin);
      second.y = Math.min(Math.max(second.y, secondMargin), state.height - secondMargin);
    }
  }
}

function drawBackground(time) {
  const gradient = ctx.createLinearGradient(0, 0, state.width, state.height);
  gradient.addColorStop(0, "#f8fff2");
  gradient.addColorStop(0.52, "#edf9f6");
  gradient.addColorStop(1, "#fff7ec");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.save();
  ctx.globalAlpha = 0.28;
  for (let i = 0; i < 12; i += 1) {
    const x = ((i * 211 + time * 6) % (state.width + 180)) - 90;
    const y = 60 + ((i * 97) % Math.max(120, state.height - 120));
    ctx.beginPath();
    ctx.fillStyle = i % 2 ? "#d9f3ee" : "#fff1cc";
    ctx.ellipse(x, y, 28 + (i % 4) * 8, 12 + (i % 3) * 5, i, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMouse(target) {
  const angle = Math.atan2(target.vy, target.vx);
  const r = target.radius;
  const wiggle = Math.sin(target.wobble);
  const move = target.moveBlend;
  const tailPhase = target.tailWobble * (1.2 + move * 0.6) + target.tailSeed;
  const tailLength = TAIL_LENGTH_SCALE;
  const tailPoints = [
    { x: -r * 0.78, y: r * 0.06 },
    { x: -r * (0.78 + 0.58 * tailLength), y: Math.sin(tailPhase + 0.2) * r * (1.22 + move * 0.38) },
    { x: -r * (0.78 + 1.24 * tailLength), y: Math.sin(tailPhase * 1.23 + 1.7) * r * (1.48 + move * 0.46) },
    { x: -r * (0.78 + 1.92 * tailLength), y: Math.sin(tailPhase * 0.91 + 3.4) * r * (1.4 + move * 0.5) },
    { x: -r * (0.78 + 2.7 * tailLength), y: Math.sin(tailPhase * 1.41 + 4.8) * r * (1.24 + move * 0.44) },
    { x: -r * (0.78 + 3.44 * tailLength + 0.56), y: Math.sin(tailPhase * 1.08 + 6.1) * r * (1.08 + move * 0.38) },
  ];

  ctx.save();
  ctx.translate(target.x, target.y);
  ctx.rotate(angle);

  ctx.shadowColor = "rgba(75, 104, 99, 0.14)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 8;

  ctx.strokeStyle = target.colors.tail;
  ctx.lineWidth = Math.max(6, r * 0.14);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(tailPoints[0].x, tailPoints[0].y);
  for (let i = 1; i < tailPoints.length - 1; i += 1) {
    const midX = (tailPoints[i].x + tailPoints[i + 1].x) / 2;
    const midY = (tailPoints[i].y + tailPoints[i + 1].y) / 2;
    ctx.quadraticCurveTo(tailPoints[i].x, tailPoints[i].y, midX, midY);
  }
  const tip = tailPoints[tailPoints.length - 1];
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();

  ctx.fillStyle = target.colors.body;
  ctx.beginPath();
  ctx.ellipse(-r * 0.06, 0, r * 0.78, r * 0.56, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.fillStyle = target.colors.belly;
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, r * 0.1, r * 0.4, r * 0.3, 0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = target.colors.body;
  ctx.beginPath();
  ctx.ellipse(r * 0.55, 0, r * 0.58, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  for (const side of [-1, 1]) {
    ctx.fillStyle = target.colors.body;
    ctx.beginPath();
    ctx.arc(r * 0.38, side * r * 0.35, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = target.colors.ear;
    ctx.beginPath();
    ctx.arc(r * 0.39, side * r * 0.35, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#fffdf8";
  ctx.beginPath();
  ctx.arc(r * 0.7, -r * 0.19, r * 0.24, 0, Math.PI * 2);
  ctx.arc(r * 0.7, r * 0.19, r * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(r * 0.8, -r * 0.19, r * 0.092, 0, Math.PI * 2);
  ctx.arc(r * 0.8, r * 0.19, r * 0.092, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 0.78;
  ctx.beginPath();
  ctx.arc(r * 0.85, -r * 0.27, r * 0.052, 0, Math.PI * 2);
  ctx.arc(r * 0.85, r * 0.11, r * 0.052, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = target.colors.cheek;
  ctx.globalAlpha = 0.58;
  ctx.beginPath();
  ctx.arc(r * 0.58, -r * 0.29, r * 0.08, 0, Math.PI * 2);
  ctx.arc(r * 0.58, r * 0.29, r * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#e79aa3";
  ctx.beginPath();
  ctx.ellipse(r * 1.04, 0, r * 0.07, r * 0.055, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(69, 90, 86, 0.24)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.18 + wiggle * 2, side * r * 0.44);
    ctx.lineTo(-r * 0.32 - wiggle * 3, side * r * 0.63);
    ctx.stroke();
  }

  ctx.restore();
}

function drawRipples() {
  for (const ripple of state.ripples) {
    const progress = ripple.age / ripple.ttl;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = ripple.color;
    ctx.lineWidth = 4 * (1 - progress) + 1;
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, 18 + progress * 74, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = (1 - progress) * 0.34;
    ctx.fillStyle = "#fffdf6";
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, 10 + progress * 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function frame(time) {
  const dt = Math.min(0.04, (time - state.lastTime) / 1000 || 0);
  state.lastTime = time;

  drawBackground(time / 1000);
  for (const target of state.targets) updateTarget(target, dt, time);
  resolveMouseOverlaps();
  updateRipples(dt);
  for (const target of state.targets) {
    if (!target.caught) drawMouse(target);
  }
  drawRipples();
  const movementIntensity = state.targets.reduce((sum, target) => sum + (target.caught ? 0 : target.moveBlend), 0) / Math.max(1, state.targets.length);
  updateMovementSound(movementIntensity);

  requestAnimationFrame(frame);
}

async function startGame() {
  if (state.running || state.starting) return;
  state.starting = true;
  await unlockAudio();
  await enterCatMode();
  state.running = true;
  state.starting = false;
  startButton.classList.add("is-hidden");
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
    if (screen.orientation?.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch {}
}

function stopAudio() {
  state.running = false;
  if (state.masterGain && state.audio) {
    state.masterGain.gain.cancelScheduledValues(state.audio.currentTime);
    state.masterGain.gain.setValueAtTime(0.0001, state.audio.currentTime);
  }
  updateMovementSound(0);
  if (state.audio?.state === "running") {
    state.audio.suspend();
  }
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
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.running) {
    enterCatMode();
  }
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
