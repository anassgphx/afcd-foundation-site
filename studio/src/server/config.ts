// Environment configuration. Values come from process.env (optionally loaded from studio/.env). No secrets are hardcoded.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STUDIO_DIR = resolve(import.meta.dirname, '../..');

function loadDotEnv() {
  const file = resolve(STUDIO_DIR, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

export type Config = {
  port: number;
  origin: string;
  secureCookies: boolean;
  databaseUrl: string | null;
  dataDir: string;
  mediaDir: string;
  previewDir: string;
  siteRoot: string;
  maxUploadBytes: number;
  studioDir: string;
  publicSiteUrl: string;
};

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const port = Number(process.env.PORT || 4400);
  const origin = process.env.STUDIO_ORIGIN || `http://localhost:${port}`;
  const dataDir = resolve(STUDIO_DIR, process.env.STUDIO_DATA_DIR || '.data');
  return {
    port,
    origin,
    secureCookies: origin.startsWith('https://'),
    databaseUrl: process.env.DATABASE_URL || null,
    dataDir,
    mediaDir: resolve(dataDir, 'media'),
    previewDir: resolve(STUDIO_DIR, '.preview'),
    siteRoot: resolve(STUDIO_DIR, process.env.SITE_ROOT || '..'),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024,
    studioDir: STUDIO_DIR,
    publicSiteUrl: process.env.PUBLIC_SITE_URL || 'http://localhost:4321/',
    ...overrides,
  };
}
