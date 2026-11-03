# ReachInbox Email Scheduler

A TypeScript email scheduler with an Express API, PostgreSQL, BullMQ/Redis, Ethereal SMTP, Elasticsearch integration, and a React dashboard.

## Run locally

Requirements: Node.js 20 or newer. Copy `.env.example` to `.env` only if you do not already have one. Keep `.env` private; it is gitignored.

From the repository root:

```sh
npm install
npm run dev
```

`npm run dev` starts the local persistent PostgreSQL and Redis-compatible services, API, worker, and frontend. Vite prints the frontend URL; it is usually `http://localhost:5173` (this workspace may choose another port if that one is busy). Set `FRONTEND_URL` in `.env` to the URL Vite prints before using OAuth. The API is at `http://localhost:4000`; Bull Board is at `http://localhost:4000/admin/queues`.

For separate terminals, run these from the repository root in order:

```sh
npm run dev:infra
npm run dev:backend:wait
npm run dev:frontend
```

Local database files are under `backend/.local/`. To use Docker instead, set `.env` to the Compose URLs, then run `docker compose up -d` and `npm run dev:compose`. Compose starts PostgreSQL, Redis, and Elasticsearch.

## Configure integrations

- Email: `ETHEREAL_AUTO_CREATE=true` creates a demo Ethereal account. Preview links are printed after delivery. Alternatively, set `MAIL_SENDERS_JSON` to an array of sender objects containing `id`, `name`, `email`, `user`, and `pass`.
- Google: the OAuth Web client uses `http://localhost:4000/api/auth/google/callback`. The configured client is in Testing mode; add permitted accounts as test users. Publishing for general users requires completing Google’s branding/verification requirements.
- Slack: configure `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_CALLBACK_URL=http://localhost:4000/api/slack/callback`. Enable user scopes `chat:write`, `im:write`, and `users:read`. The dashboard’s Connect Slack action then stores a per-user token and sends a DM when a sender hits its hourly limit.
- Elasticsearch: set `ELASTICSEARCH_URL` and `ELASTICSEARCH_INDEX`. With Docker Compose, Elasticsearch is available at `http://localhost:9200`.

## Features and status

- Verified locally: Google test-user login, email scheduling, BullMQ delayed jobs, PostgreSQL persistence/recovery, Ethereal delivery, dashboard scheduled/sent views, and worker rate/concurrency controls.
- Elasticsearch indexing/search is implemented. When Elasticsearch is unavailable, the API falls back to PostgreSQL search; live Elasticsearch indexing still requires the service to be running.
- Slack OAuth and rate-limit DMs are implemented, but live Slack delivery still requires Slack app credentials and a connected workspace. It has not been verified in this environment.

SMTP cannot participate in a PostgreSQL/Redis transaction, and Ethereal has no idempotency API. The database and stable BullMQ job IDs prevent duplicate scheduling, but a crash after SMTP accepts a message and before the database records it has an unavoidable delivery-ambiguity window.

## Endpoints

- `GET /api/auth/google` and callback, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/senders`
- `POST /api/emails/schedule` with `{subject, body, recipients, senderId, startsAt, delayBetweenEmailsMs, hourlyLimit}` and an `Idempotency-Key` header
- `GET /api/emails?status=scheduled|sent|failed`, `GET /api/emails/search?q=...`
- `GET /api/slack/connect`, `GET /api/slack/status`, `POST /api/slack/disconnect`
- `GET /api/health`

## Build and verification

Run `npm run typecheck` and `npm run build`.

## Submission notes

A private GitHub repository, collaborator grants, and demo video still need to be created for submission. The supplied Figma frame was not accessible for pixel comparison. Demo walkthrough: schedule an email in the future, verify it in Scheduled, restart the API/worker, then confirm delivery in Sent and open its Ethereal preview.
