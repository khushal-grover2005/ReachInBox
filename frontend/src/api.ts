import type { EmailItem, ScheduleInput, Sender, SlackStatus, User } from './types';

const apiRoot = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiRoot}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  me: () => request<{ user: User | null }>('/auth/me'),
  authConfig: () => request<{ googleConfigured: boolean }>('/auth/config'),
  senders: () => request<{ senders: Sender[]; maxHourlyLimit: number; minSendIntervalMs: number }>('/senders'),
  emails: (status: 'scheduled' | 'sent') => request<{ emails: EmailItem[] }>(`/emails?status=${status}`),
  search: (query: string) => request<{ emails: EmailItem[] }>(`/emails/search?q=${encodeURIComponent(query)}`),
  slackStatus: () => request<SlackStatus>('/slack/status'),
  disconnectSlack: () => request<void>('/slack/disconnect', { method: 'POST' }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  schedule: (input: ScheduleInput) => request<{ campaignId: string; scheduledCount: number; sender: string }>('/emails/schedule', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(input),
  }),
};

export const googleLoginUrl = `${apiRoot}/auth/google`;
export const slackConnectUrl = `${apiRoot}/slack/connect`;
