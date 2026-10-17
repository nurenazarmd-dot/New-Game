'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX, Pause, Play, RotateCcw, Download, Check } from 'lucide-react';

// Global YouTube Playables SDK Type Declaration
declare global {
  interface Window {
    ytgame?: {
      game?: {
        firstFrameReady?: () => void;
        gameReady?: () => void;
      };
      engagement?: {
        sendScore?: (data: { value: number }) => void;
      };
      system?: {
        onPause?: (cb: () => void) => void;
        onResume?: (cb: () => void) => void;
      };
    };
  }
}

type GameState = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

type HazardType = 'VIRAL' | 'SHIFTER' | 'SURGE';

interface TrailPoint {
  x: number;
  y: number;
  alpha: number;
}

interface Obstacle {
  angle: number;
  lane: 0 | 1;
  targetLane: 0 | 1;
  radius: number;
  angularSpeed: number;
  scale: number;
  active: boolean;
  pulsePhase: number;
  maxLifeTime: number;
  age: number;
  type: HazardType;
  shiftTimer: number;
  telegraphingShift: boolean;
  nearMissAwarded: boolean;
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  decay: number;
}

interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  alpha: number;
}

interface BgSynapse {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
}

// --- 1. VIRTUAL RESOLUTION & SPATIAL CONSTANTS ---
const V_WIDTH = 360;
const V_HEIGHT = 640;
const CENTER_X = V_WIDTH / 2;
const CENTER_Y = V_HEIGHT / 2;
const TWO_PI = Math.PI * 2;

const INNER_RADIUS = 76;
const OUTER_RADIUS = 128;
const PLAYER_RADIUS = 8;
const OBSTACLE_RADIUS = 9;
const PARTICLE_POOL_SIZE = 160;

/**
 * Explicitly normalizes any radian angle into the range [0, 2 * PI)
 * Prevents float overflow, memory leaks, and desynchronization after multiple orbits.
 */
export function normalizeAngle(angle: number): number {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Calculates shortest angular distance between two normalized angles.
 */
function getAngularDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(diff, TWO_PI - diff);
}

// --- 2. PROCEDURAL WEB AUDIO SYNTHESIZER ---
class SoundSystem {
  private ctx: AudioContext | null = null;
  public isMuted: boolean = false;

  init() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended' && !this.isMuted) {
      this.ctx.resume().catch(() => {});
    }
  }

  mute() {
    this.isMuted = true;
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  unmute() {
    this.isMuted = false;
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  playSwitch(isOuter: boolean) {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const startFreq = isOuter ? 330 : 540;
      const endFreq = isOuter ? 600 : 310;

      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.085);

      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
    } catch {}
  }

  playWeaveBonus(streak: number) {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const baseFreq = Math.min(1480, 660 + streak * 75);
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, now + 0.14);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch {}
  }

  playScorePulse() {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.11);

      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch {}
  }

  playCrash() {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const sub = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      sub.type = 'square';

      osc.frequency.setValueAtTime(170, now);
      osc.frequency.exponentialRampToValueAtTime(32, now + 0.45);

      sub.frequency.setValueAtTime(85, now);
      sub.frequency.exponentialRampToValueAtTime(20, now + 0.45);

      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      sub.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      sub.start(now);
      osc.stop(now + 0.46);
      sub.stop(now + 0.46);
    } catch {}
  }
}

