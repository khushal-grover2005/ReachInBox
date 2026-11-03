import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { RedisMemoryServer } from "redis-memory-server";

const backendDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const databaseUrl = new URL(
  process.env.DATABASE_URL ??
    "postgres://reachinbox:reachinbox@127.0.0.1:5432/reachinbox",
);
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const databaseName =
  decodeURIComponent(databaseUrl.pathname.slice(1)) || "reachinbox";
const postgresDirectory = path.join(backendDirectory, ".local", "postgres");
const redisDirectory = path.join(backendDirectory, ".local", "redis");
const postgres = new EmbeddedPostgres({
  databaseDir: postgresDirectory,
  user: decodeURIComponent(databaseUrl.username) || "reachinbox",
  password: decodeURIComponent(databaseUrl.password) || "reachinbox",
  port: Number(databaseUrl.port || 5432),
  persistent: true,
  autoRehydrateSymlinks: true,
  onLog: (message) => console.info(`[postgres] ${message}`),
  onError: (message) => console.error(`[postgres] ${message}`),
});
const redis = new RedisMemoryServer({
  instance: {
    ip: redisUrl.hostname || "127.0.0.1",
    port: Number(redisUrl.port || 6379),
    args: [
      "--appendonly",
      "yes",
      "--appendfsync",
      "everysec",
      "--dir",
      redisDirectory,
    ],
  },
});
let stopping = false;

async function stopServices() {
  if (stopping) return;
  stopping = true;
  await redis
    .stop()
    .catch((error) => console.error("Redis shutdown failed", error));
  await postgres
    .stop()
    .catch((error) => console.error("PostgreSQL shutdown failed", error));
}

try {
  try {
    await access(path.join(postgresDirectory, "PG_VERSION"));
  } catch {
    await postgres.initialise();
  }
  await postgres.start();
  const admin = postgres.getPgClient("postgres");
  await admin.connect();
  const existingDatabase = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [databaseName],
  );
  await admin.end();
  if (existingDatabase.rowCount === 0) {
    await postgres.createDatabase(databaseName);
  }

  await mkdir(redisDirectory, { recursive: true });
  await redis.start();
  console.info(`Local PostgreSQL ready at ${databaseUrl.host}/${databaseName}`);
  console.info(
    `Local Redis ready at ${redisUrl.hostname}:${await redis.getPort()} with AOF persistence`,
  );
} catch (error) {
  console.error("Could not start local development services", error);
  await stopServices();
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  process.once("SIGINT", () => void stopServices().then(() => process.exit(0)));
  process.once(
    "SIGTERM",
    () => void stopServices().then(() => process.exit(0)),
  );
  await new Promise(() => undefined);
}
