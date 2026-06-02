// Backup + restore for the DB and storage/ directory. Uses dockerode to run
// pg_dump / pg_restore *inside* the postgres container so the host doesn't
// need the postgres client binaries installed. The api process needs access
// to the Docker socket (mounted into the container in prod, native socket in
// dev where api runs on the host).
import Docker from 'dockerode';
import { mkdir, readdir, stat, rm, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';
import * as tar from 'tar';
import { config } from '../config.js';
import { logger } from '../logger.js';

const POSTGRES_CONTAINER = process.env.POSTGRES_CONTAINER ?? 'docker-postgres-1';
const PG_USER = process.env.PG_USER ?? 'postgres';
const PG_DB = process.env.PG_DB ?? 'darrow_ti';

function backupsDir(): string {
  return join(config.STORAGE_ROOT, 'backups');
}

export interface BackupFile {
  filename: string;
  size_bytes: number;
  created_at: string;
}

/** List existing backups in storage/backups, newest first. */
export async function listBackups(): Promise<BackupFile[]> {
  const dir = backupsDir();
  try { await mkdir(dir, { recursive: true }); } catch { /* ignore */ }
  const entries = await readdir(dir);
  const out: BackupFile[] = [];
  for (const f of entries) {
    if (!f.startsWith('darrow-backup-') || !f.endsWith('.tar.gz')) continue;
    const st = await stat(join(dir, f));
    out.push({ filename: f, size_bytes: st.size, created_at: st.mtime.toISOString() });
  }
  return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function deleteBackup(filename: string): Promise<void> {
  if (!filename.startsWith('darrow-backup-') || !filename.endsWith('.tar.gz')) {
    throw new Error('Invalid backup filename');
  }
  await rm(join(backupsDir(), filename), { force: true });
}

export function backupPath(filename: string): string {
  if (!filename.startsWith('darrow-backup-') || !filename.endsWith('.tar.gz')) {
    throw new Error('Invalid backup filename');
  }
  return join(backupsDir(), filename);
}

/** Run a command inside the postgres container and collect its stdout as a Buffer. */
async function dockerExecCollect(cmd: string[]): Promise<Buffer> {
  const docker = new Docker();
  const container = docker.getContainer(POSTGRES_CONTAINER);
  const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({ hijack: true, stdin: false });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  // Docker multiplexes stdout/stderr in a framed format; demuxStream splits them.
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on('data', (c) => stdoutChunks.push(c));
  stderr.on('data', (c) => stderrChunks.push(c));
  docker.modem.demuxStream(stream, stdout, stderr);
  await new Promise<void>((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const info = await exec.inspect();
  if (info.ExitCode !== 0) {
    const err = Buffer.concat(stderrChunks).toString('utf8');
    throw new Error(`docker exec failed (exit ${info.ExitCode}): ${err.slice(0, 500)}`);
  }
  return Buffer.concat(stdoutChunks);
}

/** Pipe a Buffer into a command running inside the postgres container. */
async function dockerExecStdin(cmd: string[], stdin: Buffer): Promise<void> {
  const docker = new Docker();
  const container = docker.getContainer(POSTGRES_CONTAINER);
  const exec = await container.exec({ Cmd: cmd, AttachStdin: true, AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({ hijack: true, stdin: true });
  const stderr = new PassThrough();
  const stdout = new PassThrough();
  const stderrChunks: Buffer[] = [];
  stderr.on('data', (c) => stderrChunks.push(c));
  docker.modem.demuxStream(stream, stdout, stderr);
  stream.write(stdin);
  stream.end();
  await new Promise<void>((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const info = await exec.inspect();
  if (info.ExitCode !== 0) {
    const err = Buffer.concat(stderrChunks).toString('utf8');
    throw new Error(`docker exec failed (exit ${info.ExitCode}): ${err.slice(0, 500)}`);
  }
}

/** Create a backup archive: pg_dump custom + tar of storage/. */
export async function createBackup(): Promise<BackupFile> {
  const dir = backupsDir();
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const filename = `darrow-backup-${stamp}.tar.gz`;
  const out = join(dir, filename);
  const work = await mkdtemp();

  try {
    // 1. pg_dump custom format → db.dump
    logger.info('backup: pg_dump');
    const dump = await dockerExecCollect(['pg_dump', '-U', PG_USER, '-d', PG_DB, '--format=custom']);
    await writeFile(join(work, 'db.dump'), dump);

    // 2. tar of storage/ minus the backups subdir
    logger.info('backup: tar storage');
    await tar.create(
      {
        gzip: true,
        file: join(work, 'storage.tar.gz'),
        cwd: config.STORAGE_ROOT,
        filter: (path) => !path.startsWith('backups/') && path !== 'backups',
      },
      ['.'],
    );

    // 3. Bundle into the final tar.gz at backups/
    logger.info('backup: bundle');
    await tar.create({ gzip: true, file: out, cwd: work }, ['db.dump', 'storage.tar.gz']);

    const st = await stat(out);
    logger.info('backup: done', { filename, size_bytes: st.size });
    return { filename, size_bytes: st.size, created_at: st.mtime.toISOString() };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/** Restore from a previously-created archive. Validates the archive contains
 *  db.dump + storage.tar.gz first. DESTRUCTIVE: wipes the database and the
 *  storage/ tree (except the backups/ dir). */
export async function restoreBackup(archivePath: string): Promise<void> {
  const work = await mkdtemp();
  try {
    // 1. Extract the outer archive
    logger.info('restore: extract outer');
    await tar.extract({ file: archivePath, cwd: work });
    const dbDump = join(work, 'db.dump');
    const storageTar = join(work, 'storage.tar.gz');
    for (const p of [dbDump, storageTar]) {
      try { await stat(p); } catch {
        throw new Error(`Backup is missing ${p.replace(work, '')} — not a valid darrow backup`);
      }
    }

    // 2. pg_restore — drop & recreate to fully wipe, then apply
    logger.info('restore: pg_restore');
    const dump = await readFile(dbDump);
    // --clean drops every object before recreating it. Combined with
    // --if-exists this works against an existing DB; failing items (e.g.
    // dropping objects that don't exist on a fresh DB) are tolerated.
    await dockerExecStdin(
      ['pg_restore', '-U', PG_USER, '-d', PG_DB, '--clean', '--if-exists', '--no-owner'],
      dump,
    );

    // 3. Wipe storage/ tree (except backups/) and untar the storage.tar.gz
    logger.info('restore: wipe storage');
    const entries = await readdir(config.STORAGE_ROOT);
    for (const e of entries) {
      if (e === 'backups') continue;
      await rm(join(config.STORAGE_ROOT, e), { recursive: true, force: true });
    }
    logger.info('restore: extract storage');
    await tar.extract({ file: storageTar, cwd: config.STORAGE_ROOT });
    logger.info('restore: done');
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

async function mkdtemp(): Promise<string> {
  const { mkdtemp: mk } = await import('node:fs/promises');
  return mk(join(tmpdir(), 'darrow-backup-'));
}

// Unused but referenced for tree-shaking suppression (kept for future use).
void createWriteStream; void createReadStream; void spawn; void pipeline;
