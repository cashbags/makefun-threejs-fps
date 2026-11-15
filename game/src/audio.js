// Procedural sound, no audio files: every effect is a few oscillators and filtered
// noise through one AudioContext. If the browser refuses audio, everything no-ops.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBurst(seconds, filterFreq, gainValue) {
    if (!ensure()) return;
    try {
      const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      const gain = ctx.createGain();
      gain.gain.value = gainValue;
      source.connect(filter).connect(gain).connect(master);
      source.start();
    } catch {
      // Audio is decoration; a failure never stops the game.
    }
  }

  function tone(freq, seconds, gainValue, type = 'sine') {
    if (!ensure()) return;
    try {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(gainValue, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
      osc.connect(gain).connect(master);
      osc.start();
      osc.stop(ctx.currentTime + seconds);
    } catch {
      // Audio is decoration; a failure never stops the game.
    }
  }

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    shot() {
      noiseBurst(0.09, 2400, 0.5);
      tone(140, 0.07, 0.25, 'square');
    },
    enemyShot() {
      noiseBurst(0.07, 1600, 0.18);
    },
    hit() {
      tone(1200, 0.05, 0.2, 'sine');
    },
    kill() {
      tone(880, 0.08, 0.25, 'sine');
      setTimeout(() => tone(1320, 0.1, 0.25, 'sine'), 70);
    },
    reload() {
      tone(500, 0.05, 0.15, 'square');
      setTimeout(() => tone(700, 0.05, 0.15, 'square'), 160);
    },
    plant() {
      tone(660, 0.12, 0.25, 'sine');
      setTimeout(() => tone(990, 0.18, 0.25, 'sine'), 140);
    },
    explosion() {
      noiseBurst(0.7, 500, 0.8);
      tone(55, 0.6, 0.5, 'sine');
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.25, 'sine'), i * 110));
    },
    roundLoss() {
      [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.18, 0.22, 'sine'), i * 130));
    },
  };
}
