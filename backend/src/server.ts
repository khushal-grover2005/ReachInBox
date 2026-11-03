import { app } from './app.js';
import { config } from './config.js';
import { initializeDatabase, pool } from './db.js';
import { initializeMail } from './mail.js';
import { redis } from './queue.js';
import { recoverScheduledEmails } from './recovery.js';

async function start(): Promise<void> {
  await initializeDatabase();
  await initializeMail();
  const recovered = await recoverScheduledEmails();
  console.info(`Recovered ${recovered} scheduled email jobs`);
  const server = app.listen(config.port, () => console.info(`API listening on http://localhost:${config.port}`));
  const shutdown = async (): Promise<void> => {
    server.close();
    await Promise.all([pool.end(), redis.quit()]);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

start().catch((error: unknown) => {
  console.error('API startup failed', error);
  process.exitCode = 1;
});
