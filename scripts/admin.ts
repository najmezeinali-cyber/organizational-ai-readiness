import { loadEnvConfig } from '@next/env';
import { db, closeDatabase } from '../lib/db';

loadEnvConfig(process.cwd());
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Usage: npm run admin -- verified-user@example.com');
  process.exitCode = 1;
} else {
  const changed = db().prepare("UPDATE users SET role='admin' WHERE email=? AND verified=1").run(email);
  if (changed.changes !== 1) {
    console.error('No verified account found. Register and verify this account first.');
    process.exitCode = 1;
  } else console.log('Administrator role granted to the verified account. Sign in again if needed.');
}
closeDatabase();
