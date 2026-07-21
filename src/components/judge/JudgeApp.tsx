'use client';

/**
 * The judge panel for one event.
 *
 * PRIVACY, enforced here (CLAUDE.md, non-negotiable):
 *   The camera preview is a mirror FOR YOU. It is never recorded and never uploaded.
 *   Only the audio track is captured; any video file you drop is decoded to mp3 on this
 *   machine by ffmpeg.wasm. The video never touches our servers.
 *
 * Nothing here is scored yet, so setup/progress states stay white/paper — goldenrod is
 * reserved for the graded report (DECISIONS D-017, "judge hub is white, not goldenrod,
 * because nothing has been graded yet").
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Report, type RunResult } from './Report';
import { QADrill, type Answer } from './QADrill';
import { RubricReview } from './RubricReview';
import type { CatalogEvent } from '@/lib/rubrics/types';
import type { VisualReportJSON } from '@/lib/ai/schemas';

type Phase = 'idle' | 'confirm' | 'preparing' | 'grading' | 'done' | 'qa' | 'qa-grading' | 'failed';

const STAGES = [
  { key: 'watching', label: 'Watching your run' },
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
  // Let the judge SEE the run. Default ON since D-019 (human decision, amending
  // D-015's default-off): scores should reflect the whole presentation unless the
  // student explicitly opts out. The video file itself still never leaves the device.
  const [seeVideo, setSeeVideo] = useState(true);
  // Pre-submission materials (D-019): extracted text of the prejudged document.
  const [materials, setMaterials] = useState<{ name: string; text: string; words: number } | null>(
    null,
  );
  const [materialsBusy, setMaterialsBusy] = useState(false);
  const [materialsError, setMaterialsError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Frames from THIS run, kept in memory (as blobs) so the Q&A re-grade can resend them.
  // Never persisted, never written anywhere — discarded when the run is reset.
  const framesRef = useRef<Array<{ blob: Blob; atSeconds: number }>>([]);
  // The visual delivery report (D-018) from /api/visual, held so the Q&A re-grade can
  // reuse it without re-running the vision model. In memory only, like the frames.
  const reportRef = useRef<VisualReportJSON | null>(null);
  // Whether this run includes video — decides if the "Watching your run" stage shows.
  const [withVideo, setWithVideo] = useState(false);
  // D-023: the file waiting on the confirm screen. Nothing is decoded or uploaded
  // until the student presses "Grade this run" — so they can catch a wrong file first.
  const [pending, setPending] = useState<
    { file: File; hasPicture: boolean; label: string; durationLabel?: string } | null
  >(null);

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

  /**
   * Frames -> the open-source vision model's report (D-018), in its own request so
   * the frames aren't fighting the audio for the 4.5MB body cap. Returns null on ANY
   * failure — the caller then falls back to attaching the frames to the grade
   * directly, which is exactly the pre-D-018 behaviour.
   */
  const analyzeVisual = useCallback(
    async (frames: Array<{ blob: Blob; atSeconds: number }>): Promise<VisualReportJSON | null> => {
      try {
        const body = new FormData();
        frames.forEach((f, i) => body.append(`frame_${i}`, f.blob, `${Math.round(f.atSeconds)}.jpg`));
        // The last frame sits half an interval from the end — good enough for context.
        const last = frames[frames.length - 1];
        if (last) body.append('durationS', String(Math.round(last.atSeconds + 4)));
        const res = await fetch('/api/visual', { method: 'POST', body });
        if (!res.ok) return null;
        const j = (await res.json()) as { report?: VisualReportJSON; provider?: string; model?: string };
        if (j.report) console.info(`[providers] visual → ${j.provider ?? 'openrouter'}/${j.model ?? ''}`);
        return j.report ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  const grade = useCallback(
    async (mp3: Blob, frames: Array<{ blob: Blob; atSeconds: number }>) => {
      setPhase('grading');
      framesRef.current = frames; // held so the Q&A re-grade can resend them
      setWithVideo(frames.length > 0);

      // The judge's eyes: get the whole-run visual report first (D-018).
      let report: VisualReportJSON | null = null;
      if (frames.length > 0) {
        setStage('watching');
        report = await analyzeVisual(frames);
        reportRef.current = report;
      }
      setStage('transcribing');

      const body = new FormData();
      body.append('audio', new File([mp3], 'run.mp3', { type: 'audio/mpeg' }));
      body.append('rubricId', event.rubric ?? '');
      body.append('eventName', event.name);
      body.append('org', event.org);
      if (event.time_limit_s) body.append('timeLimitS', String(event.time_limit_s));
      if (materials) {
        body.append('materialsName', materials.name);
        body.append('materialsText', materials.text);
      }
      if (report) {
        body.append('visualReport', JSON.stringify(report));
        body.append('visualFrameCount', String(frames.length));
      } else if (frames.length > 0) {
        // Fallback: no vision provider (or it failed) — attach stills straight to the
        // judge as before, re-trimmed so audio + frames fit the platform body cap.
        const { trimFramesToBudget } = await import('@/lib/video/extractFrames');
        const attach = trimFramesToBudget(
          frames.map((f) => ({ blob: f.blob, atSeconds: f.atSeconds })),
          mp3.size,
        );
        // Key by index so two frames rounding to the same second don't collide; carry the
        // real timestamp in the filename so the server can caption it.
        attach.forEach((f, i) => body.append(`frame_${i}`, f.blob, `${Math.round(f.atSeconds)}.jpg`));
      }

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
          const msg = JSON.parse(line) as {
            stage: string;
            message?: string;
            result?: RunResult;
            providers?: Record<string, string>;
          };
          if (msg.stage === 'failed') {
            setError(msg.message ?? 'The judge stumbled on this one.');
            setPhase('failed');
            return;
          }
          if (msg.stage === 'providers' && msg.providers) {
            // D-023: prove all three keys did work this run, in the browser console.
            console.info('[providers] this run used →', msg.providers);
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
    [event, analyzeVisual, materials],
  );

  /**
   * D-023: hold a picked/recorded file on the confirm screen instead of grading it
   * straight away. Nothing is decoded or uploaded until the student presses "Grade".
   */
  const stageForConfirm = useCallback(
    (file: File, hasPictureOverride?: boolean, durationLabel?: string) => {
      setError('');
      const hasPicture = hasPictureOverride ?? (file.type.startsWith('video/') || file.type === '');
      setPending({
        file,
        hasPicture,
        label: file.name && file.name !== 'take.webm' ? file.name : 'Your recording',
        durationLabel,
      });
      setPhase('confirm');
    },
    [],
  );

  /**
   * Any file -> mp3 (always), + still frames (only if the student opted in). The video FILE
   * never leaves the device either way — audio and frames are extracted here in the browser.
   */
  const processFile = useCallback(
    async (file: File, wantsVideo: boolean) => {
      setError('');
      setPhase('preparing');
      const hasPicture = file.type.startsWith('video/') || file.type === '';
      setPrepLabel(
        wantsVideo && hasPicture
          ? 'Reading your video on this device — pulling the audio and still frames from across the run'
          : file.type.startsWith('video/')
            ? 'Pulling the audio out of your video, right here on your device'
            : 'Preparing your audio',
      );
      try {
        const { extractAudio, MAX_UPLOAD_BYTES, AUDIO_BYTES_PER_SEC } = await import(
          '@/lib/audio/extractAudio'
        ); // §11.7 lazy
        const mp3 = await extractAudio(file, (p) => setPrepRatio(p.ratio));

        let frames: Array<{ blob: Blob; atSeconds: number }> = [];
        if (wantsVideo && hasPicture) {
          // D-023: frame extraction must NEVER hang or kill a run. It seeks a few dozen
          // frames via ffmpeg (fast, and it decodes what the <video> element can't), is
          // self-budgeted, and is additionally raced against a hard timeout here — on any
          // failure or timeout the grade just proceeds audio-only.
          setPrepLabel('Reading the video — sampling frames across your run');
          setPrepRatio(0);
          // Estimate the run length from the mp3 (no second decode, no <video> stall). The
          // mp3 is the video's own audio track, so this ~= the true duration; sampling at
          // slice midpoints keeps the last frame just inside the end, and any seek that lands
          // past the real end returns nothing and is skipped — so no shrink margin is needed
          // and the tail (your closing lines) stays covered.
          const estDurationS = mp3.size / AUDIO_BYTES_PER_SEC;
          try {
            const { extractFrames, trimFramesToBudget } = await import('@/lib/video/extractFrames');
            const raw = await Promise.race([
              extractFrames(file, { durationS: estDurationS, onProgress: (r) => setPrepRatio(r) }),
              new Promise<[]>((resolve) => setTimeout(() => resolve([]), 75_000)),
            ]);
            // Frames travel in their OWN request to /api/visual (D-018), so they get the
            // full body budget instead of sharing it with the audio.
            frames = trimFramesToBudget(raw, 0, MAX_UPLOAD_BYTES);
          } catch (err) {
            console.warn('[frames] visual extraction failed — grading from audio only:', err);
          }
        }

        await grade(mp3, frames);
      } catch (err) {
        const msg = err instanceof Error ? err.message.split('\n')[0] : '';
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

      // THE PRIVACY LINE: by default the recorder is built over an AUDIO-ONLY stream — the
      // camera is a mirror for the student and not one frame is captured. ONLY if the student
      // opted in (seeVideo) do we record the video track, and even then the recording stays
      // on this device: we sample a few stills from it and upload only those (DECISIONS D-015).
      const recordVideo = seeVideo && camOn && stream.getVideoTracks().length > 0;
      const recStream = recordVideo ? stream : new MediaStream(stream.getAudioTracks());
      const rec = new MediaRecorder(recStream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      const startedAt = Date.now();
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        stopTracks();
        setRecording(false);
        // Confirm before grading (D-023) — carry the recorded length so the student
        // can see they actually captured a full take.
        const secs = Math.round((Date.now() - startedAt) / 1000);
        const durationLabel = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
        stageForConfirm(new File([blob], 'take.webm', { type: rec.mimeType }), recordVideo, durationLabel);
      };
      recorderRef.current = rec;
      rec.start();

      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch {
      setError('We couldn’t reach your microphone. Check your browser permissions and try again.');
    }
  }, [camOn, seeVideo, stageForConfirm, stopTracks]);

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
      // Resend the pre-submission materials so document criteria stay scored too.
      if (materials) {
        body.append('materialsName', materials.name);
        body.append('materialsText', materials.text);
      }
      // Resend the visual evidence so visual criteria stay scored through the re-grade.
      // The report is preferred (tiny, already computed); raw frames are the fallback.
      if (reportRef.current) {
        body.append('visualReport', JSON.stringify(reportRef.current));
        body.append('visualFrameCount', String(framesRef.current.length));
      } else {
        framesRef.current.forEach((f, i) =>
          body.append(`frame_${i}`, f.blob, `${Math.round(f.atSeconds)}.jpg`),
        );
      }

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
            // Keep the questions and the provider line around from the first grade.
            setRun({ ...msg.result, qa: run.qa, providers: run.providers });
            setPhase('done');
            return;
          }
        }
      }
    },
    [run, event, materials],
  );

  /** Prejudged document -> extracted text via /api/presubmission (D-019). */
  const handleMaterials = useCallback(async (file: File) => {
    setMaterialsError('');
    setMaterialsBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/presubmission', { method: 'POST', body });
      const j = (await res.json().catch(() => null)) as
        | { name?: string; text?: string; words?: number; error?: { message?: string } }
        | null;
      if (!res.ok || !j?.text) {
        setMaterialsError(j?.error?.message ?? "We couldn't read that document.");
        return;
      }
      setMaterials({ name: j.name ?? file.name, text: j.text, words: j.words ?? 0 });
    } catch {
      setMaterialsError("We couldn't read that document. Check your connection and try again.");
    } finally {
      setMaterialsBusy(false);
    }
  }, []);

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const reset = () => {
    setRun(null);
    setPhase('idle');
    setPrepRatio(null);
    setError('');
    setWithVideo(false);
    setPending(null);
    framesRef.current = [];
    reportRef.current = null;
  };

  // ── confirm screen (D-023): verify the file before anything is decoded or uploaded.
  if (phase === 'confirm' && pending) {
    const sizeMb = pending.file.size / (1024 * 1024);
    return (
      <div className="flex flex-col gap-4">
        <EventHeader event={event} status="Confirm your run" />
        <section className="card p-5 sm:p-6">
          <p className="label mb-2">Ready to grade</p>
          <p className="display-md text-[20px] leading-tight">{pending.label}</p>
          <div className="mono mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px]" style={{ color: 'var(--slate)' }}>
            {pending.durationLabel && <span>{pending.durationLabel}</span>}
            <span>{sizeMb < 0.1 ? '<0.1' : sizeMb.toFixed(1)} MB</span>
            <span>{pending.file.type || 'unknown type'}</span>
          </div>

          {pending.hasPicture && (
            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={seeVideo}
                onChange={(e) => setSeeVideo(e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0"
                style={{ accentColor: 'var(--pen)' }}
              />
              <span className="text-[13px] leading-relaxed" style={{ color: 'var(--slate)' }}>
                Let the judge watch the video (scores body language, eye contact, and poise).
                The video file stays on this device — only still frames and the audio are sent.
              </span>
            </label>
          )}

          <p className="mt-4 max-w-[60ch] text-[13px] leading-relaxed" style={{ color: 'var(--slate)' }}>
            Check this is the right run. Grading uses one of your credits and takes a couple of
            minutes. Nothing has been uploaded yet.
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={() => void processFile(pending.file, seeVideo && pending.hasPicture)}
              className="btn btn-primary px-6 text-[15px]"
            >
              Grade this run
            </button>
            <button onClick={reset} className="btn btn-secondary px-6 text-[15px]">
              Pick a different file
            </button>
          </div>
        </section>
      </div>
    );
  }

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
          <div className="card p-4 text-[15px]" style={{ borderLeft: '3px solid var(--mark)', color: 'var(--mark)' }} role="alert">
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
      <div className="card p-6 sm:p-8">
        <p className="label">Your answers are with the judge</p>
        <p className="display-md mt-4 text-[24px] leading-tight">
          Judging your answers<span className="blink">…</span>
        </p>
      </div>
    );
  }

  // ── working
  if (phase === 'preparing' || phase === 'grading') {
    // "Watching your run" only exists when this run actually has video.
    const stages = withVideo ? STAGES : STAGES.filter((s) => s.key !== 'watching');
    const activeIdx = stages.findIndex((s) => s.key === stage);
    return (
      <div className="card p-6 sm:p-8">
        <p className="label">Your run is with the judge</p>

        {phase === 'preparing' ? (
          <>
            <p className="display-md mt-4 text-[24px] leading-tight">
              {prepLabel}
              <span className="blink">_</span>
            </p>
            {prepRatio !== null && (
              <div className="bar mt-5 h-2">
                <span style={{ width: `${Math.round(prepRatio * 100)}%` }} />
              </div>
            )}
            <p className="mt-4 text-[13px]" style={{ color: 'var(--slate)' }}>
              This is happening on your device. Your video is not being uploaded.
            </p>
          </>
        ) : (
          <ul className="mt-6 flex flex-col gap-3">
            {stages.map((s, i) => {
              const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'todo';
              return (
                <li key={s.key} className="flex items-center gap-3">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
                    style={{
                      borderColor: state === 'todo' ? 'var(--rule)' : 'var(--pen)',
                      background: state === 'done' ? 'var(--pen)' : 'transparent',
                      color: '#fff',
                    }}
                    aria-hidden
                  >
                    {state === 'done' ? (
                      <span className="text-[13px]">&#10003;</span>
                    ) : state === 'active' ? (
                      <span className="h-2 w-2 rounded-full" style={{ background: 'var(--pen)' }} />
                    ) : null}
                  </span>
                  <span
                    className="text-[15px]"
                    style={{
                      fontWeight: state === 'todo' ? 400 : 600,
                      color: state === 'todo' ? 'var(--slate)' : 'var(--ink)',
                    }}
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
        <div className="card p-4 text-[15px]" style={{ borderLeft: '3px solid var(--mark)', color: 'var(--mark)' }} role="alert">
          {error}
        </div>
      )}

      {!parsed ? (
        // Never grade on a rubric nobody structured (plan.md F3).
        <div className="card p-6 sm:p-8">
          <h3 className="display-md text-[22px] leading-tight">This rubric isn&rsquo;t built yet.</h3>
          <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed" style={{ color: 'var(--slate)' }}>
            The official rating sheet for {event.name} is in the repo (
            <code className="mono text-[13px]">{event.source_pdf}</code>), but it hasn&rsquo;t been
            structured into a rubric yet — and Rubrix will not score you against a rubric no human
            has checked. A wrong rubric gives a confident, wrong score, which is worse than none.
          </p>
          <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed" style={{ color: 'var(--slate)' }}>
            Run <code className="mono text-[13px]">npm run parse-rubrics</code>{' '}
            then{' '}
            <code className="mono text-[13px]">npm run catalog</code>, and it&rsquo;ll appear here for
            review.
          </p>
        </div>
      ) : (
        <>
          {/* video-grading consent (DECISIONS D-015) — opt-in, default off */}
          <section className="card p-5">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={seeVideo}
                disabled={recording}
                onChange={(e) => setSeeVideo(e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0"
                style={{ accentColor: 'var(--pen)' }}
              />
              <span>
                <span className="display-md text-[15px]">Let the judge see the run</span>
                <span className="mt-1 block text-[13px] leading-relaxed" style={{ color: 'var(--slate)' }}>
                  On by default, so the score reflects your whole presentation — body language, eye
                  contact, poise, and appearance are scored instead of skipped. Uncheck to grade
                  from audio only.
                </span>
                <span className="mt-2 block text-[12px] leading-relaxed" style={{ color: 'var(--slate)' }}>
                  Even then, your <strong style={{ color: 'var(--ink)' }}>video file is never
                  uploaded or saved</strong>. Still frames are taken on this device — one every few
                  seconds, so the whole run is seen — used once to grade, and discarded. If you
                  leave this off, only your audio is used — exactly as before.
                </span>
              </span>
            </label>
          </section>

          {/* pre-submission materials (D-019/D-021) — only for events whose own guidelines
              say "prejudged"; the flag comes from the PDF's wording via build-catalog. */}
          {event.prejudged === true && (
          <section className="card p-5">
            <h3 className="display-md text-[15px]">Pre-submission materials</h3>
            <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--slate)' }}>
              This event is prejudged — a report, plan, or portfolio goes in before you present.
              Attach it here and those rubric lines get scored too.
            </p>
            {materials ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[14px]" style={{ color: 'var(--ink)' }}>
                  <span aria-hidden>✓ </span>
                  <strong>{materials.name}</strong>
                  {materials.words > 0 && (
                    <span style={{ color: 'var(--slate)' }}>
                      {' '}
                      — {materials.words.toLocaleString()} words attached
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setMaterials(null)}
                  className="text-[13px] font-medium underline"
                  style={{ color: 'var(--pen)' }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <label
                className="mt-3 flex cursor-pointer items-center justify-center rounded px-4 py-3 text-[14px] font-medium"
                style={{ background: 'var(--paper)', border: '1px dashed var(--rule)' }}
              >
                <input
                  type="file"
                  accept=".pdf,.txt,.md,application/pdf,text/plain"
                  className="sr-only"
                  disabled={materialsBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleMaterials(f);
                    e.target.value = '';
                  }}
                />
                {materialsBusy ? 'Reading your document…' : 'Attach a PDF'}
              </label>
            )}
            {materialsError && (
              <p className="mt-2 text-[13px]" style={{ color: 'var(--mark)' }} role="alert">
                {materialsError}
              </p>
            )}
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--slate)' }}>
              Read once to grade, never stored.
            </p>
          </section>
          )}

          {/* record */}
          <section className="card p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="display-md text-[18px]">Record now</h3>
              <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
                <input
                  type="checkbox"
                  checked={camOn}
                  disabled={recording}
                  onChange={(e) => setCamOn(e.target.checked)}
                  className="h-4 w-4"
                  style={{ accentColor: 'var(--pen)' }}
                />
                Show camera
              </label>
            </div>

            {camOn && (
              <div
                className="relative mb-4 overflow-hidden rounded"
                style={{ aspectRatio: '16 / 9', background: '#111' }}
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
                  <div className="absolute left-3 top-3 flex items-center gap-2 rounded px-2.5 py-1" style={{ background: 'var(--mark)' }}>
                    <span className="h-2 w-2 rounded-full bg-white blink" />
                    <span className="mono text-[13px] text-white">{mmss(elapsed)}</span>
                  </div>
                ) : (
                  <p className="absolute inset-0 flex items-center justify-center text-[14px] text-white/50">
                    Camera preview
                  </p>
                )}
              </div>
            )}

            {!recording ? (
              <button onClick={startRecording} className="btn btn-primary w-full text-[15px]">
                Start recording
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="btn w-full text-[15px]"
                style={{ background: 'var(--mark)', color: '#fff' }}
              >
                Stop &amp; get judged {!camOn && `· ${mmss(elapsed)}`}
              </button>
            )}

            <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--slate)' }}>
              {seeVideo && camOn ? (
                <>
                  Still frames from across your whole run are captured on this device to score your
                  delivery.{' '}
                  <strong style={{ color: 'var(--ink)' }}>Your video file is never uploaded or
                  saved</strong>{' '}
                  — only the audio and those stills, only for this grade.
                </>
              ) : (
                <>
                  The camera is a mirror for you —{' '}
                  <strong style={{ color: 'var(--ink)' }}>only your audio is recorded and
                  uploaded</strong>. No video ever leaves this device.
                </>
              )}
            </p>
          </section>

          {/* upload */}
          <section className="card p-5 sm:p-6">
            <h3 className="display-md mb-3 text-[18px]">Or upload a run</h3>
            <label
              className="flex cursor-pointer flex-col items-center justify-center rounded px-6 py-10 text-center"
              style={{ background: 'var(--paper)', border: '1px dashed var(--rule)' }}
            >
              <input
                type="file"
                accept="video/*,audio/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  // Don't grade on pick — stage it on the confirm screen first (D-023).
                  if (f) stageForConfirm(f);
                  e.target.value = ''; // let re-picking the same file re-fire
                }}
              />
              <span className="display-md text-[16px]">Choose a file</span>
              <span className="mt-1 text-[13px]" style={{ color: 'var(--slate)' }}>
                mp4, mov, webm, mp3, m4a · under 20 min
              </span>
            </label>
            <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--slate)' }}>
              {seeVideo ? (
                <>
                  The audio and still frames from across the run are pulled out here in your
                  browser —{' '}
                  <strong style={{ color: 'var(--ink)' }}>the video file itself is never
                  uploaded</strong>.
                </>
              ) : (
                <>Pick a video and the audio is pulled out here in your browser — only that mp3 is sent.</>
              )}
            </p>
          </section>
        </>
      )}

      <footer className="px-1 text-[11px] leading-relaxed" style={{ color: 'var(--slate)' }}>
        Rubrix is an independent student-built practice tool and is not affiliated with, sponsored
        by, or endorsed by FBLA, DECA, TSA, HOSA, or FPSPI. AI practice scores are estimates for
        preparation only and do not predict official results.
      </footer>
    </div>
  );
}

function EventHeader({ event, status }: { event: CatalogEvent; status: string }) {
  return (
    <header className="card p-5 sm:p-6">
      <p className="label">
        {event.org.toUpperCase()} · {event.category === 'roleplay' ? 'Role play' : event.category}
      </p>
      <h2 className="display mt-1.5 text-[28px] leading-none sm:text-[36px]">{event.name}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {event.time_limit_s && (
          <span className="chip">{Math.round(event.time_limit_s / 60)} min limit</span>
        )}
        {event.total_points !== null && <span className="chip">{event.total_points} pts</span>}
        <span className="chip chip-active">{status}</span>
      </div>
    </header>
  );
}
