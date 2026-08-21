import { Buffer } from 'node:buffer';
import {
  createHmac,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from 'node:crypto';

const TOKEN_PATTERN = /^wdc1\.(wdc_[A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const HMAC_KEY_ID_PATTERN = /^[a-z][a-z0-9_-]{0,95}$/;
const CONFIGURATION_ERROR =
  'Invalid delegated credential HMAC key ring configuration.';
const HMAC_DOMAIN = 'wiser:delegated-credential:v1';

export interface DelegatedCredentialHmacKeyRing {
  readonly activeKeyId: string;
  readonly keys: ReadonlyMap<string, Uint8Array>;
}

export interface DelegatedCredentialTokenParts {
  readonly version: 'wdc1';
  readonly keyId: string;
  readonly secretBase64Url: string;
}

export interface IssuedDelegatedCredential {
  readonly token: string;
  readonly keyId: string;
  readonly hmacKeyId: string;
  readonly tokenHmac: Uint8Array;
}

export interface StoredDelegatedCredentialHmac {
  readonly hmacKeyId: string;
  readonly tokenHmac: Uint8Array;
}

export type DelegatedCredentialRandomBytes = (size: number) => Uint8Array;

function configurationError(): Error {
  return new Error(CONFIGURATION_ERROR);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function decodeHmacKey(value: unknown): Uint8Array | null {
  if (
    typeof value !== 'string' ||
    value.length < 43 ||
    value.length > 86 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return null;
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.length < 32 ||
    decoded.length > 64 ||
    decoded.toString('base64url') !== value
  ) {
    return null;
  }
  return new Uint8Array(decoded);
}

export function parseDelegatedCredentialHmacKeyRing(
  serialized: string,
): DelegatedCredentialHmacKeyRing {
  if (serialized.length === 0 || serialized.length > 65_536) {
    throw configurationError();
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized);
  } catch {
    throw configurationError();
  }

  if (
    !isRecord(candidate) ||
    !hasExactKeys(candidate, ['activeKeyId', 'keys']) ||
    typeof candidate.activeKeyId !== 'string' ||
    !HMAC_KEY_ID_PATTERN.test(candidate.activeKeyId) ||
    !isRecord(candidate.keys)
  ) {
    throw configurationError();
  }

  const entries = Object.entries(candidate.keys);
  if (entries.length === 0 || entries.length > 32) {
    throw configurationError();
  }

  const keys = new Map<string, Uint8Array>();
  for (const [keyId, encoded] of entries) {
    const key = decodeHmacKey(encoded);
    if (!HMAC_KEY_ID_PATTERN.test(keyId) || key === null) {
      throw configurationError();
    }
    keys.set(keyId, key);
  }
  if (!keys.has(candidate.activeKeyId)) {
    throw configurationError();
  }

  return { activeKeyId: candidate.activeKeyId, keys };
}

export function parseDelegatedCredentialToken(
  token: string,
): DelegatedCredentialTokenParts | null {
  if (token.length !== 75) return null;
  const match = TOKEN_PATTERN.exec(token);
  if (match === null) return null;
  const keyId = match[1];
  const secretBase64Url = match[2];
  if (keyId === undefined || secretBase64Url === undefined) return null;
  return { version: 'wdc1', keyId, secretBase64Url };
}

function usableHmacKey(
  keyRing: DelegatedCredentialHmacKeyRing,
  keyId: string,
): Uint8Array | null {
  if (!HMAC_KEY_ID_PATTERN.test(keyId)) return null;
  const key = keyRing.keys.get(keyId);
  if (key === undefined || key.length < 32 || key.length > 64) return null;
  return key;
}

function tokenHmac(
  key: Uint8Array,
  parts: DelegatedCredentialTokenParts,
): Uint8Array {
  const digest = createHmac('sha256', key)
    .update(HMAC_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(parts.keyId, 'utf8')
    .update('\0', 'utf8')
    .update(parts.secretBase64Url, 'utf8')
    .digest();
  return new Uint8Array(digest);
}

function secureRandomBytes(size: number): Uint8Array {
  return new Uint8Array(nodeRandomBytes(size));
}

function exactRandomBytes(
  randomBytes: DelegatedCredentialRandomBytes,
  size: number,
): Uint8Array {
  const generated = randomBytes(size);
  if (generated.length !== size) {
    throw new Error('Unable to issue delegated credential.');
  }
  return generated;
}

export function issueDelegatedCredential(
  keyRing: DelegatedCredentialHmacKeyRing,
  randomBytes: DelegatedCredentialRandomBytes = secureRandomBytes,
): IssuedDelegatedCredential {
  const key = usableHmacKey(keyRing, keyRing.activeKeyId);
  if (key === null) throw configurationError();

  const keyId = `wdc_${Buffer.from(exactRandomBytes(randomBytes, 16)).toString(
    'base64url',
  )}`;
  const secretBase64Url = Buffer.from(
    exactRandomBytes(randomBytes, 32),
  ).toString('base64url');
  const parts: DelegatedCredentialTokenParts = {
    version: 'wdc1',
    keyId,
    secretBase64Url,
  };

  return {
    token: `${parts.version}.${parts.keyId}.${parts.secretBase64Url}`,
    keyId,
    hmacKeyId: keyRing.activeKeyId,
    tokenHmac: tokenHmac(key, parts),
  };
}

export function verifyDelegatedCredentialToken(
  token: string,
  stored: StoredDelegatedCredentialHmac,
  keyRing: DelegatedCredentialHmacKeyRing,
): boolean {
  const parts = parseDelegatedCredentialToken(token);
  if (parts === null || stored.tokenHmac.length !== 32) return false;
  const key = usableHmacKey(keyRing, stored.hmacKeyId);
  if (key === null) return false;

  const computed = tokenHmac(key, parts);
  return timingSafeEqual(Buffer.from(computed), Buffer.from(stored.tokenHmac));
}
