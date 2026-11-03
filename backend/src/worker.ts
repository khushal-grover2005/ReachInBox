import { DelayedError, Worker, type Job } from 'bullmq';
import { config } from './config.js';
import { initializeDatabase, pool } from './db.js';
import { initializeMail, listMailSenders, sendEmail } from './mail.js';
import { claimRateLimitNotification, reserveSendSlot } from './rate-limit.js';
import { EmailJobData, redis } from './queue.js';
import { recoverScheduledEmails } from './recovery.js';
import { indexEmail } from './search.js';
import { notifyRateLimit } from './slack.js';

interface EmailRow {
  id: string;
  campaign_id: string;
  user_id: string;
  recipient: string;
  subject: string;
  body: string;
  sender_id: string;
  status: 'scheduled' | 'sending' | 'sent' | 'failed';
  scheduled_at: Date;
  sent_at: Date | null;
  hourly_limit: number;
  delay_between_emails_ms: number;
}

async function processEmail(job: Job<EmailJobData>, token?: string): Promise<void> {
  const result = await pool.query<EmailRow>(
    `SELECT e.id, e.campaign_id, e.user_id, e.recipient, e.subject, e.body, e.sender_id, e.status,
            e.scheduled_at, e.sent_at, c.hourly_limit, c.delay_between_emails_ms
     FROM emails e JOIN campaigns c ON c.id = e.campaign_id WHERE e.id = $1`,
    [job.data.emailId],
  );
  const email = result.rows[0];
  if (!email || email.status === 'sent' || email.status === 'failed') return;
  if (email.status === 'sending') {
    const errorMessage = 'SMTP delivery was interrupted; reconcile with the provider before retrying.';
    await pool.query("UPDATE emails SET status = 'failed', error_message = $2 WHERE id = $1 AND status = 'sending'", [email.id, errorMessage]);
    await indexEmail({ ...email, status: 'failed', scheduled_at: email.scheduled_at.toISOString(), sent_at: null });
    return;
  }

  const senderLimit = config.maxEmailsPerHourPerSender;
  const campaignLimit = Math.min(email.hourly_limit, senderLimit);
  const intervalMs = Math.max(config.minSendIntervalMs, email.delay_between_emails_ms);
  const slot = await reserveSendSlot({
    senderId: email.sender_id,
    campaignId: email.campaign_id,
    emailId: email.id,
    now: Date.now(),
    intervalMs,
    senderLimit,
    campaignLimit,
  });
  if (slot.rateLimited && await claimRateLimitNotification(email.sender_id, slot.windowStart)) {
    const sender = listMailSenders().find(({ id }) => id === email.sender_id);
    try {
      await notifyRateLimit(email.user_id, sender?.name ?? email.sender_id, slot.windowStart);
    } catch (error) {
      console.error('Slack rate-limit notification failed', error);
    }
  }
  if (slot.dueAt > Date.now() + 50) {
    if (!token) throw new Error('BullMQ worker did not provide a lock token for delayed job');
    await job.moveToDelayed(slot.dueAt, token);
    throw new DelayedError();
  }

  const claimed = await pool.query("UPDATE emails SET status = 'sending', error_message = NULL WHERE id = $1 AND status = 'scheduled' RETURNING id", [email.id]);
  if (!claimed.rowCount) return;
  try {
    const previewUrl = await sendEmail({
      senderId: email.sender_id,
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      emailId: email.id,
    });
    const sentAt = new Date();
    await pool.query("UPDATE emails SET status = 'sent', sent_at = $2, error_message = NULL WHERE id = $1", [email.id, sentAt]);
    await indexEmail({
      id: email.id,
      user_id: email.user_id,
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      sender_id: email.sender_id,
      status: 'sent',
      scheduled_at: email.scheduled_at.toISOString(),
      sent_at: sentAt.toISOString(),
    });
    if (previewUrl) console.info(`Ethereal preview for ${email.recipient}: ${previewUrl}`);
  } catch (error) {
    await pool.query("UPDATE emails SET status = 'scheduled', error_message = $2 WHERE id = $1", [email.id, String(error).slice(0, 1000)]);
    throw error;
  }
}

async function start(): Promise<void> {
  await initializeDatabase();
  await initializeMail();
  const recovered = await recoverScheduledEmails();
  console.info(`Worker restored ${recovered} scheduled email jobs`);

  const worker = new Worker<EmailJobData>('scheduled-emails', processEmail, {
    connection: redis,
    concurrency: config.workerConcurrency,
  });
  worker.on('completed', (job) => console.info(`Email job completed: ${job.data.emailId}`));
  worker.on('failed', (job, error) => {
    if (!job) return;
    console.error(`Email job failed: ${job.data.emailId}`, error.message);
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      void pool.query("UPDATE emails SET status = 'failed', error_message = $2 WHERE id = $1 AND status <> 'sent'", [job.data.emailId, error.message.slice(0, 1000)])
        .then(async ({ rows }) => {
          const { rows: emailRows } = await pool.query<EmailRow>(
            `SELECT e.id, e.campaign_id, e.user_id, e.recipient, e.subject, e.body, e.sender_id, e.status,
                    e.scheduled_at, e.sent_at, c.hourly_limit, c.delay_between_emails_ms
             FROM emails e JOIN campaigns c ON c.id = e.campaign_id WHERE e.id = $1`,
            [job.data.emailId],
          );
          const email = emailRows[0];
          if (email) await indexEmail({ ...email, status: 'failed', scheduled_at: email.scheduled_at.toISOString(), sent_at: email.sent_at?.toISOString() ?? null });
          return rows;
        })
        .catch((updateError: unknown) => console.error('Could not persist final job failure', updateError));
    }
  });
  worker.on('error', (error) => console.error('BullMQ worker error', error));

  const shutdown = async (): Promise<void> => {
    await worker.close();
    await Promise.all([pool.end(), redis.quit()]);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

start().catch((error: unknown) => {
  console.error('Worker startup failed', error);
  process.exitCode = 1;
});
