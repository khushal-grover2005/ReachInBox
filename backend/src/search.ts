import { Client } from '@elastic/elasticsearch';
import { config } from './config.js';
import { pool } from './db.js';

export const searchClient = new Client({ node: config.elasticsearchUrl });

export interface SearchableEmail {
  id: string;
  user_id: string;
  recipient: string;
  subject: string;
  body: string;
  sender_id: string;
  status: string;
  scheduled_at: string;
  sent_at: string | null;
}

export async function indexEmail(email: SearchableEmail): Promise<void> {
  try {
    await searchClient.index({
      index: config.elasticsearchIndex,
      id: email.id,
      document: email,
      refresh: false,
    });
  } catch (error) {
    console.error('Elasticsearch indexing failed', error);
  }
}

export async function searchEmails(userId: string, query: string): Promise<SearchableEmail[]> {
  try {
    const result = await searchClient.search<SearchableEmail>({
      index: config.elasticsearchIndex,
      size: 100,
      query: {
        bool: {
          must: [{ multi_match: { query, fields: ['recipient^3', 'subject^2', 'body', 'sender_id'] } }],
          filter: [{ term: { user_id: userId } }],
        },
      },
      sort: [{ scheduled_at: 'desc' }],
    });
    return result.hits.hits.flatMap((hit) => hit._source ? [hit._source] : []);
  } catch (error) {
    console.warn('Elasticsearch unavailable; using PostgreSQL search', error);
    const { rows } = await pool.query<{
      id: string;
      user_id: string;
      recipient: string;
      subject: string;
      body: string;
      sender_id: string;
      status: string;
      scheduled_at: Date;
      sent_at: Date | null;
    }>(
      `SELECT id, user_id, recipient, subject, body, sender_id, status, scheduled_at, sent_at
       FROM emails
       WHERE user_id = $1 AND (recipient ILIKE $2 OR subject ILIKE $2 OR body ILIKE $2 OR sender_id ILIKE $2)
       ORDER BY scheduled_at DESC LIMIT 100`,
      [userId, `%${query}%`],
    );
    return rows.map((email) => ({
      ...email,
      scheduled_at: email.scheduled_at.toISOString(),
      sent_at: email.sent_at?.toISOString() ?? null,
    }));
  }
}
