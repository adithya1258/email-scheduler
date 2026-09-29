'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { formatFull, toLocalInputValue } from '@/lib/format';

function tomorrowAt(hours: number | null, minutes = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (hours !== null) d.setHours(hours, minutes, 0, 0);
  else d.setSeconds(0, 0);
  return d;
}

export function SendLaterPopover({
  onCancel,
  onDone,
  busy,
}: {
  onCancel: () => void;
  onDone: (when: Date) => void;
  busy?: boolean;
}) {
  const [value, setValue] = useState('');
  // "Now" means the moment Done is clicked, not the minute shown in the input.
  const [isNow, setIsNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const presets = useMemo(
    () => [
      { label: 'Now', date: () => new Date() },
      { label: 'Tomorrow', date: () => tomorrowAt(null) },
      { label: 'Tomorrow, 10:00 AM', date: () => tomorrowAt(10) },
      { label: 'Tomorrow, 11:00 AM', date: () => tomorrowAt(11) },
      { label: 'Tomorrow, 3:00 PM', date: () => tomorrowAt(15) },
    ],
    [],
  );

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !busy) onCancel();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onCancel, busy]);

  function done() {
    if (!value) return setError('Pick a date & time or choose an option');
    if (isNow) return onDone(new Date());
    const when = new Date(value);
    if (Number.isNaN(when.getTime())) return setError('Invalid date');
    // The input only has minute precision, so compare against the start of the current minute.
    const minuteStart = new Date();
    minuteStart.setSeconds(0, 0);
    if (when.getTime() < minuteStart.getTime()) return setError('That time is in the past');
    onDone(when);
  }

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 z-30 mt-2 w-[320px] rounded-2xl border border-line bg-white p-5 shadow-[0_12px_40px_rgba(0,0,0,0.12)]"
    >
      <h3 className="mb-4 font-semibold">Send Later</h3>

      <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 focus-within:border-brand">
        <input
          type="datetime-local"
          className="w-full bg-transparent text-sm outline-none"
          value={value}
          min={toLocalInputValue(new Date())}
          onChange={(e) => {
            setValue(e.target.value);
            setIsNow(false);
            setError(null);
          }}
          aria-label="Pick date & time"
        />
        <CalendarClock className="h-4 w-4 shrink-0 text-muted" />
      </label>
      {!value && <p className="mt-1 text-xs text-muted">Pick date &amp; time</p>}

      <ul className="mt-3 space-y-0.5">
        {presets.map((p) => {
          const v = toLocalInputValue(p.date());
          return (
            <li key={p.label}>
              <button
                type="button"
                onClick={() => {
                  setValue(v);
                  setIsNow(p.label === 'Now');
                  setError(null);
                }}
                className={`w-full rounded-lg px-2 py-2 text-left text-sm transition hover:bg-surface ${
                  (p.label === 'Now' ? isNow : value === v && !isNow) ? 'font-semibold text-brand' : 'text-gray-700'
                }`}
              >
                {p.label}
              </button>
            </li>
          );
        })}
      </ul>

      {value && <p className="mt-2 text-xs text-muted">First email goes out {formatFull(new Date(value).toISOString())}</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-5 flex items-center justify-end gap-3">
        <button type="button" onClick={onCancel} disabled={busy} className="px-3 py-2 text-sm font-medium text-gray-700">
          Cancel
        </button>
        <button
          type="button"
          onClick={done}
          disabled={busy}
          className="rounded-full border border-brand px-6 py-2 text-sm font-semibold text-brand transition hover:bg-brand-soft disabled:opacity-60"
        >
          {busy ? 'Scheduling…' : 'Done'}
        </button>
      </div>
    </div>
  );
}
