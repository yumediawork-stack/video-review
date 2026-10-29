import { markerRatio } from '../lib/timecode';

export interface TimelineMarker {
  id: string;
  seconds: number;
  /** Доступний опис (для всіх станів) */
  label: string;
}

/**
 * Кнопки-маркери коментарів, накладені на прогрес-бар плеєра.
 * Позиція — нормалізована: timestamp_seconds / duration_seconds, clamp 0..1.
 * Мінімальна площа натискання — для тапів на телефоні.
 */
export default function TimelineMarkers({
  markers,
  duration,
  onSelect,
}: {
  markers: TimelineMarker[];
  duration: number;
  onSelect: (m: TimelineMarker) => void;
}) {
  if (!duration || duration <= 0 || markers.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden={false}>
      {markers.map((m) => {
        const ratio = markerRatio(m.seconds, duration);
        return (
          <button
            key={m.id}
            type="button"
            className="pointer-events-auto absolute top-0 h-full w-[18px] -translate-x-1/2 group"
            style={{ left: `${ratio * 100}%` }}
            title={m.label}
            aria-label={m.label}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onSelect(m);
            }}
          >
            <span className="mx-auto block h-[10px] w-[3px] rounded-full bg-ink-accent transition-transform group-hover:scale-y-150 group-focus-visible:scale-y-150" />
          </button>
        );
      })}
    </div>
  );
}
