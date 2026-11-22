// AES-256-GCM for secrets at rest (OAuth tokens). Format: v1.<iv>.<tag>.<ciphertext>, base64url parts.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function keyFrom(b64: string) {
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('STUDIO_ENCRYPTION_KEY must be 32 random bytes, base64-encoded.');
  return k;
}
export function encrypt(key: Buffer, plain: string) {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}
export function decrypt(key: Buffer, box: string) {
  const [v, iv, tag, body] = box.split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('Unreadable encrypted value.');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}
/** PKCE (RFC 7636): verifier and its S256 challenge. */
export function pkce() {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
