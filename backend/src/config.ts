import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

export interface MailSender {
  id: string;
  name: string;
  email: string;
  user: string;
  pass: string;
}

const positiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  port: positiveInteger(process.env.PORT, 4000),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://reachinbox:reachinbox@localhost:5432/reachinbox',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  elasticsearchUrl: process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200',
  elasticsearchIndex: process.env.ELASTICSEARCH_INDEX ?? 'reachinbox-emails',
  sessionSecret: process.env.SESSION_SECRET ?? 'development-only-change-me',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:4000/api/auth/google/callback',
  slackClientId: process.env.SLACK_CLIENT_ID ?? '',
  slackClientSecret: process.env.SLACK_CLIENT_SECRET ?? '',
  slackCallbackUrl: process.env.SLACK_CALLBACK_URL ?? 'http://localhost:4000/api/slack/callback',
  workerConcurrency: positiveInteger(process.env.WORKER_CONCURRENCY, 8),
  maxEmailsPerHourPerSender: positiveInteger(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER, 200),
  minSendIntervalMs: positiveInteger(process.env.MIN_SEND_INTERVAL_MS, 2000),
  maxCampaignRecipients: positiveInteger(process.env.MAX_CAMPAIGN_RECIPIENTS, 5000),
  etherealAutoCreate: process.env.ETHEREAL_AUTO_CREATE === 'true',
  queueDashboardPassword: process.env.QUEUE_DASHBOARD_PASSWORD ?? '',
  mailSendersJson: process.env.MAIL_SENDERS_JSON ?? '[]',
};

export const parseMailSenders = (): MailSender[] => {
  const senders = JSON.parse(config.mailSendersJson) as MailSender[];
  return senders.map((sender) => {
    if (!sender.id || !sender.name || !sender.email || !sender.user || !sender.pass) {
      throw new Error('Each MAIL_SENDERS_JSON sender needs id, name, email, user, and pass');
    }
    return sender;
  });
};
