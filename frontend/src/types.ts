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

export interface EmailItem {
  id: string;
  recipient: string;
  subject: string;
  sender_id: string;
  scheduled_at: string;
  sent_at: string | null;
  status: 'scheduled' | 'sending' | 'sent' | 'failed';
  error_message?: string | null;
}

export interface ScheduleInput {
  subject: string;
  body: string;
  recipients: string[];
  senderId: string;
  startsAt: string;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
}

export interface SlackStatus {
  connected: boolean;
  connectedAt: string | null;
}
