import { forwardRef, useCallback, useEffect, useRef, useState, useImperativeHandle } from 'react';
import { formatTimecode, clampToDuration } from '../lib/timecode';
import TimelineMarkers, { type TimelineMarker } from './TimelineMarkers';

export interface VideoPlayerHandle {
  /** Перехід до секунди; play=true — продовжити відтворення. */
  seekTo(seconds: number, play?: boolean): void;
  getCurrentTime(): number;
  play(): void;
  pause(): void;
}

export interface VideoPlayerProps {
  src: string | null;
  markers?: TimelineMarker[];
  /** seek за замовчуванням зупиняє відтворення (адмінка). Для review — false. */
  pauseOnSeek?: boolean;
  /** Викликається, коли джерело не відкриється (наприклад, спливший signed URL).
   *  Повертає нову URL або null. */
  onSourceError?: () => Promise<string | null>;
  className?: string;
}

const RATES = [0.5, 1, 1.5, 2];

/**
 * Функціональний HTML5-плеєр: play/pause, seekbar із маркерами, час, гучність,
 * швидкість, fullscreen. Кнопки доступні з клавіатури.
 * iOS/Safari: fullscreen request може не поддержуватися на <div> — тоді
 * натисніть звичайну кнопку розгортання відео (не критично для MVP).
 */
