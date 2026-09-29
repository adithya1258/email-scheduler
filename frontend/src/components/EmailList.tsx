'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Filter, Inbox, RefreshCw, Search, Send, Star } from 'lucide-react';
import { api, EmailItem } from '@/lib/api';
import { htmlToText } from '@/lib/format';
import { useStats } from '@/lib/stats';
import { StatusPill } from './StatusPill';

type Tab = 'scheduled' | 'sent';

const EMPTY: Record<Tab, { title: string; text: string }> = {
  scheduled: { title: 'No scheduled emails', text: 'Emails you schedule from Compose will show up here until they are sent.' },
  sent: { title: 'Nothing sent yet', text: 'Once a scheduled email goes out it moves here.' },
};

export function EmailList({ tab }: { tab: Tab }) {
  const [items, setItems] = useState<EmailItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { refreshStats } = useStats();
  const requestId = useRef(0);

  const load = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      const id = ++requestId.current;
      if (!opts.quiet) setRefreshing(true);
      try {
        const params = new URLSearchParams({ tab, limit: '100' });
        if (search.trim()) params.set('search', search.trim());
        const r = await api<{ items: EmailItem[]; total: number }>(`/api/emails?${params}`);
        if (id !== requestId.current) return; // a newer request superseded this one
        setItems(r.items);
        setTotal(r.total);
        setError(null);
      } catch (e) {
        if (id === requestId.current) setError(e instanceof Error ? e.message : 'Failed to load emails');
      } finally {
        if (id === requestId.current) setRefreshing(false);
      }
    },
    [tab, search],
  );

  // Debounced reload on search change + polling so statuses update live.
  useEffect(() => {
    const t = setTimeout(() => load(), search ? 300 : 0);
    const poll = setInterval(() => load({ quiet: true }), 5_000);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
    };
  }, [load, search]);

  async function toggleStar(e: React.MouseEvent, item: EmailItem) {
    e.preventDefault();
    e.stopPropagation();
    const starred = !item.starred;
    setItems((cur) => cur?.map((i) => (i.id === item.id ? { ...i, starred } : i)) ?? cur);
    await api(`/api/emails/${item.id}/star`, { method: 'PATCH', body: JSON.stringify({ starred }) }).catch(() => {
      setItems((cur) => cur?.map((i) => (i.id === item.id ? { ...i, starred: !starred } : i)) ?? cur);
    });
  }

  const visible = items?.filter((i) => !starredOnly || i.starred) ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-white px-4 py-3 sm:px-6">
        <label className="flex flex-1 items-center gap-2 rounded-lg bg-surface px-3 py-2">
          <Search className="h-4 w-4 text-muted" />
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="relative">
          <button
            onClick={() => setFilterOpen((v) => !v)}
            className={`rounded-lg p-2 transition hover:bg-surface ${starredOnly ? 'text-brand' : 'text-gray-600'}`}
            aria-label="Filter"
          >
            <Filter className="h-5 w-5" />
          </button>
          {filterOpen && (
            <div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-line bg-white p-1 text-sm shadow-lg">
              {[
                { label: 'All emails', value: false },
                { label: 'Starred only', value: true },
              ].map((o) => (
                <button
                  key={o.label}
                  onClick={() => {
                    setStarredOnly(o.value);
                    setFilterOpen(false);
                  }}
                  className={`block w-full rounded-lg px-3 py-2 text-left hover:bg-surface ${
                    starredOnly === o.value ? 'font-semibold text-brand' : ''
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => {
            load();
            refreshStats();
          }}
          className="rounded-lg p-2 text-gray-600 transition hover:bg-surface"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6">
          {error}{' '}
          <button className="font-medium underline" onClick={() => load()}>
            Retry
          </button>
        </div>
      )}

      {visible === null && !error && <ListSkeleton />}

      {visible && visible.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand">
            {tab === 'scheduled' ? <Inbox className="h-6 w-6" /> : <Send className="h-6 w-6" />}
          </span>
          <p className="font-semibold">{search || starredOnly ? 'No matching emails' : EMPTY[tab].title}</p>
          <p className="mt-1 max-w-sm text-sm text-muted">
            {search || starredOnly ? 'Try a different search or filter.' : EMPTY[tab].text}
          </p>
          {tab === 'scheduled' && !search && !starredOnly && (
            <Link
              href="/compose"
              className="mt-5 rounded-full border border-brand px-5 py-2 text-sm font-semibold text-brand hover:bg-brand-soft"
            >
              Compose
            </Link>
          )}
        </div>
      )}

      {visible && visible.length > 0 && (
        <ul className="divide-y divide-line">
          {visible.map((item) => (
            <li key={item.id}>
              <Link
                href={`/email/${item.id}`}
                className="flex flex-col gap-1.5 px-4 py-4 transition hover:bg-surface sm:flex-row sm:items-center sm:gap-4 sm:px-6"
              >
                <span className="w-full shrink-0 truncate text-sm sm:w-56">
                  <span className="text-muted">To: </span>
                  <span className="font-medium">{item.to_email}</span>
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <StatusPill status={item.status} scheduledAt={item.scheduled_at} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-semibold">{item.subject}</span>
                    <span className="text-muted"> - {htmlToText(item.body)}</span>
                  </span>
                  <button
                    onClick={(e) => toggleStar(e, item)}
                    className="shrink-0 rounded p-1 hover:bg-gray-100"
                    aria-label={item.starred ? 'Unstar' : 'Star'}
                  >
                    <Star className={`h-4 w-4 ${item.starred ? 'fill-amber-400 text-amber-400' : 'text-gray-400'}`} />
                  </button>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {visible && total > visible.length && !starredOnly && (
        <p className="py-4 text-center text-xs text-muted">
          Showing {visible.length} of {total}. Use search to narrow down.
        </p>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-line" aria-busy>
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="flex animate-pulse items-center gap-4 px-6 py-5">
          <span className="h-3 w-44 rounded bg-gray-200" />
          <span className="h-5 w-28 rounded-full bg-gray-100" />
          <span className="h-3 flex-1 rounded bg-gray-100" />
        </li>
      ))}
    </ul>
  );
}
