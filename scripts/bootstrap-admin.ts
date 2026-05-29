// Create the first admin user. Idempotent: errors if any admin already exists.
// Usage: npx tsx scripts/bootstrap-admin.ts [username]
// Password: if stdin is non-interactive, generates a strong random password,
// prints it once, and writes it to docs/FIRST_RUN.md (gitignored).
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { db, sql, users } from '@darrow/db';
import { eq } from 'drizzle-orm';

function genPassword(): string {
  // 24 chars base64url, well over the 16-char floor.
  return randomBytes(18).toString('base64url');
}

async function main() {
  const existing = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  if (existing.length > 0) {
    console.error('[bootstrap] An admin user already exists; refusing to create another.');
    await sql.end({ timeout: 5 });
    process.exit(1);
  }

  const argUser = process.argv[2];
  let username = argUser ?? 'admin';
  let password = '';
  let generated = false;

  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    username = (await rl.question(`Username [${username}]: `)) || username;
    password = await rl.question('Password (min 16 chars, blank to auto-generate): ');
    rl.close();
  }
  if (!password) {
    password = genPassword();
    generated = true;
  }
  if (password.length < 16) {
    console.error('[bootstrap] Password must be at least 16 characters.');
    await sql.end({ timeout: 5 });
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const [u] = await db.insert(users).values({ username, passwordHash: hash, role: 'admin' }).returning();

  console.log(`[bootstrap] Created admin "${u.username}" (id ${u.id}).`);
  if (generated) {
    const docPath = join(process.cwd(), 'docs', 'FIRST_RUN.md');
    const body = `# First Run Credentials\n\nGenerated ${new Date().toISOString()}\n\n- Username: \`${username}\`\n- Password: \`${password}\`\n\n**Change this password after first login and delete this file.**\n`;
    writeFileSync(docPath, body, { mode: 0o600 });
    console.log(`[bootstrap] Generated password written to docs/FIRST_RUN.md (gitignored):`);
    console.log(`\n    username: ${username}\n    password: ${password}\n`);
  }
  await sql.end({ timeout: 5 });
  process.exit(0);
}

main().catch((err) => {
  console.error('[bootstrap] failed', err);
  process.exit(1);
});
