'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Play, RotateCcw, Square, Terminal } from 'lucide-react';
import { ensureWorker, getLogs, isServerUp, resetDemo, startServer, stopServer } from '@/lib/demo/server';

/**
 * Demo mode only: shows the simulated backend's log output and lets you stop/start the
 * "server" to try the restart scenario, just like Ctrl+C / npm start on the real backend.
 */
export function ServerConsole() {
  const [open, setOpen] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [up, setUp] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureWorker();
    setOpen(window.innerWidth >= 1024);
    const refresh = () => {
      setLogs(getLogs());
      setUp(isServerUp());
    };
    refresh();
    const t = setInterval(refresh, 400);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' });
  }, [logs.length, open]);

  return (
    <div className="fixed right-4 bottom-4 z-50 w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-black/10 bg-[#1b1d23] text-[#d7dae0] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Terminal className="h-4 w-4 text-[#6ee7a8]" />
        <span className="text-xs font-semibold">Server console</span>
        <span
          className={`ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            up ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${up ? 'bg-emerald-400' : 'bg-red-400'}`} />
          {up ? 'running' : 'stopped'}
        </span>
        <span className="hidden text-[10px] text-white/40 sm:inline">simulated in your browser</span>
        <div className="ml-auto flex items-center gap-1">
          {up ? (
            <button
              onClick={stopServer}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-white/10"
              title="Stop the server (like Ctrl+C)"
            >
              <Square className="h-3 w-3" /> Stop server
            </button>
          ) : (
            <button
              onClick={startServer}
              className="flex items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-500/30"
              title="Start the server again (like npm start)"
            >
              <Play className="h-3 w-3" /> Start server
            </button>
          )}
          <button
            onClick={() => {
              if (confirm('Delete all demo users and emails stored in this browser?')) {
                resetDemo();
                window.location.href = '/login';
              }
            }}
            className="rounded-md p-1 hover:bg-white/10"
            title="Reset demo data"
            aria-label="Reset demo data"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-md p-1 hover:bg-white/10"
            aria-label={open ? 'Collapse console' : 'Expand console'}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="h-56 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5">
          {logs.length === 0 && <p className="text-white/40">No output yet.</p>}
          {logs.map((l, i) => (
            <p
              key={i}
              className={`whitespace-pre-wrap ${
                l.includes('hourly limit')
                  ? 'text-amber-300'
                  : l.includes('[shutdown]')
                    ? 'text-red-300'
                    : l.includes('sent ->')
                      ? 'text-emerald-200'
                      : ''
              }`}
            >
              {l}
            </p>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
