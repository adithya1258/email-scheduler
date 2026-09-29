'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Star } from 'lucide-react';
import { api, EmailDetail } from '@/lib/api';
import { formatFull } from '@/lib/format';
import { Avatar } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { StatusPill } from '@/components/StatusPill';

export default function EmailDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [email, setEmail] = useState<EmailDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<EmailDetail>(`/api/emails/${id}`)
      .then((e) => {
        setEmail(e);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, [load]);

  async function toggleStar() {
    if (!email) return;
    const starred = !email.starred;
    setEmail({ ...email, starred });
    await api(`/api/emails/${email.id}/star`, { method: 'PATCH', body: JSON.stringify({ starred }) }).catch(() =>
      setEmail((e) => (e ? { ...e, starred: !starred } : e)),
    );
  }

  const back = () => (window.history.length > 1 ? router.back() : router.push('/scheduled'));

  if (error && !email) {
    return (
      <div className="p-6">
        <button onClick={back} className="mb-4 flex items-center gap-2 text-sm text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      </div>
    );
  }
  if (!email) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const when = email.status === 'sent' && email.sent_at ? email.sent_at : email.scheduled_at;

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={back} className="rounded-lg p-1.5 hover:bg-surface" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{email.subject}</h1>
        <StatusPill status={email.status} scheduledAt={email.scheduled_at} />
        <button onClick={toggleStar} className="rounded-lg p-1.5 hover:bg-surface" aria-label="Star">
          <Star className={`h-5 w-5 ${email.starred ? 'fill-amber-400 text-amber-400' : 'text-gray-400'}`} />
        </button>
      </div>

      <div className="mb-6 flex items-start gap-3">
        <Avatar name={email.from_name} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-semibold">{email.from_name}</span>{' '}
            <span className="text-muted">&lt;{email.from_email}&gt;</span>
          </p>
          <p className="text-xs text-muted">to {email.to_email}</p>
        </div>
        <p className="shrink-0 text-xs text-muted">
          {email.status === 'sent' ? 'Sent ' : email.status === 'failed' ? 'Failed · ' : 'Scheduled for '}
          {formatFull(when)}
        </p>
      </div>

      <div
        className="email-body text-sm leading-relaxed"
        // Body is the user's own composed HTML, rendered back only to them.
        dangerouslySetInnerHTML={{ __html: email.body }}
      />

      <div className="mt-10 space-y-2 rounded-xl bg-surface p-4 text-xs text-muted">
        <p>Delivery attempts: {email.attempts}</p>
        {email.message_id && <p className="break-all">Message-ID: {email.message_id}</p>}
        {email.error && <p className="text-red-700">Last error: {email.error}</p>}
        {email.preview_url && (
          <a
            href={email.preview_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
          >
            View in Ethereal inbox <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
