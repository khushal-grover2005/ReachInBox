import { ArrowUpRight, CircleCheck, CircleX, Clock3, LoaderCircle } from 'lucide-react';
import type { EmailItem } from '../types';

interface EmailTableProps {
  emails: EmailItem[];
  kind: 'scheduled' | 'sent';
  loading: boolean;
  onCompose: () => void;
}

const formatDate = (value: string): string => new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}).format(new Date(value));

export function EmailTable({ emails, kind, loading, onCompose }: EmailTableProps) {
  if (loading) {
    return <div className="table-state"><LoaderCircle className="spin" size={22} /> Loading emails</div>;
  }
  if (emails.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon"><Clock3 size={22} /></span>
        <h3>{kind === 'scheduled' ? 'Nothing in the queue yet' : 'No deliveries yet'}</h3>
        <p>{kind === 'scheduled' ? 'Your scheduled messages will appear here.' : 'Sent and failed messages will appear here.'}</p>
        {kind === 'scheduled' && <button className="button button-primary button-small" onClick={onCompose}>Compose email <ArrowUpRight size={15} /></button>}
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className="email-table">
        <thead>
          <tr>
            <th>Recipient</th>
            <th>Subject</th>
            <th>{kind === 'scheduled' ? 'Scheduled for' : 'Sent at'}</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {emails.map((email) => (
            <tr key={email.id}>
              <td><span className="recipient-address">{email.recipient}</span></td>
              <td><span className="subject-cell">{email.subject}</span></td>
              <td className="date-cell">{formatDate(kind === 'scheduled' ? email.scheduled_at : email.sent_at ?? email.scheduled_at)}</td>
              <td>
                <span className={`status-pill status-${email.status}`}>
                  {email.status === 'failed' ? <CircleX size={13} /> : email.status === 'scheduled' ? <Clock3 size={13} /> : <CircleCheck size={13} />}
                  {email.status}
                </span>
                {email.error_message && <span className="error-hint" title={email.error_message}>Delivery issue</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
