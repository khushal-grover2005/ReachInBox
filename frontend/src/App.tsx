import { useEffect, useState } from 'react';
import {
  Activity, ArrowDownToLine, ArrowUpRight, Bell, Check, ChevronDown, Clock3,
  Command, Inbox, LogOut, Mail, MailPlus, MessageSquare, Search, Send, Settings2,
  ShieldCheck, Sparkles,
} from 'lucide-react';
import { api, googleLoginUrl, slackConnectUrl } from './api';
import { ComposeModal } from './components/ComposeModal';
import { EmailTable } from './components/EmailTable';
import type { EmailItem, ScheduleInput, Sender, SlackStatus, User } from './types';
import './dashboard.css';

type View = 'scheduled' | 'sent';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [view, setView] = useState<View>('scheduled');
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [slack, setSlack] = useState<SlackStatus>({ connected: false, connectedAt: null });
  const [maxHourlyLimit, setMaxHourlyLimit] = useState(200);
  const [minSendIntervalMs, setMinSendIntervalMs] = useState(2000);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const [loadingEmails, setLoadingEmails] = useState(true);
  const [search, setSearch] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [pageError, setPageError] = useState('');

  useEffect(() => {
    let active = true;
    api.me()
      .then(({ user: currentUser }) => { if (active) setUser(currentUser); })
      .catch((error: unknown) => { if (active) setPageError(error instanceof Error ? error.message : 'Could not reach the API.'); })
      .finally(() => { if (active) setAuthLoading(false); });
    api.authConfig()
      .then(({ googleConfigured: isConfigured }) => { if (active) setGoogleConfigured(isConfigured); })
      .catch(() => { if (active) setGoogleConfigured(false); });
    const params = new URLSearchParams(window.location.search);
    if (params.has('slackConnected')) setToast('Slack connected. Rate-limit alerts will be sent by DM.');
    if (params.has('slackError')) setPageError('Slack could not be connected. Check the Slack app configuration and try again.');
    if (params.get('authError') === 'google_config') {
      setPageError('Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the root .env, then restart the API.');
    } else if (params.has('authError')) {
      setPageError('Google sign-in did not complete. Please try again.');
    }
    if (params.size) window.history.replaceState({}, '', window.location.pathname);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    api.senders().then((result) => {
      if (!active) return;
      setSenders(result.senders);
      setMaxHourlyLimit(result.maxHourlyLimit);
      setMinSendIntervalMs(result.minSendIntervalMs);
    }).catch((error: unknown) => {
      if (active) setPageError(error instanceof Error ? error.message : 'Could not load senders.');
    });
    api.slackStatus().then((status) => { if (active) setSlack(status); }).catch(() => undefined);
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoadingEmails(true);
    const query = search.trim();
    const loadEmails = query.length >= 2 ? api.search(query) : api.emails(view);
    Promise.all([loadEmails, api.emails('scheduled'), api.emails('sent')])
      .then(([result, scheduled, sent]) => {
        if (!active) return;
        setEmails(result.emails);
        setScheduledCount(scheduled.emails.length);
        setSentCount(sent.emails.length);
      })
      .catch((error: unknown) => {
        if (active) setPageError(error instanceof Error ? error.message : 'Could not load email activity.');
      })
      .finally(() => { if (active) setLoadingEmails(false); });
    return () => { active = false; };
  }, [user, view, search]);

  const schedule = async (input: ScheduleInput): Promise<void> => {
    const result = await api.schedule(input);
    setComposeOpen(false);
    setToast(`${result.scheduledCount.toLocaleString()} emails added to the schedule.`);
    setPageError('');
    const [activeResult, scheduled, sent] = await Promise.all([
      search.trim().length >= 2 ? api.search(search.trim()) : api.emails(view),
      api.emails('scheduled'),
      api.emails('sent'),
    ]);
    setEmails(activeResult.emails);
    setScheduledCount(scheduled.emails.length);
    setSentCount(sent.emails.length);
  };

  const disconnectSlack = async (): Promise<void> => {
    await api.disconnectSlack();
    setSlack({ connected: false, connectedAt: null });
    setToast('Slack disconnected.');
  };

  const logout = async (): Promise<void> => {
    await api.logout();
    setUser(null);
    setEmails([]);
  };

  const exportEmails = (): void => {
    const columns = ['recipient', 'subject', 'sender_id', 'status', 'scheduled_at', 'sent_at'];
    const escapeCell = (value: string): string => `"${value.replaceAll('"', '""')}"`;
    const rows = emails.map((email) => [email.recipient, email.subject, email.sender_id, email.status, email.scheduled_at, email.sent_at ?? '']);
    const csv = [columns, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${view}-emails.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (authLoading) return <div className="boot-screen"><span className="brand-mark"><Mail size={20} /></span><span className="spin-line" /></div>;
  if (!user) {
    return (
      <main className="login-screen">
        <div className="login-orbit orbit-one" />
        <div className="login-orbit orbit-two" />
        <section className="login-panel">
          <div className="brand-lockup"><span className="brand-mark"><Mail size={20} /></span><span>reachinbox</span></div>
          <p className="eyebrow">EMAIL OPERATIONS</p>
          <h1>Make every send<br /><em>count.</em></h1>
          <p className="login-copy">Schedule thoughtfully. Deliver reliably. Keep every message in view.</p>
          {pageError && <p className="form-error" role="alert">{pageError}</p>}
          <a className="button button-primary google-button" href={googleLoginUrl}><span className="google-g">G</span> Continue with Google <ArrowUpRight size={16} /></a>
          {!googleConfigured && <p className="oauth-setup" role="status">Add your Google OAuth client ID and secret to the root `.env` to enable sign-in.</p>}
          <div className="login-foot"><ShieldCheck size={15} /> Protected with Google OAuth</div>
        </section>
        <aside className="login-note"><span className="tiny-dot" /> A steadier rhythm for your outbound.</aside>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><span className="brand-mark"><Mail size={19} /></span><span>reachinbox</span></div>
        <div className="workspace-switch"><span className="workspace-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span className="workspace-name"><strong>{user.name.split(' ')[0]}'s workspace</strong><small>Personal workspace</small></span><ChevronDown size={15} /></div>
        <p className="nav-caption">WORKSPACE</p>
        <nav className="primary-nav" aria-label="Email views">
          <button className={`nav-item ${view === 'scheduled' ? 'active' : ''}`} onClick={() => { setView('scheduled'); setSearch(''); }}><Inbox size={17} /><span>Scheduled</span><span className="nav-count">{scheduledCount}</span></button>
          <button className={`nav-item ${view === 'sent' ? 'active' : ''}`} onClick={() => { setView('sent'); setSearch(''); }}><Send size={17} /><span>Sent emails</span><span className="nav-count">{sentCount}</span></button>
        </nav>
        <p className="nav-caption nav-caption-lower">TOOLS</p>
        <a className="nav-item nav-anchor" href="http://localhost:4000/admin/queues" target="_blank" rel="noreferrer"><Activity size={17} /><span>Queue monitor</span><ArrowUpRight size={13} /></a>
        <button className="nav-item" onClick={() => setToast(slack.connected ? 'Slack rate-limit alerts are active.' : 'Connect Slack from the top bar to receive hourly limit alerts.')}><Settings2 size={17} /><span>Integrations</span></button>
        <div className="sidebar-bottom">
          <div className="delivery-note"><span className="delivery-icon"><Sparkles size={16} /></span><div><strong>Sending smoothly</strong><small>Queue is operational</small></div><span className="online-dot" /></div>
          <button className="user-menu" onClick={() => void logout()} title="Log out"><span className="avatar-wrap">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{user.name.slice(0, 1).toUpperCase()}</span>}</span><span className="user-copy"><strong>{user.name}</strong><small>{user.email}</small></span><LogOut size={16} /></button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{view === 'scheduled' ? 'Scheduled emails' : 'Sent emails'}</strong></div>
          <div className="topbar-actions">
            <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search emails" aria-label="Search emails" /><kbd><Command size={11} /> K</kbd></label>
            <button className={`slack-button ${slack.connected ? 'slack-connected' : ''}`} onClick={() => slack.connected ? void disconnectSlack() : window.location.assign(slackConnectUrl)} title={slack.connected ? 'Disconnect Slack' : 'Connect Slack'}><MessageSquare size={15} /><span>{slack.connected ? 'Slack connected' : 'Connect Slack'}</span>{slack.connected && <Check size={14} />}</button>
            <button className="notification-button" aria-label="Notifications" onClick={() => setToast('You are all caught up.')}><Bell size={17} /><span className="notification-dot" /></button>
            <span className="top-avatar" title={`${user.name} · ${user.email}`}>{user.avatarUrl ? <img src={user.avatarUrl} alt={user.name} /> : user.name.slice(0, 1).toUpperCase()}</span>
          </div>
        </header>

        <main className="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR OUTBOUND, IN ORDER</p>
              <h1>{view === 'scheduled' ? 'Scheduled emails' : 'Sent emails'}<span className="heading-spark">✳</span></h1>
              <p className="page-subtitle">{view === 'scheduled' ? 'A clear view of what is going out next.' : 'Every delivery, gathered in one place.'}</p>
            </div>
            <button className="button button-primary compose-trigger" onClick={() => setComposeOpen(true)}><MailPlus size={17} /> Compose new email</button>
          </div>

          <section className="metrics-row" aria-label="Email activity summary">
            <div className="metric"><span className="metric-icon metric-icon-blue"><Clock3 size={16} /></span><div><span>Scheduled</span><strong>{scheduledCount.toLocaleString()}</strong></div><small>in queue</small></div>
            <div className="metric"><span className="metric-icon metric-icon-coral"><Send size={16} /></span><div><span>Sent</span><strong>{sentCount.toLocaleString()}</strong></div><small>all time</small></div>
            <div className="metric metric-rate"><span className="metric-icon metric-icon-green"><Activity size={16} /></span><div><span>Send pace</span><strong>{Math.floor(3600000 / Math.max(minSendIntervalMs, 1)).toLocaleString()}<small> / hr max</small></strong></div><small>throttle active</small></div>
            <div className="metrics-decoration"><span className="spark-line spark-a" /><span className="spark-line spark-b" /><span className="spark-line spark-c" /><span className="spark-label">steady<br />by design</span></div>
          </section>

          {pageError && <div className="inline-alert" role="alert"><span>{pageError}</span><button onClick={() => setPageError('')}>Dismiss</button></div>}

          <section className="activity-section">
            <div className="section-heading">
              <div><h2>{search.trim().length >= 2 ? 'Search results' : view === 'scheduled' ? 'Upcoming' : 'Delivery history'}</h2><p>{search.trim().length >= 2 ? `Matches for “${search.trim()}”` : view === 'scheduled' ? 'Your messages, ordered by next send time.' : 'Recent message activity and delivery status.'}</p></div>
              <button className="button button-quiet export-button" onClick={exportEmails} disabled={emails.length === 0}><ArrowDownToLine size={15} /> Export <ChevronDown size={14} /></button>
            </div>
            <div className="tabs-row" role="tablist" aria-label="Email status">
              <button className={view === 'scheduled' ? 'tab-active' : ''} role="tab" aria-selected={view === 'scheduled'} onClick={() => { setView('scheduled'); setSearch(''); }}>Scheduled <span>{scheduledCount}</span></button>
              <button className={view === 'sent' ? 'tab-active' : ''} role="tab" aria-selected={view === 'sent'} onClick={() => { setView('sent'); setSearch(''); }}>Sent <span>{sentCount}</span></button>
            </div>
            <EmailTable emails={emails} kind={view} loading={loadingEmails} onCompose={() => setComposeOpen(true)} />
            {!loadingEmails && emails.length > 0 && <div className="table-footer"><span>Showing {emails.length} email{emails.length === 1 ? '' : 's'}</span><span><span className="live-dot" /> Live status</span></div>}
          </section>
          <footer className="page-footer"><span><span className="tiny-dot" /> All systems operational</span><span>ReachInbox Scheduler <span className="footer-separator">·</span> Built for a better send</span></footer>
        </main>
      </div>

      {composeOpen && <ComposeModal senders={senders} maxHourlyLimit={maxHourlyLimit} minSendIntervalMs={minSendIntervalMs} onClose={() => setComposeOpen(false)} onSchedule={schedule} />}
      {toast && <div className="toast-message" role="status"><Check size={16} />{toast}<button aria-label="Dismiss message" onClick={() => setToast('')}>×</button></div>}
    </div>
  );
}

export default App;
