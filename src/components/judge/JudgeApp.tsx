'use client';

/**
 * The judge panel for one event.
 *
 * PRIVACY, enforced here (CLAUDE.md, non-negotiable):
 *   The camera preview is a mirror FOR YOU. It is never recorded and never uploaded.
 *   Only the audio track is captured; any video file you drop is decoded to mp3 on this
 *   machine by ffmpeg.wasm. The video never touches our servers.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Report, type RunResult } from './Report';
import { QADrill, type Answer } from './QADrill';
import { RubricReview } from './RubricReview';
import type { CatalogEvent } from '@/lib/rubrics/types';

type Phase = 'idle' | 'preparing' | 'grading' | 'done' | 'qa' | 'qa-grading' | 'failed';

const STAGES = [
  { key: 'transcribing', label: 'Transcribing your run' },
  { key: 'judging', label: 'Judging against the rubric' },
  { key: 'qa', label: 'Writing your Q&A grill' },
] as const;

export function JudgeApp({ event }: { event: CatalogEvent }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [prepLabel, setPrepLabel] = useState('');
  const [prepRatio, setPrepRatio] = useState<number | null>(null);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [run, setRun] = useState<RunResult | null>(null);

  const [reviewed, setReviewed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [camOn, setCamOn] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Only a HUMAN-CONFIRMED rubric may grade anyone (plan.md F3).
  const parsed = event.rubric !== null;
  const confirmed = event.rubric_status === 'confirmed' || reviewed;

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => stopTracks, [stopTracks]);

  const grade = useCallback(
    async (mp3: Blob) => {
      setPhase('grading');
      setStage('transcribing');

      const body = new FormData();
      body.append('audio', new File([mp3], 'run.mp3', { type: 'audio/mpeg' }));
      body.append('rubricId', event.rubric ?? '');
      body.append('eventName', event.name);
      body.append('org', event.org);
      if (event.time_limit_s) body.append('timeLimitS', String(event.time_limit_s));

      const res = await fetch('/api/grade', { method: 'POST', body });
      if (!res.ok || !res.body) {
        // 413 comes from the hosting platform, not our code, so there's no JSON body to
        // read — say something useful rather than "something broke".
        if (res.status === 413) {
          setError(
            'That recording is too large to upload. Keep a practice run under ~18 minutes, or split it and grade the halves separately.',
          );
          setPhase('failed');
          return;
        }
        const j = await res.json().catch(() => null);
        setError(j?.error?.message ?? 'Something broke on our end. It’s logged and we’re on it.');
        setPhase('failed');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as { stage: string; message?: string; result?: RunResult };
          if (msg.stage === 'failed') {
            setError(msg.message ?? 'The judge stumbled on this one.');
            setPhase('failed');
            return;
          }
          if (msg.stage === 'done' && msg.result) {
            setRun(msg.result);
            setPhase('done');
            return;
          }
          if (STAGES.some((s) => s.key === msg.stage)) setStage(msg.stage);
        }
      }
    },
    [event],
  );

  /** Any file -> mp3, in the browser. The video never leaves this machine. */
  const handleFile = useCallback(
    async (file: File) => {
      setError('');
      setPhase('preparing');
      setPrepLabel(
        file.type.startsWith('video/')
          ? 'Pulling the audio out of your video, right here on your device'
          : 'Preparing your audio',
      );
      try {
        const { extractAudio } = await import('@/lib/audio/extractAudio'); // §11.7: lazy, judge only
        const mp3 = await extractAudio(file, (p) => setPrepRatio(p.ratio));
        await grade(mp3);
      } catch (err) {
        const msg = err instanceof Error ? err.message.split('\n')[0] : '';
        // extractAudio throws a written-for-humans message when the run is too long.
        // Don't bury it under a generic "couldn't process that file".
        setError(
          msg.startsWith('That run is')
            ? msg
            : `We couldn't process that file. Try re-exporting it as an mp4 or mp3.${msg ? ` (${msg})` : ''}`,
        );
        setPhase('failed');
      }
    },
    [grade],
  );

  const startRecording = useCallback(async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: camOn ? { width: 1280, height: 720 } : false,
      });
      streamRef.current = stream;
      if (videoRef.current && camOn) videoRef.current.srcObject = stream;

      // THE PRIVACY LINE: the recorder is built over an AUDIO-ONLY stream. The camera
      // feed is a mirror for the student; not one frame of it is captured.
      const rec = new MediaRecorder(new MediaStream(stream.getAudioTracks()));
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        stopTracks();
        setRecording(false);
        void handleFile(new File([blob], 'take.webm', { type: rec.mimeType }));
      };
      recorderRef.current = rec;
      rec.start();

      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch {
      setError('We couldn’t reach your microphone. Check your browser permissions and try again.');
    }
  }, [camOn, handleFile, stopTracks]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  /** The student answered the judge's questions — re-grade with them attached. */
  const submitAnswers = useCallback(
    async (answers: Answer[]) => {
      if (!run) return;
      setPhase('qa-grading');
      setError('');

      const body = new FormData();
      body.append(
        'payload',
        JSON.stringify({
          rubricId: event.rubric,
          eventName: event.name,
          org: event.org,
          timeLimitS: event.time_limit_s,
          transcript: run.transcript,
          durationS: run.metrics.duration_s,
          answers: run.qa.questions.map((q, i) => ({
            question: q.question,
            // A recorded answer is transcribed server-side; send a placeholder so the
            // shape validates, and the server overwrites it with the real transcript.
            answer: answers[i].clip ? '(spoken answer — transcribing)' : answers[i].text,
          })),
        }),
      );
      answers.forEach((a, i) => {
        if (a.clip) body.append(`audio_${i}`, new File([a.clip], `a${i}.webm`, { type: a.clip.type }));
      });

      const res = await fetch('/api/qa-grade', { method: 'POST', body });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        setError(j?.error?.message ?? 'The judge stumbled on your answers.');
        setPhase('qa');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as {
            stage: string;
            message?: string;
            result?: Omit<RunResult, 'qa'>;
          };
          if (msg.stage === 'failed') {
            setError(msg.message ?? 'The judge stumbled on your answers.');
            setPhase('qa');
            return;
          }
          if (msg.stage === 'done' && msg.result) {
            // Keep the questions around so the report can still show them.
            setRun({ ...msg.result, qa: run.qa });
            setPhase('done');
            return;
          }
        }
      }
    },
    [run, event],
  );

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const reset = () => {
    setRun(null);
    setPhase('idle');
    setPrepRatio(null);
    setError('');
  };

  // ── the F3 gate: a machine-parsed rubric must be checked by a human first.
  if (parsed && !confirmed) {
    return (
      <div className="flex flex-col gap-4">
        <EventHeader event={event} status="Needs review" />
        <RubricReview event={event} onConfirmed={() => setReviewed(true)} />
      </div>
    );
  }

  // ── Q&A drill
  if (phase === 'qa' && run) {
    return (
      <div className="flex flex-col gap-4">
        <EventHeader event={event} status="Q&A drill" />
        {error && (
          <div className="nb bg-[var(--pink)] p-4 text-[15px] font-bold" role="alert">
            {error}
          </div>
        )}
        <QADrill qa={run.qa} onSubmit={(a) => void submitAnswers(a)} submitting={false} />
      </div>
    );
  }

  // ── report
  if (phase === 'done' && run) {
    return (
      <Report
        run={run}
        event={event}
        onAgain={reset}
        onAnswerQuestions={
          run.validation.not_assessable_points > 0 ? () => setPhase('qa') : undefined
        }
      />
    );
  }

  // ── judging the Q&A answers
  if (phase === 'qa-grading') {
    return (
      <div className="nb nb-lg bg-white p-6 sm:p-8">
        <p className="display text-[13px] uppercase tracking-wider opacity-60">
          Your answers are with the judge
        </p>
        <p className="display mt-4 text-[24px] leading-tight">
          Judging your answers<span className="blink">…</span>
        </p>
      </div>
    );
  }

  // ── working
  if (phase === 'preparing' || phase === 'grading') {
    const activeIdx = STAGES.findIndex((s) => s.key === stage);
    return (
      <div className="nb nb-lg bg-white p-6 sm:p-8">
        <p className="display text-[13px] uppercase tracking-wider opacity-60">
          Your run is with the judge
        </p>

        {phase === 'preparing' ? (
          <>
            <p className="display mt-4 text-[24px] leading-tight">
              {prepLabel}
              <span className="blink">_</span>
            </p>
            {prepRatio !== null && (
              <div className="nb-bar mt-5 h-5">
                <span
                  style={{ width: `${Math.round(prepRatio * 100)}%`, background: 'var(--cyan)' }}
                />
              </div>
            )}
            <p className="mt-4 text-[13px] font-semibold opacity-70">
              This is happening on your device. Your video is not being uploaded.
            </p>
          </>
        ) : (
          <ul className="mt-6 flex flex-col gap-3">
            {STAGES.map((s, i) => {
              const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'todo';
              return (
                <li key={s.key} className="flex items-center gap-3">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center border-[3px] border-black"
                    style={{
                      background:
                        state === 'done' ? 'var(--lime)' : state === 'active' ? 'var(--yellow)' : '#fff',
                    }}
                    aria-hidden
                  >
                    {state === 'done' ? '✓' : ''}
                  </span>
                  <span
                    className={`text-[16px] ${state === 'todo' ? 'font-medium opacity-45' : 'font-bold'}`}
                  >
                    {s.label}
                    {state === 'active' && <span className="blink">…</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  // ── setup
  return (
    <div className="flex flex-col gap-4">
      <EventHeader event={event} status={confirmed ? 'Rubric ready' : 'Rubric not parsed'} />

      {error && (
        <div className="nb bg-[var(--pink)] p-4 text-[15px] font-bold" role="alert">
          {error}
        </div>
      )}

      {!parsed ? (
        // Never grade on a rubric nobody structured (plan.md F3).
        <div className="nb nb-lg bg-white p-6 sm:p-8">
          <h3 className="display text-[24px] leading-tight">THIS RUBRIC ISN’T BUILT YET.</h3>
          <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed opacity-75">
            The official rating sheet for {event.name} is in the repo (
            <code className="mono text-[13px]">{event.source_pdf}</code>), but it hasn’t been
            structured into a rubric yet — and Rubrix will not score you against a rubric no human
            has checked. A wrong rubric gives a confident, wrong score, which is worse than none.
          </p>
          <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed opacity-75">
            Run <code className="mono text-[13px]">npm run parse-rubrics</code> then{' '}
            <code className="mono text-[13px]">npm run catalog</code>, and it’ll appear here for
            review.
          </p>
        </div>
      ) : (
        <>
          {/* record */}
          <section className="nb nb-lg bg-white p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="display text-[18px] uppercase">Record now</h3>
              <label className="flex cursor-pointer items-center gap-2 text-[13px] font-bold">
                <input
                  type="checkbox"
                  checked={camOn}
                  disabled={recording}
                  onChange={(e) => setCamOn(e.target.checked)}
                  className="h-4 w-4 accent-black"
                />
                Show camera
              </label>
            </div>

            {camOn && (
              <div
                className="nb-flat relative mb-4 overflow-hidden bg-[#111]"
                style={{ aspectRatio: '16 / 9' }}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-full w-full object-cover"
                  style={{ transform: 'scaleX(-1)' }}
                />
                {recording ? (
                  <div className="nb-sm absolute left-3 top-3 flex items-center gap-2 border-[3px] border-black bg-[var(--pink)] px-2.5 py-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-black blink" />
                    <span className="mono text-[13px] font-bold">{mmss(elapsed)}</span>
                  </div>
                ) : (
                  <p className="absolute inset-0 flex items-center justify-center text-[14px] font-bold text-white/50">
                    Camera preview
                  </p>
                )}
              </div>
            )}

            {!recording ? (
              <button
                onClick={startRecording}
                className="nb-btn w-full bg-[var(--lime)] px-5 py-4 text-[17px]"
              >
                Start recording
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="nb-btn w-full bg-[var(--pink)] px-5 py-4 text-[17px]"
              >
                Stop &amp; get judged {!camOn && `· ${mmss(elapsed)}`}
              </button>
            )}

            <p className="mt-3 text-[13px] leading-relaxed opacity-75">
              The camera is a mirror for you — <strong>only your audio is recorded and uploaded</strong>.
              No video ever leaves this device.
            </p>
          </section>

          {/* upload */}
          <section className="nb nb-lg bg-white p-5 sm:p-6">
            <h3 className="display mb-3 text-[18px] uppercase">Or upload a run</h3>
            <label className="nb-flat flex cursor-pointer flex-col items-center justify-center bg-[var(--cyan)] px-6 py-10 text-center">
              <input
                type="file"
                accept="video/*,audio/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
              <span className="display text-[18px] uppercase">Choose a file</span>
              <span className="mt-1 text-[13px] font-semibold">
                mp4, mov, webm, mp3, m4a · under 20 min
              </span>
            </label>
            <p className="mt-3 text-[13px] leading-relaxed opacity-75">
              Pick a video and the audio is pulled out here in your browser — only that mp3 is sent.
            </p>
          </section>
        </>
      )}

      <footer className="px-1 text-[11px] leading-relaxed opacity-60">
        Rubrix is an independent student-built practice tool and is not affiliated with, sponsored
        by, or endorsed by FBLA, DECA, TSA, HOSA, or FPSPI. AI practice scores are estimates for
        preparation only and do not predict official results.
      </footer>
    </div>
  );
}

function EventHeader({ event, status }: { event: CatalogEvent; status: string }) {
  return (
    <header className="nb nb-lg bg-[var(--yellow)] p-5 sm:p-6">
      <p className="display text-[11px] uppercase tracking-wider opacity-70">
        {event.org.toUpperCase()} · {event.category === 'roleplay' ? 'Role play' : event.category}
      </p>
      <h2 className="display mt-1.5 text-[30px] leading-none sm:text-[38px]">
        {event.name.toUpperCase()}
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {event.time_limit_s && (
          <span className="tag bg-white">{Math.round(event.time_limit_s / 60)} min limit</span>
        )}
        {event.total_points !== null && (
          <span className="tag bg-white">{event.total_points} pts</span>
        )}
        <span className="tag bg-white">{status}</span>
      </div>
    </header>
  );
}