export default function SynapseWeaverGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<SoundSystem>(new SoundSystem());

  // React UI state only updates on coarse transitions or integer score changes
  const [uiState, setUiState] = useState<GameState>('TITLE_MENU');
  const [hudScore, setHudScore] = useState<number>(0);
  const [hudBest, setHudBest] = useState<number>(0);
  const [hudSpeedPct, setHudSpeedPct] = useState<number>(100);
  const [hudStreak, setHudStreak] = useState<number>(0);
  const [hudLane, setHudLane] = useState<0 | 1>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [copiedBundle, setCopiedBundle] = useState<boolean>(false);

  // Mutable simulation state isolated from React re-renders
  const simRef = useRef({
    state: 'TITLE_MENU' as GameState,
    isPlatformPaused: false,
    lastFrameTime: 0,
    rafId: 0 as number,
    score: 0,
    lastReportedScore: -1,
    lastReportedSpeed: 100,
    bestScore: 0,
    weaveStreak: 0,
    maxStreak: 0,
    difficultyMultiplier: 1,
    screenShake: 0,
    hitstopTimer: 0,
    hitFlashAlpha: 0,
    corePulse: 0,
    spawnTimer: 0,
    inputBufferTimer: 0,
    heldKeys: new Set<string>(),
    justPressedSwitch: false,

    player: {
      angle: normalizeAngle(-Math.PI / 2),
      lane: 0 as 0 | 1,
      currentRadius: INNER_RADIUS,
      targetRadius: INNER_RADIUS,
      baseAngularSpeed: 2.3,
      squashX: 1,
      squashY: 1,
      trail: [] as TrailPoint[],
    },

    obstacles: [] as Obstacle[],
    particlePool: Array.from({ length: PARTICLE_POOL_SIZE }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 2,
      color: '#00f3ff',
      alpha: 0,
      decay: 1.5,
    })) as Particle[],
    floatingTexts: [] as FloatingText[],
    bgSynapses: [] as BgSynapse[],
  });

  // --- YOUTUBE PLAYABLES SDK HELPERS ---
  const ytFirstFrameReady = useCallback(() => {
    try {
      if (typeof window !== 'undefined' && window.ytgame?.game?.firstFrameReady) {
        window.ytgame.game.firstFrameReady();
      }
    } catch (e) {
      console.warn('YT SDK firstFrameReady error:', e);
    }
  }, []);

  const ytGameReady = useCallback(() => {
    try {
      if (typeof window !== 'undefined' && window.ytgame?.game?.gameReady) {
        window.ytgame.game.gameReady();
      }
    } catch (e) {
      console.warn('YT SDK gameReady error:', e);
    }
  }, []);

  const ytSendScore = useCallback((val: number) => {
    try {
      if (typeof window !== 'undefined' && window.ytgame?.engagement?.sendScore) {
        window.ytgame.engagement.sendScore({ value: Math.floor(val) });
      }
    } catch (e) {
      console.warn('YT SDK sendScore error:', e);
    }
  }, []);

  // --- PARTICLE POOL SPAWNER ---
  const spawnParticles = useCallback(
    (x: number, y: number, color: string, count: number, speedScale = 1) => {
      const pool = simRef.current.particlePool;
      let spawned = 0;
      for (let i = 0; i < pool.length && spawned < count; i++) {
        if (!pool[i].active) {
          const angle = Math.random() * TWO_PI;
          const speed = (Math.random() * 95 + 30) * speedScale;
          pool[i].active = true;
          pool[i].x = x;
          pool[i].y = y;
          pool[i].vx = Math.cos(angle) * speed;
          pool[i].vy = Math.sin(angle) * speed;
          pool[i].radius = Math.random() * 2.8 + 1.4;
          pool[i].color = color;
          pool[i].alpha = 1;
          pool[i].decay = Math.random() * 1.5 + 1.2;
          spawned++;
        }
      }
    },
    []
  );

  const spawnFloatingText = useCallback((x: number, y: number, text: string, color: string) => {
    simRef.current.floatingTexts.push({
      x,
      y,
      vy: -32,
      text,
      color,
      alpha: 1,
    });
  }, []);

  // --- GAME ACTIONS ---
  const resetSimulation = useCallback(() => {
    const sim = simRef.current;
    sim.score = 0;
    sim.lastReportedScore = 0;
    sim.lastReportedSpeed = 100;
    sim.weaveStreak = 0;
    sim.difficultyMultiplier = 1;
    sim.screenShake = 0;
    sim.hitstopTimer = 0;
    sim.hitFlashAlpha = 0;
    sim.spawnTimer = 0.55;
    sim.inputBufferTimer = 0;
    sim.justPressedSwitch = false;
    sim.obstacles = [];
    sim.floatingTexts = [];

    for (let i = 0; i < sim.particlePool.length; i++) {
      sim.particlePool[i].active = false;
    }

    sim.player.angle = normalizeAngle(-Math.PI / 2);
    sim.player.lane = 0;
    sim.player.currentRadius = INNER_RADIUS;
    sim.player.targetRadius = INNER_RADIUS;
    sim.player.squashX = 1;
    sim.player.squashY = 1;
    sim.player.trail = [];

    setHudScore(0);
    setHudSpeedPct(100);
    setHudStreak(0);
    setHudLane(0);
  }, []);

  const startGame = useCallback(() => {
    audioRef.current.init();
    ytGameReady();
    resetSimulation();
    simRef.current.state = 'PLAYING';
    setUiState('PLAYING');
  }, [resetSimulation, ytGameReady]);

  const executeLaneToggle = useCallback(() => {
    const sim = simRef.current;
    const p = sim.player;
    p.lane = p.lane === 0 ? 1 : 0;
    p.targetRadius = p.lane === 0 ? INNER_RADIUS : OUTER_RADIUS;

    // Squash-and-stretch impulse on lane snap
    p.squashX = 1.42;
    p.squashY = 0.65;

    audioRef.current.playSwitch(p.lane === 1);
    setHudLane(p.lane);

    const px = CENTER_X + Math.cos(p.angle) * p.currentRadius;
    const py = CENTER_Y + Math.sin(p.angle) * p.currentRadius;
    spawnParticles(px, py, '#00f3ff', 9, 0.65);
  }, [spawnParticles]);

  const togglePause = useCallback(() => {
    const sim = simRef.current;
    if (sim.state === 'PLAYING') {
      sim.state = 'PAUSED';
      sim.heldKeys.clear();
      setUiState('PAUSED');
    } else if (sim.state === 'PAUSED') {
      sim.state = 'PLAYING';
      sim.lastFrameTime = performance.now();
      setUiState('PLAYING');
    }
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (audio.isMuted) {
      audio.unmute();
      setIsMuted(false);
    } else {
      audio.mute();
      setIsMuted(true);
    }
  }, []);

  const handleDownloadPlayable = useCallback(async () => {
    try {
      const res = await fetch('/playable.html');
      const htmlText = await res.text();
      const blob = new Blob([htmlText], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'synapse-weaver-youtube-playable.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setCopiedBundle(true);
      setTimeout(() => setCopiedBundle(false), 2000);
    } catch (e) {
      console.error('Failed to download playable bundle:', e);
    }
  }, []);

  // --- MAIN CANVAS SIMULATION & LIFECYCLE ---
  useEffect(() => {
    const sim = simRef.current;

    // Load persisted high score if available
    try {
      const saved = localStorage.getItem('synapse_weaver_best');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) {
          sim.bestScore = parsed;
          setHudBest(parsed);
        }
      }
    } catch {}

    // Initialize ambient background neural nodes relative to V_WIDTH and V_HEIGHT
    sim.bgSynapses = [];
    for (let i = 0; i < 26; i++) {
      sim.bgSynapses.push({
        x: Math.random() * V_WIDTH,
        y: Math.random() * V_HEIGHT,
        vx: (Math.random() - 0.5) * 12,
        vy: (Math.random() - 0.5) * 12,
        radius: Math.random() * 1.8 + 0.5,
        alpha: Math.random() * 0.4 + 0.1,
      });
    }

    function spawnObstacle() {
      // Spawn safely ahead of the player (~150 to 230 degrees ahead)
      const offsetAngle = Math.PI * 0.85 + Math.random() * (Math.PI * 0.45);
      const spawnAngle = normalizeAngle(sim.player.angle + offsetAngle);
      const lane: 0 | 1 = Math.random() < 0.5 ? 0 : 1;
      const targetRadius = lane === 0 ? INNER_RADIUS : OUTER_RADIUS;

      // Prevent overlapping with an existing obstacle that is too close
      for (let i = 0; i < sim.obstacles.length; i++) {
        const obs = sim.obstacles[i];
        const dist = getAngularDistance(spawnAngle, obs.angle);
        if (dist < 0.46 && obs.lane === lane) return;
        if (dist < 0.36 && obs.lane !== lane) return;
      }

      // Select hazard archetype with smooth difficulty ramp
      let type: HazardType = 'VIRAL';
      const roll = Math.random();
      if (sim.score > 140 && roll < 0.25) {
        type = 'SHIFTER';
      } else if (sim.score > 65 && roll < 0.48) {
        type = 'SURGE';
      }

      const speedScalar =
        type === 'SURGE'
          ? 0.78 + Math.random() * 0.35
          : 0.45 + Math.random() * 0.32;

      sim.obstacles.push({
        angle: spawnAngle,
        lane,
        targetLane: lane,
        radius: targetRadius,
        angularSpeed: speedScalar * sim.difficultyMultiplier,
        scale: 0,
        active: false,
        pulsePhase: Math.random() * TWO_PI,
        maxLifeTime: 7.5,
        age: 0,
        type,
        shiftTimer: type === 'SHIFTER' ? 2.1 + Math.random() * 0.8 : 999,
        telegraphingShift: false,
        nearMissAwarded: false,
      });
    }

    function triggerGameOver(crashX: number, crashY: number) {
      sim.state = 'GAME_OVER';
      sim.screenShake = 15;
      sim.hitstopTimer = 0.065; // 65ms impact hitstop
      sim.hitFlashAlpha = 0.75;
      audioRef.current.playCrash();

      spawnParticles(crashX, crashY, '#ff007f', 36, 1.5);
      spawnParticles(crashX, crashY, '#00f3ff', 24, 1.2);

      const finalScore = Math.floor(sim.score);
      if (finalScore > sim.bestScore) {
        sim.bestScore = finalScore;
        setHudBest(finalScore);
        try {
          localStorage.setItem('synapse_weaver_best', String(finalScore));
        } catch {}
      }

      setHudScore(finalScore);
      setUiState('GAME_OVER');
      ytSendScore(finalScore);
    }

    function update(dt: number) {
      // Hitstop freeze for tactile impact weight
      if (sim.hitstopTimer > 0) {
        sim.hitstopTimer = Math.max(0, sim.hitstopTimer - dt);
        if (sim.screenShake > 0) {
          sim.screenShake = Math.max(0, sim.screenShake - dt * 25);
        }
        if (sim.hitFlashAlpha > 0) {
          sim.hitFlashAlpha = Math.max(0, sim.hitFlashAlpha - dt * 6);
        }
        return;
      }

      sim.corePulse = normalizeAngle(sim.corePulse + dt * 3);

      if (sim.screenShake > 0) {
        sim.screenShake = Math.max(0, sim.screenShake - dt * 35);
      }
      if (sim.hitFlashAlpha > 0) {
        sim.hitFlashAlpha = Math.max(0, sim.hitFlashAlpha - dt * 4.5);
      }

      // Ambient background neural drift
      for (let i = 0; i < sim.bgSynapses.length; i++) {
        const node = sim.bgSynapses[i];
        node.x += node.vx * dt;
        node.y += node.vy * dt;
        if (node.x < 0) node.x = V_WIDTH;
        if (node.x > V_WIDTH) node.x = 0;
        if (node.y < 0) node.y = V_HEIGHT;
        if (node.y > V_HEIGHT) node.y = 0;
      }

      // Pooled particles update
      for (let i = 0; i < sim.particlePool.length; i++) {
        const p = sim.particlePool[i];
        if (!p.active) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.alpha -= p.decay * dt;
        if (p.alpha <= 0) {
          p.active = false;
        }
      }

      // Floating score text update
      for (let i = sim.floatingTexts.length - 1; i >= 0; i--) {
        const ft = sim.floatingTexts[i];
        ft.y += ft.vy * dt;
        ft.alpha -= dt * 1.4;
        if (ft.alpha <= 0) {
          sim.floatingTexts.splice(i, 1);
        }
      }

      // Title menu live centerpiece orbital loop
      if (sim.state === 'TITLE_MENU') {
        sim.player.angle = normalizeAngle(sim.player.angle + 1.55 * dt);
        const px = CENTER_X + Math.cos(sim.player.angle) * sim.player.currentRadius;
        const py = CENTER_Y + Math.sin(sim.player.angle) * sim.player.currentRadius;
        sim.player.trail.push({ x: px, y: py, alpha: 1 });
        if (sim.player.trail.length > 20) sim.player.trail.shift();
        for (let i = 0; i < sim.player.trail.length; i++) {
          sim.player.trail[i].alpha = (i + 1) / sim.player.trail.length;
        }
        return;
      }

      if (sim.state !== 'PLAYING') return;

      // Process edge-triggered & buffered input
      if (sim.justPressedSwitch || sim.inputBufferTimer > 0) {
        sim.justPressedSwitch = false;
        sim.inputBufferTimer = 0;
        executeLaneToggle();
      }

      // Recover squash-and-stretch back to 1.0
      sim.player.squashX += (1 - sim.player.squashX) * Math.min(1, dt * 18);
      sim.player.squashY += (1 - sim.player.squashY) * Math.min(1, dt * 18);

      // Score & difficulty scaling
      const prevDecade = Math.floor(sim.score / 25);
      sim.score += dt * 12 * sim.difficultyMultiplier;
      if (Math.floor(sim.score / 25) > prevDecade) {
        audioRef.current.playScorePulse();
        sim.corePulse = 0;
      }

      sim.difficultyMultiplier = 1 + Math.min(1.45, sim.score / 450);

      const intScore = Math.floor(sim.score);
      if (intScore !== sim.lastReportedScore) {
        sim.lastReportedScore = intScore;
        setHudScore(intScore);
      }
      const speedPct = Math.round(sim.difficultyMultiplier * 100);
      if (speedPct !== sim.lastReportedSpeed) {
        sim.lastReportedSpeed = speedPct;
        setHudSpeedPct(speedPct);
      }

      // Player Orbital Update with strict normalizeAngle
      const currentSpeed = sim.player.baseAngularSpeed * sim.difficultyMultiplier;
      sim.player.angle = normalizeAngle(sim.player.angle + currentSpeed * dt);

      const radiusDiff = sim.player.targetRadius - sim.player.currentRadius;
      sim.player.currentRadius += radiusDiff * Math.min(1, dt * 22);

      const px = CENTER_X + Math.cos(sim.player.angle) * sim.player.currentRadius;
      const py = CENTER_Y + Math.sin(sim.player.angle) * sim.player.currentRadius;

      sim.player.trail.push({ x: px, y: py, alpha: 1 });
      if (sim.player.trail.length > 22) {
        sim.player.trail.shift();
      }
      for (let i = 0; i < sim.player.trail.length; i++) {
        sim.player.trail[i].alpha = (i + 1) / sim.player.trail.length;
      }

      // Obstacle Spawning
      sim.spawnTimer -= dt;
      if (sim.spawnTimer <= 0) {
        spawnObstacle();
        const minInterval = 0.42;
        const baseInterval = Math.max(minInterval, 1.32 - sim.score / 360);
        sim.spawnTimer = baseInterval + Math.random() * 0.32;
      }

      // Update Obstacles & Collisions
      for (let i = sim.obstacles.length - 1; i >= 0; i--) {
        const obs = sim.obstacles[i];
        obs.age += dt;
        obs.pulsePhase = normalizeAngle(obs.pulsePhase + dt * 8.5);

        // Windup Telegraph & Despawn Scale
        if (obs.age < 0.4) {
          obs.scale = obs.age / 0.4;
          obs.active = obs.scale > 0.82;
        } else if (obs.age > obs.maxLifeTime - 0.4) {
          obs.scale = Math.max(0, (obs.maxLifeTime - obs.age) / 0.4);
          obs.active = false;
        } else {
          obs.scale = 1;
          obs.active = true;
        }

        // Phase Shifter hazard behavior with visible 0.55s windup telegraph
        if (obs.type === 'SHIFTER' && obs.age < obs.maxLifeTime - 1.0) {
          obs.shiftTimer -= dt;
          if (obs.shiftTimer <= 0.55 && obs.shiftTimer > 0) {
            obs.telegraphingShift = true;
            obs.targetLane = obs.lane === 0 ? 1 : 0;
          } else if (obs.shiftTimer <= 0) {
            obs.lane = obs.targetLane;
            obs.telegraphingShift = false;
            obs.shiftTimer = 2.4 + Math.random() * 0.8;
          }
        }

        const desiredRadius = obs.lane === 0 ? INNER_RADIUS : OUTER_RADIUS;
        obs.radius += (desiredRadius - obs.radius) * Math.min(1, dt * 16);

        // Normalized counter-clockwise orbital motion
        obs.angle = normalizeAngle(obs.angle - obs.angularSpeed * dt);

        const ox = CENTER_X + Math.cos(obs.angle) * obs.radius;
        const oy = CENTER_Y + Math.sin(obs.angle) * obs.radius;

        if (obs.active) {
          const dx = px - ox;
          const dy = py - oy;
          const distSq = dx * dx + dy * dy;
          const hitRadius = PLAYER_RADIUS + OBSTACLE_RADIUS * obs.scale - 2;

          if (distSq < hitRadius * hitRadius) {
            triggerGameOver(px, py);
            return;
          }

          // Check for close-call Neural Weave bonus when passing in opposite lane
          const angDist = getAngularDistance(sim.player.angle, obs.angle);
          if (!obs.nearMissAwarded && angDist < 0.14 && obs.lane !== sim.player.lane) {
            obs.nearMissAwarded = true;
            sim.weaveStreak += 1;
            const bonus = 10 + Math.min(25, sim.weaveStreak * 5);
            sim.score += bonus;
            sim.hitstopTimer = 0.025; // Crisp micro-hitstop on close weave
            sim.screenShake = 3.5;
            setHudStreak(sim.weaveStreak);
            audioRef.current.playWeaveBonus(sim.weaveStreak);
            spawnParticles(px, py, '#00f3ff', 10, 0.8);
            spawnFloatingText(px, py - 14, `+${bonus} WEAVE`, '#00f3ff');
          }
        }

        if (obs.age >= obs.maxLifeTime) {
          sim.obstacles.splice(i, 1);
        }
      }
    }

    function draw(ctx: CanvasRenderingContext2D) {
      ctx.save();

      // Decaying camera shake
      if (sim.screenShake > 0) {
        const sx = (Math.random() - 0.5) * sim.screenShake;
        const sy = (Math.random() - 0.5) * sim.screenShake;
        ctx.translate(sx, sy);
      }

      // 1. Dark Cyberpunk Canvas Gradient Background
      const bgGrad = ctx.createRadialGradient(
        CENTER_X,
        CENTER_Y,
        10,
        CENTER_X,
        CENTER_Y,
        V_HEIGHT * 0.75
      );
      bgGrad.addColorStop(0, '#0f0c24');
      bgGrad.addColorStop(0.5, '#070612');
      bgGrad.addColorStop(1, '#020206');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);

      // 2. Ambient Neural Background Connections
      ctx.lineWidth = 0.6;
      for (let i = 0; i < sim.bgSynapses.length; i++) {
        const n1 = sim.bgSynapses[i];
        ctx.fillStyle = `rgba(157, 0, 255, ${n1.alpha})`;
        ctx.beginPath();
        ctx.arc(n1.x, n1.y, n1.radius, 0, TWO_PI);
        ctx.fill();

        for (let j = i + 1; j < sim.bgSynapses.length; j++) {
          const n2 = sim.bgSynapses[j];
          const dx = n1.x - n2.x;
          const dy = n1.y - n2.y;
          const dist = dx * dx + dy * dy;
          if (dist < 6500) {
            ctx.strokeStyle = `rgba(0, 243, 255, ${(1 - dist / 6500) * 0.12})`;
            ctx.beginPath();
            ctx.moveTo(n1.x, n1.y);
            ctx.lineTo(n2.x, n2.y);
            ctx.stroke();
          }
        }
      }

      // 3. Central Synapse Core & Concentric Lane Rings
      const pulseOffset = Math.sin(sim.corePulse) * 4;

      // Connecting neural spokes
      ctx.strokeStyle = 'rgba(157, 0, 255, 0.14)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const spokeAngle = (i * Math.PI) / 4 + sim.corePulse * 0.08;
        ctx.beginPath();
        ctx.moveTo(
          CENTER_X + Math.cos(spokeAngle) * 28,
          CENTER_Y + Math.sin(spokeAngle) * 28
        );
        ctx.lineTo(
          CENTER_X + Math.cos(spokeAngle) * OUTER_RADIUS,
          CENTER_Y + Math.sin(spokeAngle) * OUTER_RADIUS
        );
        ctx.stroke();
      }

      // Inner Lane Ring
      ctx.beginPath();
      ctx.arc(CENTER_X, CENTER_Y, INNER_RADIUS, 0, TWO_PI);
      ctx.strokeStyle =
        sim.player.lane === 0
          ? 'rgba(0, 243, 255, 0.48)'
          : 'rgba(0, 243, 255, 0.14)';
      ctx.lineWidth = sim.player.lane === 0 ? 2.5 : 1.5;
      ctx.stroke();

      // Outer Lane Ring
      ctx.beginPath();
      ctx.arc(CENTER_X, CENTER_Y, OUTER_RADIUS, 0, TWO_PI);
      ctx.strokeStyle =
        sim.player.lane === 1
          ? 'rgba(0, 243, 255, 0.48)'
          : 'rgba(0, 243, 255, 0.14)';
      ctx.lineWidth = sim.player.lane === 1 ? 2.5 : 1.5;
      ctx.stroke();

      // Central Glowing Nucleus
      ctx.save();
      ctx.shadowBlur = 22;
      ctx.shadowColor = '#9d00ff';
      ctx.fillStyle = 'rgba(157, 0, 255, 0.26)';
      ctx.beginPath();
      ctx.arc(CENTER_X, CENTER_Y, 22 + pulseOffset, 0, TWO_PI);
      ctx.fill();

      ctx.fillStyle = '#00f3ff';
      ctx.beginPath();
      ctx.arc(CENTER_X, CENTER_Y, 6 + pulseOffset * 0.3, 0, TWO_PI);
      ctx.fill();
      ctx.restore();

      // 4. Obstacles with Distinct Archetypes & Windup Telegraphs
      for (let i = 0; i < sim.obstacles.length; i++) {
        const obs = sim.obstacles[i];
        const ox = CENTER_X + Math.cos(obs.angle) * obs.radius;
        const oy = CENTER_Y + Math.sin(obs.angle) * obs.radius;
        const r = OBSTACLE_RADIUS * obs.scale;

        const primaryColor =
          obs.type === 'SHIFTER'
            ? '#f59e0b'
            : obs.type === 'SURGE'
            ? '#c084fc'
            : '#ff007f';

        // Spawn windup telegraph ring before becoming active
        if (!obs.active && obs.age < 0.4) {
          ctx.save();
          ctx.strokeStyle = primaryColor;
          ctx.globalAlpha = 0.65;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(ox, oy, OBSTACLE_RADIUS * 1.9 * (1 - obs.scale * 0.4), 0, TWO_PI);
          ctx.stroke();
          ctx.restore();
        }

        // Phase Shifter lane-switch telegraph indicator
        if (obs.telegraphingShift) {
          const targetR = obs.targetLane === 0 ? INNER_RADIUS : OUTER_RADIUS;
          const tx = CENTER_X + Math.cos(obs.angle) * targetR;
          const ty = CENTER_Y + Math.sin(obs.angle) * targetR;

          ctx.save();
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.lineTo(tx, ty);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(tx, ty, OBSTACLE_RADIUS * 0.85, 0, TWO_PI);
          ctx.stroke();
          ctx.restore();
        }

        if (r <= 0.1) continue;

        ctx.save();
        ctx.shadowBlur = 14;
        ctx.shadowColor = primaryColor;

        const auraRadius = r + Math.sin(obs.pulsePhase) * 2.5;
        ctx.strokeStyle = primaryColor;
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ox, oy, Math.max(0.1, auraRadius), 0, TWO_PI);
        ctx.stroke();

        ctx.globalAlpha = 1;
        ctx.fillStyle = primaryColor;
        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, TWO_PI);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ox, oy, r * 0.4, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
      }

      // 5. Player Node & Glowing Trail
      if (sim.state !== 'GAME_OVER') {
        for (let i = 0; i < sim.player.trail.length; i++) {
          const t = sim.player.trail[i];
          if (t.alpha <= 0) continue;
          ctx.fillStyle = `rgba(0, 243, 255, ${t.alpha * 0.45})`;
          ctx.beginPath();
          ctx.arc(
            t.x,
            t.y,
            PLAYER_RADIUS * (i / sim.player.trail.length) * 0.9,
            0,
            TWO_PI
          );
          ctx.fill();
        }

        const px = CENTER_X + Math.cos(sim.player.angle) * sim.player.currentRadius;
        const py = CENTER_Y + Math.sin(sim.player.angle) * sim.player.currentRadius;

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(sim.player.angle);
        ctx.scale(sim.player.squashX, sim.player.squashY);

        ctx.shadowBlur = 18;
        ctx.shadowColor = '#00f3ff';
        ctx.fillStyle = '#00f3ff';
        ctx.beginPath();
        ctx.arc(0, 0, PLAYER_RADIUS, 0, TWO_PI);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, PLAYER_RADIUS * 0.5, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
      }

      // 6. Pooled Particle Effects
      for (let i = 0; i < sim.particlePool.length; i++) {
        const p = sim.particlePool[i];
        if (!p.active) continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.color;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
      }

      // 7. Floating Weave Callouts
      ctx.textAlign = 'center';
      ctx.font = '700 11px monospace';
      for (let i = 0; i < sim.floatingTexts.length; i++) {
        const ft = sim.floatingTexts[i];
        ctx.save();
        ctx.globalAlpha = Math.max(0, ft.alpha);
        ctx.fillStyle = ft.color;
        ctx.shadowBlur = 8;
        ctx.shadowColor = ft.color;
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
      }

      // 8. Impact Flash Overlay
      if (sim.hitFlashAlpha > 0) {
        ctx.fillStyle = `rgba(255, 0, 127, ${sim.hitFlashAlpha * 0.35})`;
        ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);
      }

      ctx.restore();
    }

    function gameLoop(timestamp: number) {
      if (sim.isPlatformPaused) return;

      if (!sim.lastFrameTime) sim.lastFrameTime = timestamp;
      // Clamp frame delta time strictly to Math.min(rawDt, 0.05) per game craft rules
      const rawDt = (timestamp - sim.lastFrameTime) / 1000;
      const dt = Math.min(rawDt, 0.05);
      sim.lastFrameTime = timestamp;

      update(dt);

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) draw(ctx);
      }

      sim.rafId = requestAnimationFrame(gameLoop);
    }

    // Platform Lifecycle Callbacks (YouTube Playables SDK + Window Pause/Resume/Blur)
    function onPlatformPause() {
      sim.heldKeys.clear();
      if (sim.isPlatformPaused) return;
      sim.isPlatformPaused = true;
      audioRef.current.mute();
      if (sim.rafId) {
        cancelAnimationFrame(sim.rafId);
        sim.rafId = 0;
      }
      if (sim.state === 'PLAYING') {
        sim.state = 'PAUSED';
        setUiState('PAUSED');
      }
    }

    function onPlatformResume() {
      if (!sim.isPlatformPaused) return;
      sim.isPlatformPaused = false;
      sim.lastFrameTime = performance.now();
      if (!isMuted) {
        audioRef.current.unmute();
      }
      if (!sim.rafId) {
        sim.rafId = requestAnimationFrame(gameLoop);
      }
    }

    // Register YouTube Playables SDK lifecycle hooks
    try {
      if (typeof window !== 'undefined' && window.ytgame?.system) {
        window.ytgame.system.onPause?.(onPlatformPause);
        window.ytgame.system.onResume?.(onPlatformResume);
      }
    } catch (e) {
      console.warn('YT SDK lifecycle bind error:', e);
    }

    const handleVisibilityChange = () => {
      if (document.hidden) onPlatformPause();
      else onPlatformResume();
    };

    window.addEventListener('pause', onPlatformPause);
    window.addEventListener('resume', onPlatformResume);
    window.addEventListener('blur', onPlatformPause);
    window.addEventListener('focus', onPlatformResume);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Keyboard Input Listeners (Edge-Triggered vs Held Separation)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (sim.heldKeys.has(e.code)) return;
      sim.heldKeys.add(e.code);

      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        togglePause();
        return;
      }

      if (e.code === 'KeyM') {
        e.preventDefault();
        toggleMute();
        return;
      }

      if (
        e.code === 'Space' ||
        e.code === 'Enter' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown' ||
        e.code === 'KeyW' ||
        e.code === 'KeyS'
      ) {
        e.preventDefault();
        audioRef.current.init();

        if (sim.state === 'TITLE_MENU') {
          startGame();
        } else if (sim.state === 'PLAYING') {
          sim.justPressedSwitch = true;
          sim.inputBufferTimer = 0.1;
        } else if (sim.state === 'PAUSED' && e.code === 'Enter') {
          togglePause();
        } else if (sim.state === 'GAME_OVER' && sim.screenShake <= 0.8) {
          startGame();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      sim.heldKeys.delete(e.code);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Draw first frame immediately and invoke ytgame.game.firstFrameReady()
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) draw(ctx);
    }
    ytFirstFrameReady();

    sim.lastFrameTime = performance.now();
    sim.rafId = requestAnimationFrame(gameLoop);

    return () => {
      if (sim.rafId) cancelAnimationFrame(sim.rafId);
      window.removeEventListener('pause', onPlatformPause);
      window.removeEventListener('resume', onPlatformResume);
      window.removeEventListener('blur', onPlatformPause);
      window.removeEventListener('focus', onPlatformResume);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    executeLaneToggle,
    isMuted,
    spawnFloatingText,
    spawnParticles,
    startGame,
    toggleMute,
    togglePause,
    ytFirstFrameReady,
    ytSendScore,
  ]);

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const sim = simRef.current;
    if (sim.isPlatformPaused) return;

    audioRef.current.init();

    if (sim.state === 'TITLE_MENU') {
      startGame();
    } else if (sim.state === 'PLAYING') {
      sim.justPressedSwitch = true;
      sim.inputBufferTimer = 0.1;
    } else if (sim.state === 'GAME_OVER' && sim.screenShake <= 0.8) {
      startGame();
    }
  };

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#030308] flex items-center justify-center select-none">
      {/* Ambient Radial Cyberpunk Backdrop */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at center, #0c0a20 0%, #05040d 55%, #020205 100%)',
        }}
      />

      {/* Strict 9:16 Virtual Resolution (360x640) Scaling Viewport Container */}
      <div className="relative h-full max-h-screen aspect-[9/16] max-w-full flex items-center justify-center shadow-[0_0_45px_rgba(0,243,255,0.14)] border border-cyan-500/15 bg-[#05050d]">
        {/* Isolated 360x640 HTML5 Canvas */}
        <canvas
          ref={canvasRef}
          width={V_WIDTH}
          height={V_HEIGHT}
          onPointerDown={handleCanvasPointerDown}
          className="w-full h-full block cursor-pointer touch-none"
        />

        {/* LOW-OCCLUSION PERIMETER HUD OVERLAY (pointer-events-none, zero backdrop-filter) */}
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4">
          {/* Top Perimeter Bar */}
          <div className="flex items-start justify-between gap-2">
            {/* Left Cluster: Score & Best Readout */}
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-300/80 tracking-wider">
                <svg
                  className="w-3.5 h-3.5 text-cyan-400 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                >
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>SCORE</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-400">
                  BEST {hudBest}
                </span>
              </div>
              <div
                className="font-mono text-3xl font-bold tracking-tight text-white tabular-nums leading-none mt-1"
                style={{ textShadow: '0 0 14px rgba(0, 243, 255, 0.55)' }}
              >
                {hudScore}
              </div>
            </div>

            {/* Right Cluster: Controls & Telemetry */}
            <div className="flex items-center gap-1.5 pointer-events-auto">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={isMuted ? 'Unmute Audio' : 'Mute Audio'}
                className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#0b0a1a]/90 border border-cyan-500/25 text-cyan-300 hover:text-white hover:border-cyan-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              {uiState === 'PLAYING' || uiState === 'PAUSED' ? (
                <button
                  type="button"
                  onClick={togglePause}
                  aria-label={uiState === 'PAUSED' ? 'Resume Game' : 'Pause Game'}
                  className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#0b0a1a]/90 border border-cyan-500/25 text-cyan-300 hover:text-white hover:border-cyan-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                >
                  {uiState === 'PAUSED' ? (
                    <Play className="w-4 h-4" />
                  ) : (
                    <Pause className="w-4 h-4" />
                  )}
                </button>
              ) : null}
            </div>
          </div>

          {/* Bottom Perimeter Status Strip during Active Play */}
          {uiState === 'PLAYING' && (
            <div className="flex items-center justify-between text-xs text-slate-300/90 pt-2">
              <div className="flex items-center gap-2 font-mono tabular-nums">
                <span className="text-cyan-400 font-semibold">
                  {hudLane === 0 ? 'INNER RING' : 'OUTER RING'}
                </span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span>SPD {hudSpeedPct}%</span>
              </div>
              <div className="font-mono tabular-nums text-fuchsia-400 font-semibold">
                {hudStreak > 0 ? `WEAVE ×${hudStreak}` : 'TAP TO SWITCH'}
              </div>
            </div>
          )}
        </div>

        {/* TITLE SCREEN OVERLAY */}
        {uiState === 'TITLE_MENU' && (
          <div className="absolute inset-0 flex flex-col justify-between p-6 pointer-events-none bg-gradient-to-b from-[#030308]/80 via-transparent to-[#030308]/90">
            {/* Top Negative Space & Bespoke Inline SVG Title Lockup */}
            <div className="mt-10 flex flex-col items-center text-center">
              <svg
                className="w-64 h-24 overflow-visible"
                viewBox="0 0 280 95"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-label="Synapse Weaver"
              >
                <defs>
                  <linearGradient id="synapseGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="50%" stopColor="#00f3ff" />
                    <stop offset="100%" stopColor="#9d00ff" />
                  </linearGradient>
                </defs>
                {/* Decorative Neural Orbit Arcs */}
                <path
                  d="M 25 48 A 115 36 0 0 1 255 48"
                  stroke="#00f3ff"
                  strokeOpacity="0.28"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
                <circle cx="25" cy="48" r="3.5" fill="#00f3ff" />
                <circle cx="255" cy="48" r="3.5" fill="#ff007f" />
                <text
                  x="140"
                  y="44"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontFamily="var(--font-display), sans-serif"
                  fontWeight="800"
                  fontSize="36"
                  letterSpacing="3"
                >
                  SYNAPSE
                </text>
                <text
                  x="140"
                  y="76"
                  textAnchor="middle"
                  fill="url(#synapseGrad)"
                  fontFamily="var(--font-display), sans-serif"
                  fontWeight="700"
                  fontSize="24"
                  letterSpacing="6"
                >
                  WEAVER
                </text>
              </svg>
              <p className="text-xs text-slate-300 max-w-[240px] leading-relaxed mt-1">
                Orbit the neural pathway. Switch between concentric rings to weave past incoming corruption.
              </p>
            </div>

            {/* Bottom CTA & Single Flat Control-Hint Line */}
            <div className="mb-4 flex flex-col items-center gap-3 pointer-events-auto">
              <button
                type="button"
                onClick={startGame}
                className="w-full py-3.5 px-6 rounded-xl bg-cyan-400 hover:bg-cyan-300 active:scale-[0.99] text-slate-950 font-bold text-base tracking-wide shadow-[0_0_25px_rgba(0,243,255,0.4)] transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                Start Game
              </button>

              <button
                type="button"
                onClick={handleDownloadPlayable}
                className="w-full py-2 px-4 rounded-lg bg-[#0d0b1e] hover:bg-[#15122e] border border-cyan-500/25 text-xs font-medium text-cyan-300 flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {copiedBundle ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Downloaded Single-File Playable HTML</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Single-File YouTube Playable</span>
                  </>
                )}
              </button>

              <p className="text-[11px] text-slate-400 tracking-wide text-center whitespace-nowrap">
                Space / Tap Switch Lane · Esc Pause · M Mute
              </p>
            </div>
          </div>
        )}

        {/* PAUSE MODAL */}
        {uiState === 'PAUSED' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-[#04030c]/90 pointer-events-auto">
            <div className="w-full max-w-[280px] rounded-xl bg-[#0b091b] border border-cyan-500/30 p-6 flex flex-col items-center text-center shadow-2xl">
              <h2 className="text-2xl font-bold text-white tracking-tight">
                Game Paused
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Score {hudScore} · Speed {hudSpeedPct}%
              </p>

              <div className="w-full flex flex-col gap-2.5 mt-6">
                <button
                  type="button"
                  onClick={togglePause}
                  className="w-full py-2.5 px-4 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Resume Game</span>
                </button>

                <button
                  type="button"
                  onClick={startGame}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#14112c] hover:bg-[#1c183b] border border-slate-700 text-slate-200 font-medium text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Restart</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadPlayable}
                  className="w-full py-2 px-4 rounded-lg bg-[#0d0b1e] hover:bg-[#15122e] border border-cyan-500/20 text-xs font-medium text-cyan-300 flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Playable HTML</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* GAME OVER MODAL */}
        {uiState === 'GAME_OVER' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-[#05030d]/88 pointer-events-auto">
            <div className="w-full max-w-[290px] rounded-xl bg-[#0b091b] border border-fuchsia-500/35 p-6 flex flex-col items-center text-center shadow-2xl">
              <span className="text-xs font-semibold text-fuchsia-400 tracking-widest">
                SYNAPSE SEVERED
              </span>
              <h2 className="text-xl font-bold text-white mt-1">
                Neural Link Disrupted
              </h2>

              <div className="w-full my-5 py-4 px-3 rounded-lg bg-[#070612] border border-slate-800/80 flex flex-col items-center">
                <span className="text-[11px] text-slate-400">FINAL SCORE</span>
                <span
                  className="font-mono text-4xl font-extrabold text-white tabular-nums mt-1"
                  style={{ textShadow: '0 0 16px rgba(0, 243, 255, 0.5)' }}
                >
                  {hudScore}
                </span>
                <div className="flex items-center gap-2 text-xs text-cyan-300 mt-2 font-mono tabular-nums">
                  <span>BEST {hudBest}</span>
                  <span aria-hidden="true">·</span>
                  <span>STREAK ×{hudStreak}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={startGame}
                className="w-full py-3 px-5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-bold text-sm tracking-wide shadow-[0_0_20px_rgba(0,243,255,0.35)] transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                Play Again
              </button>

              <p className="text-[11px] text-slate-400 mt-3 whitespace-nowrap">
                Press Space or Tap to Reconnect
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
