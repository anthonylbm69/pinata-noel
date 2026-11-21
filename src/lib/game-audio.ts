"use client";
// Musique de fond et tic-tac du chrono, entièrement synthétisés (Web Audio) :
// aucun fichier à fournir, aucun droit d'auteur. Joués UNIQUEMENT par la télé.
//
//  - musique : petite boucle de Noël (basse, accords en clochettes, mélodie,
//    grelots), toujours au même tempo. Baissée pendant les questions.
//  - tic-tac : pendant toute la question, une fois par seconde, puis deux fois
//    par seconde sur les 5 dernières (plus fort sur les 3 dernières) ; petite
//    sonnerie quand le temps est écoulé.
//
// Les sons sont programmés sur l'horloge de l'AudioContext (pas sur les rendus
// React) : le tic-tac reste régulier même si la page rame un peu.

export type MusicMode = "off" | "calm" | "play";

const LOOKAHEAD = 0.15; // secondes programmées à l'avance
const STEPS = 64; // 4 mesures de 16 doubles-croches

// --- Partition (numéros MIDI) — boucle originale : C, Am, F, G ----------------
const MELODY: [step: number, note: number, len: number][] = [
  [0, 76, 2], [2, 79, 2], [4, 84, 2], [6, 79, 2], [8, 81, 2], [10, 79, 2], [12, 76, 4],
  [16, 72, 2], [18, 76, 2], [20, 81, 2], [22, 79, 2], [24, 76, 2], [26, 74, 2], [28, 72, 4],
  [32, 77, 2], [34, 81, 2], [36, 84, 2], [38, 81, 2], [40, 79, 2], [42, 77, 2], [44, 76, 2], [46, 74, 2],
  [48, 74, 2], [50, 79, 2], [52, 83, 2], [54, 86, 2], [56, 84, 4], [60, 79, 2], [62, 83, 2],
];
const BASS = [48, 45, 41, 43]; // une fondamentale par mesure
const CHORDS = [
  [64, 67, 72],
  [64, 69, 72],
  [65, 69, 72],
  [67, 71, 74],
];
// Moments du compte à rebours (secondes avant la fin) où l'horloge sonne.
const TICKS = [
  ...Array.from({ length: 56 }, (_, i) => 60 - i), // 60 … 5 : une fois par seconde
  4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0,
];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;

  private mode: MusicMode = "off";
  private enabled = true;
  private step = 0;
  private nextStepTime = 0;

  // compte à rebours (temps de l'AudioContext)
  private cdKey: string | null = null;
  private cdEnd = 0;
  private cdNext = 0; // prochain index dans TICKS

  /** À appeler depuis un clic / une touche : les navigateurs bloquent le son avant. */
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
  }

  /** Vrai si le navigateur attend encore un clic pour jouer du son. */
  get locked() {
    return !this.ctx || this.ctx.state !== "running";
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  setMusic(mode: MusicMode) {
    if (mode === this.mode) return;
    const ctx = this.ensure();
    const wasOff = this.mode === "off";
    this.mode = mode;
    if (!ctx) return;
    // pendant une question la musique passe en fond, on entend surtout le tic-tac
    const target = mode === "off" ? 0 : mode === "play" ? 0.2 : 0.6;
    this.music.gain.setTargetAtTime(target, ctx.currentTime, mode === "off" ? 0.15 : 0.3);
    if (wasOff && mode !== "off") {
      this.step = 0;
      this.nextStepTime = ctx.currentTime + 0.05;
    }
  }

  /**
   * Temps restant du chrono en cours (ms), ou null s'il n'y en a pas.
   * `key` identifie la question : un nouveau chrono repart de zéro.
   */
  setCountdown(remainingMs: number | null, key: string | null) {
    const ctx = this.ctx;
    if (remainingMs === null || !key) {
      this.cdKey = null;
      return;
    }
    if (!ctx) return;
    const end = ctx.currentTime + remainingMs / 1000;
    if (key !== this.cdKey) {
      this.cdKey = key;
      this.cdEnd = end;
      // on saute les tics déjà passés (télé rechargée en pleine question)
      this.cdNext = TICKS.findIndex((t) => t < remainingMs / 1000 - 0.05);
      if (this.cdNext < 0) this.cdNext = TICKS.length;
    } else if (Math.abs(end - this.cdEnd) > 0.15) {
      this.cdEnd = end; // recalage sur l'horloge de la base
    }
  }

  // --------------------------------------------------------------------------

  private ensure() {
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 1 : 0;
    this.master.connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = 0;
    this.music.connect(this.master);
    // bruit blanc (grelots, tic-tac)
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.nextStepTime = ctx.currentTime + 0.05;
    setInterval(() => this.schedule(), 25);
    return ctx;
  }

  private bpm() {
    return 100;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;

    // --- musique
    if (this.mode === "off") {
      this.nextStepTime = now + 0.05;
    } else {
      if (this.nextStepTime < now - 0.2) this.nextStepTime = now + 0.02; // onglet mis en veille
      while (this.nextStepTime < now + LOOKAHEAD) {
        this.playStep(this.step, this.nextStepTime);
        this.nextStepTime += 60 / this.bpm() / 4;
        this.step = (this.step + 1) % STEPS;
      }
    }

    // --- tic-tac
    if (this.cdKey) {
      while (this.cdNext < TICKS.length) {
        const t = this.cdEnd - TICKS[this.cdNext];
        if (t > now + LOOKAHEAD) break;
        if (t >= now - 0.05) {
          const left = TICKS[this.cdNext];
          if (left === 0) this.buzzer(Math.max(t, now));
          else this.tick(Math.max(t, now), this.cdNext % 2 === 0, left <= 3);
        }
        this.cdNext++;
      }
    }
  }

  private playStep(step: number, t: number) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const stepDur = 60 / this.bpm() / 4;

    // basse « oum-pa »
    if (s === 0 || s === 8) this.tone(t, midi(BASS[bar]), stepDur * 3, "triangle", 0.22);
    if (s === 4 || s === 12) this.tone(t, midi(BASS[bar] + 7), stepDur * 2, "triangle", 0.14);
    // accords en clochettes sur les contretemps
    if (s % 4 === 2) for (const n of CHORDS[bar]) this.bell(t, midi(n), 0.035);
    // mélodie
    for (const [st, n, len] of MELODY) {
      if (st === step) this.tone(t, midi(n), stepDur * len * 0.9, "square", 0.04, 2600);
    }
    // grelots
    if (s % 2 === 0) this.shaker(t, s % 4 === 0 ? 0.09 : 0.05);
  }

  private tone(t: number, freq: number, dur: number, type: OscillatorType, vol: number, lowpass?: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lowpass;
      osc.connect(f);
      node = f;
    }
    node.connect(g).connect(this.music);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private bell(t: number, freq: number, vol: number) {
    // sinus + harmonique aiguë, décroissance rapide = son de clochette
    this.tone(t, freq, 0.35, "sine", vol);
    this.tone(t, freq * 3, 0.12, "sine", vol * 0.25);
  }

  private shaker(t: number, vol: number, dest: AudioNode = this.music) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.08);
  }

  /** « tic » (aigu) / « tac » (plus grave), directement sur le master. */
  private tick(t: number, high: boolean, loud: boolean) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = high ? 3200 : 2000;
    f.Q.value = 8;
    const g = ctx.createGain();
    const vol = loud ? 1.6 : 1;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.05);
    // petit « bois » tonal pour qu'on l'entende bien sur une télé
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = high ? 1250 : 880;
    const og = ctx.createGain();
    og.gain.setValueAtTime(loud ? 0.3 : 0.18, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  /** Temps écoulé : petite sonnerie descendante. */
  private buzzer(t: number) {
    const ctx = this.ctx!;
    for (const [i, n] of [84, 79, 72].entries()) {
      const at = t + i * 0.12;
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = midi(n);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 3000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + (i === 2 ? 0.6 : 0.15));
      osc.connect(f).connect(g).connect(this.master);
      osc.start(at);
      osc.stop(at + 0.65);
    }
  }
}

let instance: GameAudio | null = null;
/** Moteur audio unique de la télé. */
export function gameAudio() {
  instance ??= new GameAudio();
  return instance;
}
