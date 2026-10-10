/**
 * Audio (GAME_DESIGN §10, ARCHITECTURE §4.8): AudioContext, master / duck gains, mute; a sound
 * file first (discovered at build time), the procedural recipe otherwise.
 *
 * Signal path: sound → its own gain → duck (TO_TITLE fade to 30 %) → master (0.8, or 0 muted) → out.
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

/** Build-time discovery: only files that exist are listed, so there are no runtime 404s. */
const GLOB = import.meta.glob('../assets/sfx/*.{mp3,ogg,wav}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

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

  constructor(glob: Record<string, string> = GLOB) {
    this.sources = resolveSfxSources(glob);
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
}
