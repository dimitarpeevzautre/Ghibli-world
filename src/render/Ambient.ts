/**
 * Procedural ambient bed (gentle wind) synthesised with the Web Audio API — no audio assets.
 * Looping filtered noise with a slow LFO on the filter + gain gives a soft, gusting wind.
 * Must be started from a user gesture (autoplay policy), so `start()` is idempotent and called
 * on the first interaction.
 */
export class Ambient {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private started = false;
  private _volume = 0.25;

  /** Create the graph and begin playback. Safe to call repeatedly; only acts once. */
  start(): void {
    if (this.started || !this.enabled) return;
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.started = true;

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this._volume : 0;
    this.master.connect(ctx.destination);

    // Looping brown-ish noise buffer.
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.0;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 480;
    filter.Q.value = 0.7;

    const windGain = ctx.createGain();
    windGain.gain.value = 0.9;

    noise.connect(filter);
    filter.connect(windGain);
    windGain.connect(this.master);
    noise.start();

    // Slow gusts: LFOs modulating filter cutoff and gain.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.09;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.35;
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(windGain.gain);
    lfo2.start();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on && !this.started) this.start();
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? this._volume : 0, this.ctx.currentTime, 0.3);
    }
  }

  set volume(v: number) {
    this._volume = v;
    if (this.master && this.ctx && this.enabled) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
    }
  }
  get volume(): number {
    return this._volume;
  }
}
