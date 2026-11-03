import { pool } from './db.js';

interface SlackIntegration {
  access_token: string;
  slack_user_id: string;
}

export async function notifyRateLimit(userId: string, senderName: string, windowStart: number): Promise<void> {
  const { rows } = await pool.query<SlackIntegration>(
    'SELECT access_token, slack_user_id FROM slack_integrations WHERE user_id = $1',
    [userId],
  );
  const integration = rows[0];
  if (!integration) return;

  const openResponse = await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ users: integration.slack_user_id }),
  });
  const openResult = await openResponse.json() as { ok: boolean; channel?: { id: string }; error?: string };
  if (!openResult.ok || !openResult.channel?.id) throw new Error(`Slack DM open failed: ${openResult.error ?? 'unknown error'}`);

  const date = new Date(windowStart).toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' });
  const messageResponse = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: openResult.channel.id,
      text: `Hourly email limit reached for sender ${senderName} at ${date}. Remaining messages have been deferred to the next available window.`,
    }),
  });
  const result = await messageResponse.json() as { ok: boolean; error?: string };
  if (!result.ok) throw new Error(`Slack notification failed: ${result.error ?? 'unknown error'}`);
}
