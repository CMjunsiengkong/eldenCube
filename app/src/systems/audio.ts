/**
 * Audio (GAME_DESIGN §10, ARCHITECTURE §4.8): AudioContext, master / duck gains, mute; a sound
 * file first (discovered at build time), the procedural recipe otherwise.
 *
 * Signal path: sound → its own gain → duck (TO_TITLE fade to 30 %) → master (0.8, or 0 muted) → out.
 * Background music (1.5c): optional `assets/bgm/bgm.*` file → loop at `CONFIG.audio.bgm.rate` →
 * music gain → master. Fight only (GD §10); no generated fallback.
 * Before `unlock()` (the first key press or click), every `play()` is silently ignored.
 */
import { CONFIG } from '../config';
import type { SoundHandle, SoundId, SoundOptions, SoundSink } from '../attacks/Attack';
import { playRecipe } from './sfx';

export type SfxId = SoundId;

/** All 22 sound IDs (ASSETS.md §1.1). */
export const SFX_IDS = Object.keys(CONFIG.audio.volume) as SfxId[];

const EXT_PRIORITY = ['mp3', 'ogg', 'wav'] as const;

/**
 * Pure: maps the build-time glob result (`path → url`) to `id → url`. The file's base name
 * (without extension) must be a known sound ID; mp3 beats ogg beats wav; unknown names are ignored
 * and reported with one `console.info`.
 */
export function resolveSfxSources(glob: Record<string, string>, info: (msg: string) => void = console.info): Map<SfxId, string> {
  const known = new Set<string>(SFX_IDS);
  const best = new Map<SfxId, { url: string; rank: number }>();
  const unknown: string[] = [];
  for (const [path, url] of Object.entries(glob)) {
    const file = path.split('/').pop() ?? path;
    const dot = file.lastIndexOf('.');
    const base = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : '';
    const rank = (EXT_PRIORITY as readonly string[]).indexOf(ext);
    if (!known.has(base) || rank < 0) {
      unknown.push(file);
      continue;
    }
    const id = base as SfxId;
    const cur = best.get(id);
    if (!cur || rank < cur.rank) best.set(id, { url, rank });
  }
  if (unknown.length > 0) info(`[audio] ignoring unknown sound files: ${unknown.join(', ')}`);
  const out = new Map<SfxId, string>();
  for (const [id, v] of best) out.set(id, v.url);
  return out;
}

/** Pure: the URL of the `bgm` music file (mp3 > ogg > wav), or null. Other names are ignored. */
export function resolveBgmSource(glob: Record<string, string>): string | null {
  let best: { url: string; rank: number } | null = null;
  for (const [path, url] of Object.entries(glob)) {
    const file = (path.split('/').pop() ?? path).toLowerCase();
    const dot = file.lastIndexOf('.');
    if (dot <= 0 || file.slice(0, dot) !== 'bgm') continue;
    const rank = (EXT_PRIORITY as readonly string[]).indexOf(file.slice(dot + 1));
    if (rank >= 0 && (!best || rank < best.rank)) best = { url, rank };
  }
  return best?.url ?? null;
}

