CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slack_integrations (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mail_senders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  smtp_user TEXT NOT NULL,
  smtp_pass TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  delay_between_emails_ms INTEGER NOT NULL,
  hourly_limit INTEGER NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sending', 'sent', 'failed')),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, recipient)
);

CREATE INDEX IF NOT EXISTS emails_user_status_schedule_idx ON emails(user_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS emails_campaign_idx ON emails(campaign_id);
CREATE INDEX IF NOT EXISTS emails_recovery_idx ON emails(status, scheduled_at) WHERE status = 'scheduled';
