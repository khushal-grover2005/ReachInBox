import nodemailer, { type Transporter } from 'nodemailer';
import { config, parseMailSenders, type MailSender } from './config.js';
import { pool } from './db.js';

let senders: MailSender[] = [];
const transports = new Map<string, Transporter>();

export async function initializeMail(): Promise<void> {
  senders = parseMailSenders();
  if (senders.length === 0) {
    const stored = await pool.query<{
      id: string;
      name: string;
      email: string;
      smtp_user: string;
      smtp_pass: string;
    }>('SELECT id, name, email, smtp_user, smtp_pass FROM mail_senders ORDER BY created_at');
    senders = stored.rows.map(({ id, name, email, smtp_user, smtp_pass }) => ({
      id,
      name,
      email,
      user: smtp_user,
      pass: smtp_pass,
    }));
  }
  if (senders.length === 0 && config.etherealAutoCreate) {
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(738291)');
      const stored = await client.query<{ id: string; name: string; email: string; smtp_user: string; smtp_pass: string }>(
        'SELECT id, name, email, smtp_user, smtp_pass FROM mail_senders ORDER BY created_at',
      );
      senders = stored.rows.map(({ id, name, email, smtp_user, smtp_pass }) => ({ id, name, email, user: smtp_user, pass: smtp_pass }));
      if (senders.length === 0) {
        const account = await nodemailer.createTestAccount();
        const sender = { id: 'ethereal-demo', name: 'Ethereal Demo', email: account.user, user: account.user, pass: account.pass };
        await client.query(
          'INSERT INTO mail_senders (id, name, email, smtp_user, smtp_pass) VALUES ($1, $2, $3, $4, $5)',
          [sender.id, sender.name, sender.email, sender.user, sender.pass],
        );
        senders = [sender];
        console.info(`Created Ethereal demo account for ${account.user}`);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock(738291)').catch(() => undefined);
      client.release();
    }
  }
  if (senders.length === 0) {
    throw new Error('Configure MAIL_SENDERS_JSON or set ETHEREAL_AUTO_CREATE=true');
  }
  for (const sender of senders) {
    transports.set(sender.id, nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: sender.user, pass: sender.pass },
    }));
  }
}

export function listMailSenders(): Array<Pick<MailSender, 'id' | 'name' | 'email'>> {
  return senders.map(({ id, name, email }) => ({ id, name, email }));
}

export async function sendEmail(input: {
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  emailId: string;
}): Promise<string | undefined> {
  const sender = senders.find(({ id }) => id === input.senderId);
  const transport = transports.get(input.senderId);
  if (!sender || !transport) throw new Error(`Unknown sender: ${input.senderId}`);
  const info = await transport.sendMail({
    from: { name: sender.name, address: sender.email },
    to: input.recipient,
    subject: input.subject,
    text: input.body,
    messageId: `<${input.emailId}@reachinbox.local>`,
  });
  return nodemailer.getTestMessageUrl(info) || undefined;
}
