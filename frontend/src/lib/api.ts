export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'es_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) – session just won't persist */
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) {
      setToken(null);
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface Sender {
  id: string;
  name: string;
  email: string;
}

export type EmailStatus = 'scheduled' | 'sending' | 'sent' | 'failed';

export interface EmailItem {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduled_at: string;
  sent_at: string | null;
  preview_url: string | null;
  error: string | null;
  starred: boolean;
  from_email: string;
  from_name: string;
}

export interface EmailDetail extends EmailItem {
  attempts: number;
  message_id: string | null;
  created_at: string;
  campaign_id: string;
}

export interface Stats {
  scheduled: number;
  sent: number;
  failed: number;
}

export interface ScheduleRequest {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startAt: string;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
}

export interface ScheduleResponse {
  campaignId: string;
  scheduled: number;
  skippedInvalid: string[];
  hourlyLimit: number;
  firstSendAt: string;
  lastSendAt: string;
}