const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { src, markers = [], pauseOnSeek = true, onSourceError, className = '' },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    setError(null);
    retryCountRef.current = 0;
    setCurrent(0);
    setDuration(0);
    setBuffered(0);
  }, [src]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const upd = () => setFullscreen(document.fullscreenElement === el);
    document.addEventListener('fullscreenchange', upd);
    return () => document.removeEventListener('fullscreenchange', upd);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      seekTo(seconds: number, play = false) {
        const v = videoRef.current;
        if (!v) return;
        const target = clampToDuration(seconds, v.duration && Number.isFinite(v.duration) ? v.duration : null);
        if (pauseOnSeek && !play) v.pause();
        try {
          if (v.readyState >= 1 && Number.isFinite(v.duration)) {
            v.currentTime = target;
          } else {
            pendingSeekRef.current = target;
          }
        } catch {
          pendingSeekRef.current = target;
        }
        if (play) void v.play().catch(() => undefined);
      },
      getCurrentTime() {
        const v = videoRef.current;
        return v && Number.isFinite(v.currentTime) ? v.currentTime : 0;
      },
      play() {
        void videoRef.current?.play().catch(() => undefined);
      },
      pause() {
        videoRef.current?.pause();
      },
    }),
    [pauseOnSeek],
  );

  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    if (Number.isFinite(v.duration)) setDuration(v.duration);
    if (v.volume !== volume) v.volume = volume;
    v.playbackRate = rate;
    if (pendingSeekRef.current != null) {
      try {
        v.currentTime = pendingSeekRef.current;
      } catch {
        /* ignore */
      }
      pendingSeekRef.current = null;
    }
  };

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrent(Number.isFinite(v.currentTime) ? v.currentTime : 0);
    try {
      if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
    } catch {
      /* ignore */
    }
  };

  const onError = async () => {
    const v = videoRef.current;
    // MEDIA_ERR_SRC_NOT_SUPPORTED (4) зазвичай повертається на 403 (спливший URL).
    if (onSourceError && retryCountRef.current < 2) {
      retryCountRef.current += 1;
      const restoreTime = v?.currentTime ?? 0;
      const wasPlaying = v ? !v.paused : false;
      try {
        const next = await onSourceError();
        if (next && v) {
          setError(null);
          v.src = next;
          v.load();
          pendingSeekRef.current = restoreTime;
          if (wasPlaying) void v.play().catch(() => undefined);
          return;
        }
      } catch {
        /* fallthrough to error message */
      }
    }
    setError('Не вдалося завантажити відео. Можливо, посилання сплило — оновіть сторінку.');
    setWaiting(false);
  };

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, [src]);

  const seekToRatio = (ratio: number) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const target = clampToDuration(ratio * duration, duration);
    v.currentTime = target;
    setCurrent(target);
  };

  const onBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    const bar = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - bar.left) / bar.width));
    seekToRatio(ratio);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = videoRef.current;
    if (!v) return;
    if (e.key === ' ' || e.key.toLowerCase() === 'k') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      v.currentTime = clampToDuration(v.currentTime - 5, duration);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      v.currentTime = clampToDuration(v.currentTime + 5, duration);
    } else if (e.key.toLowerCase() === 'm') {
      e.preventDefault();
      setMuted((m) => !m);
    }
  };

  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.muted = muted;
    }
  }, [muted]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
  }, [rate]);

  const pct = duration > 0 ? (current / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-card border border-ink-line bg-black ${className}`}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="region"
      aria-label="Відео плеєр"
    >
      <video
        ref={videoRef}
        src={src ?? undefined}
        className="block w-full aspect-video bg-black"
        playsInline
        preload="metadata"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onDurationChange={() => {
          const d = videoRef.current?.duration;
          if (d && Number.isFinite(d)) setDuration(d);
        }}
        onError={() => void onError()}
        onEnded={() => setPlaying(false)}
        onClick={togglePlay}
        aria-label="Відео"
      />

      {waiting && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="vr-spinner block h-10 w-10 rounded-full border-2 border-ink-accent border-t-transparent" aria-label="Буферизація" />
        </div>
      )}

      {error && (
        <div className="absolute inset-x-0 bottom-14 mx-2 rounded-lg border border-[#7F2D2D] bg-[#3A222A]/95 px-3 py-2 text-xs text-[#FFB4B4]" role="alert">
          {error}
        </div>
      )}

      {/* Панель керування */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/85 to-black/25 px-2 pb-1.5 pt-3">
        <div
          className="relative h-[18px] cursor-pointer rounded"
          onPointerDown={onBarPointerDown}
          role="slider"
          aria-label="Прогрес відео"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          tabIndex={-1}
        >
          <div className="absolute top-1/2 h-[4px] w-full -translate-y-1/2 rounded bg-white/15" />
          <div className="absolute top-1/2 h-[4px] -translate-y-1/2 rounded bg-white/25" style={{ width: `${bufferedPct}%` }} />
          <div className="absolute top-1/2 h-[4px] -translate-y-1/2 rounded bg-ink-accent" style={{ width: `${pct}%` }} />
          <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" style={{ left: `${pct}%` }} />
          <TimelineMarkers
            markers={markers}
            duration={duration}
            onSelect={(m) => {
              seekToRatio(m.seconds / (duration || 1));
            }}
          />
        </div>

        <div className="flex items-center gap-2 text-ink-text">
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"
            onClick={togglePlay}
            aria-label={playing ? 'Пауза' : 'Відтворити'}
            disabled={!src}
          >
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" rx="1" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M3 1.8v10.4c0 .8.9 1.3 1.6.9l8.2-5.2c.6-.4.6-1.4 0-1.8L4.6.9C3.9.5 3 1 3 1.8z" /></svg>
            )}
          </button>
          <span className="w-[104px] shrink-0 text-center text-xs tabular-nums text-ink-muted" aria-live="off">
            {formatTimecode(current)} / {formatTimecode(duration)}
          </span>
          <label className="ml-1 hidden items-center gap-1 sm:flex" title="Гучність">
            <button type="button" className="grid h-7 w-7 place-items-center rounded hover:bg-white/10" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Увімкнути звук' : 'Вимкнути звук'}>
              {muted || volume === 0 ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M1 5h2.5L7 2v10L3.5 9H1z" /><path d="M9.5 5.5l3 3m0-3l-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M1 5h2.5L7 2v10L3.5 9H1z" /><path d="M9 4.5a3.5 3.5 0 010 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" /></svg>
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                setMuted(v === 0);
              }}
              className="w-16 accent-[#6C8CFF]"
              aria-label="Гучність"
            />
          </label>
          <select
            className="ml-auto mr-1 rounded border border-ink-line bg-ink-raised px-1.5 py-0.5 text-xs"
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            aria-label="Швидкість відтворення"
            title="Швидкість відтворення"
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"
            onClick={() => {
              const el = containerRef.current;
              if (!el) return;
              if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
              else void el.requestFullscreen?.().catch(() => undefined);
            }}
            aria-label={fullscreen ? 'Вийти з повного екрану' : 'На весь екран'}
          >
            {fullscreen ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5.5 1H1v4.5M8.5 13H13V8.5M13 5.5V1H8.5M1 8.5V13h4.5" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M1 5.5V1h4.5M8.5 1H13v4.5M13 8.5V13H8.5M5.5 13H1V8.5" /></svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});

export default VideoPlayer;
