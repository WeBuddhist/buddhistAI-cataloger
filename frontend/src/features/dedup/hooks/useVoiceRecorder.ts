// Records the microphone as 16 kHz mono WAV, the format the Monlam STT trial was run with.
import { useCallback, useEffect, useRef, useState } from 'react';

const SAMPLE_RATE = 16000;

/** One WAV from one or more recordings, played one after another. */
export function toWav(chunks: Float32Array[]): Blob {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const s = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

interface Session {
  stream: MediaStream;
  ctx: AudioContext;
  chunks: Float32Array[];
}

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const session = useRef<Session | null>(null);

  const release = useCallback(() => {
    const s = session.current;
    session.current = null;
    if (!s) return;
    s.stream.getTracks().forEach((t) => t.stop());
    if (s.ctx.state !== 'closed') void s.ctx.close();
  }, []);

  // Never leave the microphone on when the note form closes.
  useEffect(() => release, [release]);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    try {
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      const chunks: Float32Array[] = [];
      // ScriptProcessor is deprecated but needs no separate worklet file; fine for short notes.
      const node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => chunks.push(e.inputBuffer.getChannelData(0).slice(0));
      ctx.createMediaStreamSource(stream).connect(node);
      node.connect(ctx.destination); // onaudioprocess only fires when connected; the output is silent
      session.current = { stream, ctx, chunks };
      setRecording(true);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      throw err;
    }
  }, []);

  /** Stops the microphone; the recording's samples, or null if nothing was captured. */
  const stop = useCallback((): Float32Array | null => {
    const chunks = session.current?.chunks ?? [];
    release();
    setRecording(false);
    if (chunks.length === 0) return null;
    const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      samples.set(c, offset);
      offset += c.length;
    }
    return samples;
  }, [release]);

  const cancel = useCallback(() => {
    release();
    setRecording(false);
  }, [release]);

  return { recording, start, stop, cancel };
}
