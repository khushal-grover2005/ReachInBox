import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
export const emailQueue = new Queue('scheduled-emails', { connection: redis });

export interface EmailJobData {
  emailId: string;
}

export async function enqueueScheduledEmail(emailId: string, scheduledAt: Date): Promise<void> {
  await enqueueScheduledEmails([{ id: emailId, scheduledAt }]);
}

export async function enqueueScheduledEmails(emails: Array<{ id: string; scheduledAt: Date }>): Promise<void> {
  if (emails.length === 0) return;
  await emailQueue.addBulk(emails.map(({ id, scheduledAt }) => ({
    name: 'send-email',
    data: { emailId: id } satisfies EmailJobData,
    opts: {
      jobId: id,
      delay: Math.max(0, scheduledAt.getTime() - Date.now()),
      attempts: 4,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 604800, count: 10000 },
      removeOnFail: { age: 2592000, count: 20000 },
    },
  })));
}
