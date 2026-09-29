'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, ChevronDown, Clock, FileText, Paperclip, Upload, X } from 'lucide-react';
import { api, ScheduleRequest, ScheduleResponse, Sender } from '@/lib/api';
import { extractEmails, formatFull, isEmail } from '@/lib/format';
import { useStats } from '@/lib/stats';
import { RichTextEditor, RichTextHandle } from '@/components/RichTextEditor';
import { SendLaterPopover } from '@/components/SendLaterPopover';

const MAX_VISIBLE_CHIPS = 3;

export default function ComposePage() {
  const router = useRouter();
  const { refreshStats } = useStats();
  const editor = useRef<RichTextHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [senders, setSenders] = useState<Sender[] | null>(null);
  const [senderId, setSenderId] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [upload, setUpload] = useState<{ name: string; count: number } | null>(null);
  const [subject, setSubject] = useState('');
  const [delaySec, setDelaySec] = useState('');
  const [hourlyLimit, setHourlyLimit] = useState('');
  const [laterOpen, setLaterOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScheduleResponse | null>(null);

  useEffect(() => {
    api<{ senders: Sender[] }>('/api/senders')
      .then((r) => {
        setSenders(r.senders);
        if (r.senders[0]) setSenderId(r.senders[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  function addRecipients(list: string[]) {
    setRecipients((cur) => {
      const set = new Set(cur);
      for (const e of list) set.add(e.toLowerCase());
      return [...set];
    });
  }

  function commitDraft() {
    const parts = draft.split(/[\s,;]+/).filter(Boolean);
    const valid = parts.filter(isEmail);
    if (valid.length) addRecipients(valid);
    setDraft(parts.filter((p) => !isEmail(p)).join(' '));
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const emails = extractEmails(await file.text());
    if (emails.length === 0) {
      setError(`No email addresses found in ${file.name}`);
      return;
    }
    setError(null);
    addRecipients(emails);
    setUpload({ name: file.name, count: emails.length });
  }

  function validate(): string | null {
    if (!senderId) return 'Choose a sender';
    if (recipients.length === 0) return 'Add at least one recipient or upload a list';
    if (!subject.trim()) return 'Subject is required';
    if (!editor.current?.getText()) return 'Email body is empty';
    if (delaySec && (Number(delaySec) < 0 || !Number.isFinite(Number(delaySec)))) return 'Delay must be 0 or more seconds';
    if (hourlyLimit && (!Number.isInteger(Number(hourlyLimit)) || Number(hourlyLimit) < 1))
      return 'Hourly limit must be a whole number above 0';
    return null;
  }

  function openLater() {
    commitDraft();
    const problem = validate();
    setError(problem);
    if (!problem) setLaterOpen(true);
  }

  async function schedule(when: Date) {
    setBusy(true);
    setError(null);
    try {
      const body: ScheduleRequest = {
        senderId,
        subject: subject.trim(),
        body: editor.current!.getHTML(),
        recipients,
        startAt: when.toISOString(),
        delayBetweenEmailsMs: Math.round(Number(delaySec || 0) * 1000),
        hourlyLimit: Number(hourlyLimit || 200),
      };
      const r = await api<ScheduleResponse>('/api/emails/schedule', { method: 'POST', body: JSON.stringify(body) });
      setResult(r);
      setLaterOpen(false);
      refreshStats();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not schedule emails');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setRecipients([]);
    setUpload(null);
    setSubject('');
    setDelaySec('');
    setHourlyLimit('');
    editor.current?.clear();
  }

  const visibleChips = showAll ? recipients : recipients.slice(0, MAX_VISIBLE_CHIPS);
  const hidden = recipients.length - visibleChips.length;
  const row = 'flex flex-col gap-2 border-b border-line py-3 sm:flex-row sm:items-center sm:gap-4';
  const label = 'w-16 shrink-0 text-sm text-muted';

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.back()} className="rounded-lg p-1.5 hover:bg-surface" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-lg font-semibold">Compose New Email</h1>
        <button
          onClick={() => fileInput.current?.click()}
          className="rounded-lg p-2 text-gray-600 hover:bg-surface"
          aria-label="Upload recipient list"
          title="Upload recipient list (.csv / .txt)"
        >
          <Paperclip className="h-5 w-5" />
        </button>
        <div className="relative flex items-center gap-2">
          <button onClick={openLater} className="rounded-lg p-2 text-gray-600 hover:bg-surface" aria-label="Schedule">
            <Clock className="h-5 w-5" />
          </button>
          <button
            onClick={openLater}
            className="rounded-full border border-brand px-5 py-2 text-sm font-semibold text-brand transition hover:bg-brand-soft"
          >
            Send Later
          </button>
          {laterOpen && <SendLaterPopover busy={busy} onCancel={() => setLaterOpen(false)} onDone={schedule} />}
        </div>
      </div>

      <input ref={fileInput} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={onFile} />

      {result && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
          <div className="flex-1">
            <p className="font-semibold">
              {result.scheduled} email{result.scheduled === 1 ? '' : 's'} scheduled
            </p>
            <p className="text-muted">
              First send {formatFull(result.firstSendAt)} · last {formatFull(result.lastSendAt)} · max{' '}
              {result.hourlyLimit}/hour
              {result.skippedInvalid.length > 0 && ` · ${result.skippedInvalid.length} invalid address(es) skipped`}
            </p>
          </div>
          <div className="flex shrink-0 gap-3">
            <button onClick={reset} className="font-medium text-brand hover:underline">
              New email
            </button>
            <button onClick={() => router.push('/scheduled')} className="font-medium text-brand hover:underline">
              View scheduled
            </button>
          </div>
        </div>
      )}

      {error && <p className="mb-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="rounded-2xl border border-line bg-white px-5 py-2 sm:px-6">
        <div className={row}>
          <span className={label}>From</span>
          <div className="relative w-full sm:w-auto">
            <select
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              disabled={!senders}
              className="w-full appearance-none rounded-lg bg-surface py-2 pr-9 pl-3 text-sm font-medium outline-none sm:min-w-72"
            >
              {!senders && <option>Loading…</option>}
              {senders?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.email}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-muted" />
          </div>
        </div>

        <div className={row}>
          <span className={label}>To</span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {visibleChips.map((r) => (
              <span
                key={r}
                className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand-soft px-2.5 py-1 text-xs text-ink"
              >
                {r}
                <button
                  onClick={() => setRecipients((cur) => cur.filter((x) => x !== r))}
                  aria-label={`Remove ${r}`}
                  className="text-muted hover:text-ink"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {hidden > 0 && (
              <button
                onClick={() => setShowAll(true)}
                className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand"
              >
                +{hidden}
              </button>
            )}
            {showAll && recipients.length > MAX_VISIBLE_CHIPS && (
              <button onClick={() => setShowAll(false)} className="text-xs text-muted hover:underline">
                show less
              </button>
            )}
            <input
              className="min-w-40 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-gray-400"
              placeholder={recipients.length ? '' : 'recipient@example.com'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (['Enter', ',', ' ', 'Tab'].includes(e.key) && draft.trim()) {
                  e.preventDefault();
                  commitDraft();
                } else if (e.key === 'Backspace' && !draft && recipients.length) {
                  setRecipients((cur) => cur.slice(0, -1));
                }
              }}
              onBlur={commitDraft}
              onPaste={(e) => {
                const found = extractEmails(e.clipboardData.getData('text'));
                if (found.length > 1) {
                  e.preventDefault();
                  addRecipients(found);
                }
              }}
            />
          </div>
          <button
            onClick={() => fileInput.current?.click()}
            className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-brand hover:underline"
          >
            <Upload className="h-4 w-4" /> Upload List
          </button>
        </div>

        {(upload || recipients.length > 0) && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line py-2.5 text-xs text-muted sm:pl-20">
            {upload && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1">
                <FileText className="h-3.5 w-3.5" />
                {upload.name} · <strong className="text-ink">{upload.count}</strong> emails detected
                <button onClick={() => setUpload(null)} aria-label="Dismiss">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            <span>
              <strong className="text-ink">{recipients.length}</strong> recipient{recipients.length === 1 ? '' : 's'} in
              total
            </span>
            {recipients.length > 0 && (
              <button
                onClick={() => {
                  setRecipients([]);
                  setUpload(null);
                }}
                className="text-red-600 hover:underline"
              >
                Clear all
              </button>
            )}
          </div>
        )}

        <div className={row}>
          <span className={label}>Subject</span>
          <input
            className="flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-gray-400"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
          <label className="flex items-center gap-3 text-sm text-gray-700">
            Delay between 2 emails
            <span className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                placeholder="00"
                value={delaySec}
                onChange={(e) => setDelaySec(e.target.value)}
                className="w-16 rounded-lg border border-line px-2 py-1.5 text-center outline-none focus:border-brand"
              />
              <span className="text-xs text-muted">sec</span>
            </span>
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-700">
            Hourly Limit
            <input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="00"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(e.target.value)}
              className="w-20 rounded-lg border border-line px-2 py-1.5 text-center outline-none focus:border-brand"
            />
          </label>
        </div>

        <div className="pb-5">
          <RichTextEditor ref={editor} placeholder="Type Your Reply..." />
        </div>
      </div>
    </div>
  );
}