/** Build-time discovery: only files that exist are listed, so there are no runtime 404s. */
const GLOB = import.meta.glob('../assets/sfx/*.{mp3,ogg,wav}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const BGM_GLOB = import.meta.glob('../assets/bgm/*.{mp3,ogg,wav}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const MB = CONFIG.audio.bgm;

const NO_HANDLE: SoundHandle = { stop: () => undefined };

export class Audio implements SoundSink {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private duck: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly buffers = new Map<SfxId, AudioBuffer>();
  private readonly sources: Map<SfxId, string>;
  private mutedFlag = false;
  private unlocking = false;
  // Background music
  private readonly bgmUrl: string | null;
  private bgmBuffer: AudioBuffer | null = null;
  private musicGain: GainNode | null = null;
  private musicSrc: AudioBufferSourceNode | null = null;
  /** The fight wants music (it may start late if the file is still decoding). */
  private musicWanted = false;

  constructor(glob: Record<string, string> = GLOB, bgmGlob: Record<string, string> = BGM_GLOB) {
    this.sources = resolveSfxSources(glob);
    this.bgmUrl = resolveBgmSource(bgmGlob);
  }

  /** GD §10: the fight starts — the track starts from the beginning and fades in. */
  startMusic(): void {
    this.musicWanted = true;
    this.beginMusic();
  }

  /** GD §10: death or victory — fade out and stop. */
  fadeOutMusic(): void {
    this.musicWanted = false;
    const ctx = this.ctx;
    const src = this.musicSrc;
    const g = this.musicGain;
    if (!ctx || !src || !g) return;
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + MB.fadeOut);
    try {
      src.stop(t + MB.fadeOut + 0.05);
    } catch {
      // already stopped
    }
    this.musicSrc = null;
  }

  /** Reset: stop at once. */
  stopMusic(): void {
    this.musicWanted = false;
    try {
      this.musicSrc?.stop();
    } catch {
      // already stopped
    }
    this.musicSrc = null;
  }

  /** Pause overlay: the music drops to 30 % and comes back on resume. */
  setMusicPaused(paused: boolean): void {
    const ctx = this.ctx;
    const g = this.musicGain;
    if (!ctx || !g || !this.musicSrc) return;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setTargetAtTime(MB.volume * (paused ? MB.pausedLevel : 1), ctx.currentTime, 0.1);
  }

  get musicPlaying(): boolean {
    return this.musicSrc !== null;
  }

  private beginMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.bgmBuffer || !this.musicGain || !this.musicWanted || this.musicSrc) return;
    const src = ctx.createBufferSource();
    src.buffer = this.bgmBuffer;
    src.loop = true;
    src.playbackRate.value = MB.rate;
    src.connect(this.musicGain);
    const t = ctx.currentTime;
    const g = this.musicGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(MB.volume, t + MB.fadeIn);
    src.start();
    this.musicSrc = src;
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Creates or resumes the AudioContext (call from the first key / click handler). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const ctx = new AudioContext();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.mutedFlag ? 0 : CONFIG.audio.masterVolume;
        this.master.connect(ctx.destination);
        this.duck = ctx.createGain();
        this.duck.connect(this.master);
        this.musicGain = ctx.createGain();
        this.musicGain.gain.value = 0;
        this.musicGain.connect(this.master);
        const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = n.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.noise = n;
        void this.loadFiles(ctx);
      }
      if (this.ctx.state === 'suspended' && !this.unlocking) {
        this.unlocking = true;
        void this.ctx.resume().finally(() => {
          this.unlocking = false;
        });
      }
    } catch {
      // No audio on this device: the game continues silently.
      this.ctx = null;
    }
  }

  /** `M`: master 0.8 ↔ 0. Returns the new muted state. */
  toggleMute(): boolean {
    this.mutedFlag = !this.mutedFlag;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.mutedFlag ? 0 : CONFIG.audio.masterVolume, this.ctx.currentTime, 0.01);
    return this.mutedFlag;
  }

  /** TO_TITLE fade: 1 = normal, 0.3 = ducked. */
  setDuck(factor: number): void {
    if (this.duck) this.duck.gain.value = factor;
  }

  play(id: SoundId, opts: SoundOptions = {}): SoundHandle {
    const ctx = this.ctx;
    if (!ctx || !this.duck || !this.noise || ctx.state !== 'running') return NO_HANDLE;
    try {
      const buf = this.buffers.get(id);
      if (buf) return this.playBuffer(ctx, buf, id, opts);
      return playRecipe(id, ctx, this.duck, this.noise, opts);
    } catch {
      return NO_HANDLE;
    }
  }

  private playBuffer(ctx: AudioContext, buf: AudioBuffer, id: SfxId, opts: SoundOptions): SoundHandle {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.pitch ?? 1;
    const g = ctx.createGain();
    g.gain.value = CONFIG.audio.volume[id] * (opts.volume ?? 1);
    src.connect(g);
    g.connect(this.duck!);
    src.start();
    let stopped = false;
    return {
      stop: () => {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0, t, 0.005);
        try {
          src.stop(t + 0.03);
        } catch {
          // already ended
        }
      },
    };
  }

  /** Fetches and decodes every found file; a failure warns once and keeps that sound's recipe. */
  private async loadFiles(ctx: AudioContext): Promise<void> {
    if (this.bgmUrl) void this.loadMusic(ctx, this.bgmUrl);
    await Promise.all(
      [...this.sources].map(async ([id, url]) => {
        try {
          const res = await fetch(url);
          const data = await res.arrayBuffer();
          this.buffers.set(id, await ctx.decodeAudioData(data));
        } catch {
          console.warn(`[audio] could not load ${id} (${url}); using the generated sound`);
        }
      }),
    );
  }

  /** Decodes the music; if the fight already started, the music starts now (with its fade-in). */
  private async loadMusic(ctx: AudioContext, url: string): Promise<void> {
    try {
      const res = await fetch(url);
      this.bgmBuffer = await ctx.decodeAudioData(await res.arrayBuffer());
      this.beginMusic();
    } catch {
      console.warn(`[audio] could not load the background music (${url}); playing without music`);
    }
  }
}
