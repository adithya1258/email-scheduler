import { Clock, AlertCircle, Loader2 } from 'lucide-react';
import type { EmailStatus } from '@/lib/api';
import { formatPillTime } from '@/lib/format';

export function StatusPill({ status, scheduledAt }: { status: EmailStatus; scheduledAt: string }) {
  if (status === 'scheduled') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn">
        <Clock className="h-3.5 w-3.5" />
        {formatPillTime(scheduledAt)}
      </span>
    );
  }
  if (status === 'sending') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Sending
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
        <AlertCircle className="h-3.5 w-3.5" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
      Sent
    </span>
  );
}
