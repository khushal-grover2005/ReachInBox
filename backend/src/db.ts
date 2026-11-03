import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;
export const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export async function initializeDatabase(): Promise<void> {
  const schema = await fs.readFile(path.join(currentDirectory, 'schema.sql'), 'utf8');
  await pool.query(schema);
}
