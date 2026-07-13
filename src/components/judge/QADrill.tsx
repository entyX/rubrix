'use client';

/**
 * The Q&A drill.
 *
 * The first grade cannot score "answers the judge's questions" — nobody asked the student
 * anything. So instead of quietly zeroing it (or quietly skipping it), we ASK. Three ways in:
 *
 *   1. Type it.
 *   2. Dictate it — Web Speech API, so voice-to-text runs on-device in the browser.
 *   3. Record it — audio only, transcribed server-side, same privacy rule as everything else.
 *
 * Answer all of them, hit the judge, and those criteria get scored for real.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { QAJSON } from '@/lib/ai/schemas';

type Mode = 'type' | 'record';

interface Answer {
  text: string;
  clip: Blob | null;
  clipSeconds: number;
}

// Web Speech API is not in TS's DOM lib. Narrow shim — no `any`.
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
}
type SpeechCtor = new () => SpeechRecognitionLike;

function getSpeechCtor(): SpeechCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function QADrill({
  qa,
  onSubmit,
  submitting,
}: {
  qa: QAJSON;
  onSubmit: (answers: Answer[]) => void;
  submitting: boolean;
}) {
  const [answers, setAnswers] = useState<Answer[]>(() =>
    qa.questions.map(() => ({ text: '', clip: null, clipSeconds: 0 })),
  );
  const [mode, setMode] = useState<Mode[]>(() => qa.questions.map(() => 'type'));
  const [dictating, setDictating] = useState<number | null>(null);
  const [recording, setRecording] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Feature detection, done the way React wants it: a server snapshot of `false` and a
  // client snapshot of the real answer. No setState-in-an-effect, no hydration mismatch.
  const speechSupported = useSyncExternalStore(
    () => () => {},
    () => getSpeechCtor() !== null,
    () => false,
  );

  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      recogRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  const setAnswer = (i: number, patch: Partial<Answer>) =>
    setAnswers((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // ── dictate (on-device speech-to-text)
  const toggleDictate = useCallback(
    (i: number) => {
      if (dictating === i) {
        recogRef.current?.stop();
        return;
      }
      const Ctor = getSpeechCtor();
      if (!Ctor) return;

      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      const base = answers[i].text;
      rec.onresult = (e) => {
        let chunk = '';
        for (let k = e.resultIndex; k < e.results.length; k++) {
          chunk += e.results[k][0].transcript;
        }
        setAnswer(i, { text: (base ? `${base} ` : '') + chunk });
      };
      rec.onend = () => setDictating(null);

      recogRef.current = rec;
      rec.start();
      setDictating(i);
    },
    [answers, dictating],
  );

  // ── record an answer (audio only)
  const toggleRecord = useCallback(
    async (i: number) => {
      if (recording === i) {
        recRef.current?.stop();
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const rec = new MediaRecorder(stream);
        chunksRef.current = [];
        const startedAt = Date.now();

        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        rec.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType });
          stream.getTracks().forEach((t) => t.stop());
          setAnswer(i, {
            clip: blob,
            clipSeconds: Math.round((Date.now() - startedAt) / 1000),
            text: '', // the server transcribes it; keep the box clear so it's obvious which won
          });
          setRecording(null);
        };
        recRef.current = rec;
        rec.start();
        setRecording(i);
        setElapsed(0);
        timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      } catch {
        /* mic denied — the type box still works */
      }
    },
    [recording],
  );

  const answered = answers.filter((a) => a.text.trim() !== '' || a.clip !== null).length;
  const allAnswered = answered === qa.questions.length;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="nb bg-[var(--violet)] p-5">
        <h3 className="display text-[22px] leading-tight">THE JUDGE HAS QUESTIONS.</h3>
        <p className="mt-2 text-[15px] font-semibold leading-relaxed">
          Your run wasn’t scored on answering questions — nobody asked you any. Answer these and
          the judge will score that part properly. Type, dictate, or record each answer.
        </p>
        <p className="mono mt-3 text-[13px] font-bold">
          {answered} / {qa.questions.length} answered
        </p>
      </div>

      {qa.questions.map((q, i) => {
        const a = answers[i];
        const m = mode[i];
        const isDictating = dictating === i;
        const isRecording = recording === i;

        return (
          <article key={i} className="nb bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[16px] font-bold leading-snug">
                <span className="mono mr-2 opacity-50">Q{i + 1}</span>
                {q.question}
              </p>
              <span className="tag shrink-0 bg-[var(--yellow)]">{q.difficulty}</span>
            </div>

            {/* mode switch */}
            <div className="mt-4 flex flex-wrap gap-2">
              {(['type', 'record'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setMode((ms) => ms.map((x, j) => (j === i ? k : x)))}
                  className="nb-btn px-3 py-1.5 text-[11px]"
                  style={{
                    background: m === k ? 'var(--ink)' : '#fff',
                    color: m === k ? '#fff' : 'var(--ink)',
                  }}
                >
                  {k === 'type' ? 'Type / dictate' : 'Record answer'}
                </button>
              ))}
            </div>

            {m === 'type' ? (
              <>
                <textarea
                  value={a.text}
                  onChange={(e) => setAnswer(i, { text: e.target.value, clip: null })}
                  rows={4}
                  maxLength={1200}
                  placeholder="Answer out loud first, then write what you actually said."
                  className="nb-flat mt-3 w-full resize-y bg-[var(--paper)] p-3 text-[15px] leading-relaxed"
                />
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {speechSupported && (
                    <button
                      onClick={() => toggleDictate(i)}
                      className="nb-btn px-3 py-1.5 text-[11px]"
                      style={{ background: isDictating ? 'var(--pink)' : 'var(--cyan)' }}
                    >
                      {isDictating ? '● Listening — stop' : '🎤 Dictate'}
                    </button>
                  )}
                  <span className="mono text-[11px] font-bold opacity-50">
                    {a.text.length}/1200
                  </span>
                  {!speechSupported && (
                    <span className="text-[11px] font-semibold opacity-50">
                      Dictation needs Chrome or Edge — typing works everywhere.
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-3">
                <button
                  onClick={() => void toggleRecord(i)}
                  className="nb-btn w-full px-4 py-3 text-[14px]"
                  style={{ background: isRecording ? 'var(--pink)' : 'var(--lime)' }}
                >
                  {isRecording
                    ? `● Recording ${mmss(elapsed)} — stop`
                    : a.clip
                      ? `Re-record (${mmss(a.clipSeconds)} saved)`
                      : 'Record your answer'}
                </button>
                {a.clip && !isRecording && (
                  <p className="mt-2 text-[13px] font-semibold">
                    ✓ {mmss(a.clipSeconds)} recorded. We’ll transcribe it and the judge will read
                    what you actually said.
                  </p>
                )}
              </div>
            )}
          </article>
        );
      })}

      <button
        onClick={() => onSubmit(answers)}
        disabled={!allAnswered || submitting}
        className="nb-btn sticky bottom-4 bg-[var(--lime)] px-6 py-4 text-[16px]"
      >
        {submitting
          ? 'Judging your answers…'
          : allAnswered
            ? 'Send answers to the judge'
            : `Answer all ${qa.questions.length} questions first`}
      </button>
    </div>
  );
}

export type { Answer };
