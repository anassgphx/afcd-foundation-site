// One source for the foundation's public contact details. Before: the public email list was written out in about/,
// team/, seo/schema.ts, the admin Settings page, build.mjs and lib/site-settings.mjs, and SEO › Structured data had its
// own email and phone that overrode Settings › Contact in the published Organization markup.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PUBLIC_EMAILS } from '../src/server/identity.ts';
import { PUBLIC_EMAILS as SITE_EMAILS, applyOrg } from '../../lib/site-settings.mjs';
import * as AB from '../src/server/modules/about/service.ts';
import * as TM from '../src/server/modules/team/service.ts';
import * as SCH from '../src/server/modules/seo/schema.ts';

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs)$/.test(f) ? [p] : []; });

describe('public contact details', () => {
  it('has one list of public email addresses, shared by Studio and the website build', () => {
    expect(SITE_EMAILS).toEqual(PUBLIC_EMAILS);
    expect(AB.PUBLIC_EMAILS).toBe(PUBLIC_EMAILS); expect(TM.PUBLIC_EMAILS).toBe(PUBLIC_EMAILS); expect(SCH.PUBLIC_EMAILS).toBe(PUBLIC_EMAILS);
    // nobody writes the list out again: the only literal copies are identity.ts and lib/site-settings.mjs
    const root = resolve(import.meta.dirname, '../..');
    const copies = [...files(resolve(root, 'studio/src')), resolve(root, 'build.mjs'), ...files(resolve(root, 'lib'))]
      .filter((p) => /\[\s*'contact@afcdteam\.com',\s*'akaya@afcdteam\.com'\s*\]/.test(readFileSync(p, 'utf8'))).map((p) => p.slice(root.length + 1)).sort();
    expect(copies).toEqual(['lib/site-settings.mjs', 'studio/src/server/identity.ts']);
  });

  it('publishes the phone and email from Settings › Contact, never from Structured data', () => {
    const draft = SCH.settingsSchema.parse({ organization: { email: 'akaya@afcdteam.com', telephone: '+212 600 000 000', legalName: 'Association AFCD' } });
    const overrides = SCH.orgOverrides(draft);
    expect(overrides).toEqual({ legalName: 'Association AFCD' });
    // what build.mjs does: the Organization from Settings, then the Structured data fields on top
    const S = { name: '', general: 'contact@afcdteam.com', tel: '+212663618536', logo: null, social: {} } as unknown as Parameters<typeof applyOrg>[1];
    const org = { ...applyOrg({ name: 'AFCD Foundation' }, S, 'https://afcdfoundation.com/'), ...overrides };
    expect(org).toMatchObject({ email: 'contact@afcdteam.com', telephone: '+212663618536', legalName: 'Association AFCD' });
  });

  it('keeps the website build from taking a phone or email out of an older schema.json', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../../build.mjs'), 'utf8');
    const keys = src.match(/const SCHEMA_ORG_KEYS = (\[[^\]]*\])/)?.[1];
    expect(keys).toBeTruthy();
    expect(keys).not.toMatch(/'email'|'telephone'/);
  });
});
