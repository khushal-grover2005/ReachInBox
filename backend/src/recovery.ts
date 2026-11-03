import { pool } from './db.js';
import { enqueueScheduledEmails } from './queue.js';

export async function recoverScheduledEmails(): Promise<number> {
  const { rows } = await pool.query<{ id: string; scheduled_at: Date }>(
    "SELECT id, scheduled_at FROM emails WHERE status = 'scheduled' ORDER BY scheduled_at, id",
  );
  await enqueueScheduledEmails(rows.map((email) => ({ id: email.id, scheduledAt: new Date(email.scheduled_at) })));
  return rows.length;
}
