import { useCallback, useRef } from 'react';

/**
 * Web Audio API notification sound generator.
 * No external audio files — everything is synthesised in the browser.
 *
 *  • Customer sound: soft, elegant chime (sine wave, gentle, short)
 *  • Driver sound: loud, urgent alarm (square wave, dual-tone, strong)
 */

export function useNotificationSound() {
  const ctxRef = useRef<AudioContext | null>(null);
  const hasInteractedRef = useRef(false);

  const ensureContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;

    if (!ctxRef.current) {
      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      if (!Ctx) return null;
      ctxRef.current = new Ctx();
    }

    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') {
      // Browsers block AudioContext until user interaction.
      // We try to resume; if it fails the sound simply won't play yet.
      ctx.resume().catch(() => {
        // ignored — will resume on next interaction
      });
    }
    return ctx;
  }, []);

  /** Elegant, soft chime for customers */
  const playCustomerSound = useCallback(() => {
    const ctx = ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Main tone — sine wave, A5 -> C#6 glide, gentle envelope
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now); // A5
    osc.frequency.exponentialRampToValueAtTime(1109, now + 0.12); // C#6

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02); // soft attack
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45); // gentle decay

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.5);

    // Second harmonic — adds "sparkle" without being loud
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, now); // E6
    osc2.frequency.exponentialRampToValueAtTime(1661, now + 0.12); // G#6

    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(0.06, now + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc2.start(now + 0.02);
    osc2.stop(now + 0.4);
  }, [ensureContext]);

  /** Loud, urgent dual-tone alarm for drivers */
  const playDriverSound = useCallback(() => {
    const ctx = ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const duration = 1.2;

    // Low tone — 400Hz square
    const oscLow = ctx.createOscillator();
    const gainLow = ctx.createGain();

    oscLow.type = 'square';
    oscLow.frequency.setValueAtTime(400, now);

    gainLow.gain.setValueAtTime(0, now);
    gainLow.gain.linearRampToValueAtTime(0.35, now + 0.02);
    gainLow.gain.setValueAtTime(0.35, now + 0.2);
    gainLow.gain.linearRampToValueAtTime(0, now + 0.35);

    oscLow.connect(gainLow);
    gainLow.connect(ctx.destination);

    oscLow.start(now);
    oscLow.stop(now + 0.4);

    // High tone — 800Hz square, staggered
    const oscHigh = ctx.createOscillator();
    const gainHigh = ctx.createGain();

    oscHigh.type = 'square';
    oscHigh.frequency.setValueAtTime(800, now + 0.25);

    gainHigh.gain.setValueAtTime(0, now + 0.25);
    gainHigh.gain.linearRampToValueAtTime(0.35, now + 0.27);
    gainHigh.gain.setValueAtTime(0.35, now + 0.45);
    gainHigh.gain.linearRampToValueAtTime(0, now + 0.6);

    oscHigh.connect(gainHigh);
    gainHigh.connect(ctx.destination);

    oscHigh.start(now + 0.25);
    oscHigh.stop(now + 0.65);

    // Second cycle — repeat for urgency
    const oscLow2 = ctx.createOscillator();
    const gainLow2 = ctx.createGain();

    oscLow2.type = 'square';
    oscLow2.frequency.setValueAtTime(400, now + 0.6);

    gainLow2.gain.setValueAtTime(0, now + 0.6);
    gainLow2.gain.linearRampToValueAtTime(0.35, now + 0.62);
    gainLow2.gain.setValueAtTime(0.35, now + 0.8);
    gainLow2.gain.linearRampToValueAtTime(0, now + 0.95);

    oscLow2.connect(gainLow2);
    gainLow2.connect(ctx.destination);

    oscLow2.start(now + 0.6);
    oscLow2.stop(now + 0.95);

    const oscHigh2 = ctx.createOscillator();
    const gainHigh2 = ctx.createGain();

    oscHigh2.type = 'square';
    oscHigh2.frequency.setValueAtTime(800, now + 0.85);

    gainHigh2.gain.setValueAtTime(0, now + 0.85);
    gainHigh2.gain.linearRampToValueAtTime(0.35, now + 0.87);
    gainHigh2.gain.setValueAtTime(0.35, now + 1.05);
    gainHigh2.gain.linearRampToValueAtTime(0, now + 1.2);

    oscHigh2.connect(gainHigh2);
    gainHigh2.connect(ctx.destination);

    oscHigh2.start(now + 0.85);
    oscHigh2.stop(now + 1.2);

    // Sub-bass for extra "punch"
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();

    sub.type = 'sine';
    sub.frequency.setValueAtTime(80, now);

    subGain.gain.setValueAtTime(0, now);
    subGain.gain.linearRampToValueAtTime(0.25, now + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    sub.connect(subGain);
    subGain.connect(ctx.destination);

    sub.start(now);
    sub.stop(now + 0.55);
  }, [ensureContext]);

  /**
   * Call once on first user interaction (click / touch) to unlock the
   * AudioContext on mobile browsers.
   */
  const unlockAudio = useCallback(() => {
    if (hasInteractedRef.current) return;
    hasInteractedRef.current = true;
    const ctx = ensureContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {
        // ignored
      });
    }
  }, [ensureContext]);

  return { playCustomerSound, playDriverSound, unlockAudio };
}