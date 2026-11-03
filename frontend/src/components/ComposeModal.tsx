import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { FileUp, LoaderCircle, X } from 'lucide-react';
import type { ScheduleInput, Sender } from '../types';

interface ComposeModalProps {
  senders: Sender[];
  maxHourlyLimit: number;
  minSendIntervalMs: number;
  onClose: () => void;
  onSchedule: (input: ScheduleInput) => Promise<void>;
}

const findEmails = (value: string): string[] => {
  const matches = value.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) ?? [];
  return [...new Set(matches.map((email) => email.toLowerCase()))];
};

const localDateTime = (date: Date): string => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export function ComposeModal({ senders, maxHourlyLimit, minSendIntervalMs, onClose, onSchedule }: ComposeModalProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [senderId, setSenderId] = useState(senders[0]?.id ?? '');
  const [startAt, setStartAt] = useState(() => localDateTime(new Date(Date.now() + 60_000)));
  const [delaySeconds, setDelaySeconds] = useState(Math.ceil(minSendIntervalMs / 1000));
  const [hourlyLimit, setHourlyLimit] = useState(Math.min(50, maxHourlyLimit));
  const [recipientText, setRecipientText] = useState('');
  const [fileName, setFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const recipients = useMemo(() => findEmails(recipientText), [recipientText]);

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setRecipientText(await file.text());
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError('');
    if (recipients.length === 0) {
      setError('Upload a CSV or text file containing at least one email address.');
      return;
    }
    setSubmitting(true);
    try {
      await onSchedule({
        subject,
        body,
        recipients,
        senderId,
        startsAt: new Date(startAt).toISOString(),
        delayBetweenEmailsMs: Math.max(minSendIntervalMs, Math.round(delaySeconds * 1000)),
        hourlyLimit,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not schedule email.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="compose-modal" role="dialog" aria-modal="true" aria-labelledby="compose-title">
        <header className="modal-header">
          <div>
            <p className="eyebrow">NEW CAMPAIGN</p>
            <h2 id="compose-title">Compose email</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close compose window" onClick={onClose}><X size={18} /></button>
        </header>
        <form onSubmit={submit}>
          <label className="field-label" htmlFor="subject">Subject</label>
          <input id="subject" className="field-input" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={500} required placeholder="A clear subject line" />

          <label className="field-label" htmlFor="body">Message</label>
          <textarea id="body" className="field-input message-input" value={body} onChange={(event) => setBody(event.target.value)} required placeholder="Write your email here..." />

          <div className="field-heading">
            <label className="field-label" htmlFor="leads">Recipients</label>
            <span className="recipient-count">{recipients.length} detected</span>
          </div>
          <label className="upload-zone" htmlFor="lead-file">
            <span className="upload-icon"><FileUp size={19} /></span>
            <span><strong>{fileName || 'Choose a CSV or text file'}</strong><small>CSV, TXT · email addresses are extracted automatically</small></span>
            <input id="lead-file" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => void onFileChange(event)} />
          </label>
          <textarea id="leads" className="field-input recipient-preview" value={recipientText} onChange={(event) => setRecipientText(event.target.value)} placeholder="Or paste email addresses here" aria-label="Paste recipient email addresses" />

          <div className="form-grid">
            <div>
              <label className="field-label" htmlFor="sender">Send from</label>
              <select id="sender" className="field-input" value={senderId} onChange={(event) => setSenderId(event.target.value)} required>
                {senders.map((sender) => <option value={sender.id} key={sender.id}>{sender.name} · {sender.email}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="start-at">Start time</label>
              <input id="start-at" className="field-input" type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} required />
            </div>
            <div>
              <label className="field-label" htmlFor="delay">Delay between emails</label>
              <div className="number-input-wrap"><input id="delay" className="field-input" type="number" min={Math.ceil(minSendIntervalMs / 1000)} step="1" value={delaySeconds} onChange={(event) => setDelaySeconds(Number(event.target.value))} required /><span>seconds</span></div>
            </div>
            <div>
              <label className="field-label" htmlFor="hour-limit">Hourly limit</label>
              <div className="number-input-wrap"><input id="hour-limit" className="field-input" type="number" min="1" max={maxHourlyLimit} value={hourlyLimit} onChange={(event) => setHourlyLimit(Number(event.target.value))} required /><span>per hour</span></div>
            </div>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <footer className="modal-footer">
            <span className="schedule-note">{recipients.length.toLocaleString()} {recipients.length === 1 ? 'message' : 'messages'} will be queued</span>
            <button type="button" className="button button-quiet" onClick={onClose}>Cancel</button>
            <button type="submit" className="button button-primary" disabled={submitting || senders.length === 0}>
              {submitting ? <><LoaderCircle className="spin" size={16} /> Scheduling</> : 'Schedule emails'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
