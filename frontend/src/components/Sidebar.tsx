'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Clock, LogOut, Send, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useStats } from '@/lib/stats';
import { Avatar } from './Avatar';

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, signOut } = useAuth();
  const { stats } = useStats();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (!user) return null;

  const nav = [
    { href: '/scheduled', label: 'Scheduled', icon: Clock, count: stats?.scheduled },
    { href: '/sent', label: 'Sent', icon: Send, count: stats?.sent },
  ];

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[270px] flex-col border-r border-line bg-white px-4 py-5 transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-6 flex items-center justify-between px-2">
          <span className="text-2xl font-extrabold tracking-tight">ONB</span>
          <button className="lg:hidden" onClick={onClose} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div ref={menuRef} className="relative mb-5">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex w-full items-center gap-3 rounded-xl bg-surface p-3 text-left transition hover:bg-gray-100"
          >
            <Avatar name={user.name} src={user.avatarUrl} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{user.name}</span>
              <span className="block truncate text-xs text-muted">{user.email}</span>
            </span>
            <ChevronDown className={`h-4 w-4 text-muted transition ${menuOpen ? 'rotate-180' : ''}`} />
          </button>
          {menuOpen && (
            <div className="absolute inset-x-0 top-full z-10 mt-1 rounded-xl border border-line bg-white p-1 shadow-lg">
              <button
                onClick={() => {
                  signOut();
                  router.replace('/login');
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" /> Logout
              </button>
            </div>
          )}
        </div>

        <Link
          href="/compose"
          onClick={onClose}
          className="mb-6 flex items-center justify-center rounded-full border border-brand py-2.5 text-sm font-semibold text-brand transition hover:bg-brand-soft"
        >
          Compose
        </Link>

        <p className="mb-2 px-3 text-xs font-semibold tracking-wider text-muted">CORE</p>
        <nav className="space-y-1">
          {nav.map(({ href, label, icon: Icon, count }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                  active ? 'bg-brand-soft font-semibold text-ink' : 'text-gray-700 hover:bg-surface'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{label}</span>
                <span className="text-xs text-muted">{count ?? '–'}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
