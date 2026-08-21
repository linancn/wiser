import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  issueDelegatedCredential,
  parseDelegatedCredentialHmacKeyRing,
  parseDelegatedCredentialToken,
  verifyDelegatedCredentialToken,
  type DelegatedCredentialHmacKeyRing,
} from '../src/index.js';

const ACTIVE_KEY_ID = 'primary-2026-08';
const PREVIOUS_KEY_ID = 'previous-2026-07';

function keyBytes(value: number) {
  return Uint8Array.from({ length: 32 }, () => value);
}

function encodedKey(value: number) {
  return Buffer.from(keyBytes(value)).toString('base64url');
}

function keyRing(
  activeKeyId = ACTIVE_KEY_ID,
): DelegatedCredentialHmacKeyRing {
  return {
    activeKeyId,
    keys: new Map([
      [ACTIVE_KEY_ID, keyBytes(17)],
      [PREVIOUS_KEY_ID, keyBytes(23)],
    ]),
  };
}

function deterministicRandom(start: number) {
  let value = start;
  return (size: number) => {
    const bytes = Uint8Array.from({ length: size }, () => value);
    value += 1;
    return bytes;
  };
}

describe('delegated credential HMAC key-ring configuration', () => {
  it('parses canonical base64url keys and retains previous rotation keys', () => {
    const parsed = parseDelegatedCredentialHmacKeyRing(
      JSON.stringify({
        activeKeyId: ACTIVE_KEY_ID,
        keys: {
          [ACTIVE_KEY_ID]: encodedKey(17),
          [PREVIOUS_KEY_ID]: encodedKey(23),
        },
      }),
    );

    expect(parsed.activeKeyId).toBe(ACTIVE_KEY_ID);
    expect([...parsed.keys]).toEqual([
      [ACTIVE_KEY_ID, keyBytes(17)],
      [PREVIOUS_KEY_ID, keyBytes(23)],
    ]);
  });

  it.each([
    ['not-json', 'not-json'],
    [
      'missing active key',
      JSON.stringify({
        activeKeyId: ACTIVE_KEY_ID,
        keys: { [PREVIOUS_KEY_ID]: encodedKey(23) },
      }),
    ],
    [
      'short key',
      JSON.stringify({
        activeKeyId: ACTIVE_KEY_ID,
        keys: { [ACTIVE_KEY_ID]: 'c2hvcnQ' },
      }),
    ],
    [
      'padded key',
      JSON.stringify({
        activeKeyId: ACTIVE_KEY_ID,
        keys: { [ACTIVE_KEY_ID]: `${encodedKey(17)}=` },
      }),
    ],
    [
      'unknown field',
      JSON.stringify({
        activeKeyId: ACTIVE_KEY_ID,
        keys: { [ACTIVE_KEY_ID]: encodedKey(17) },
        plaintextSecret: encodedKey(31),
      }),
    ],
  ])('rejects %s without echoing secret configuration', (_, serialized) => {
    let caught: unknown;
    try {
      parseDelegatedCredentialHmacKeyRing(serialized);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'Invalid delegated credential HMAC key ring configuration.',
    );
    expect((caught as Error).message).not.toContain(serialized);
  });
});

describe('delegated credential token envelope', () => {
  it('issues a strict locator plus 256-bit secret and a 256-bit HMAC', () => {
    const issued = issueDelegatedCredential(
      keyRing(),
      deterministicRandom(1),
    );

    expect(issued.token).toMatch(
      /^wdc1\.wdc_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/,
    );
    expect(issued.keyId).toMatch(/^wdc_[A-Za-z0-9_-]{22}$/);
    expect(issued.hmacKeyId).toBe(ACTIVE_KEY_ID);
    expect(issued.tokenHmac).toHaveLength(32);
    expect(parseDelegatedCredentialToken(issued.token)).toEqual({
      version: 'wdc1',
      keyId: issued.keyId,
      secretBase64Url: issued.token.split('.')[2],
    });
  });

  it('never reuses a token, key id, or HMAC across issuances', () => {
    const randomBytes = deterministicRandom(3);
    const first = issueDelegatedCredential(keyRing(), randomBytes);
    const second = issueDelegatedCredential(keyRing(), randomBytes);

    expect(second.token).not.toBe(first.token);
    expect(second.keyId).not.toBe(first.keyId);
    expect(second.tokenHmac).not.toEqual(first.tokenHmac);
  });

  it.each([
    '',
    'wdc1',
    'wdc1.wdc_short.secret',
    'wdc2.wdc_0123456789ABCDEFGHIJKL.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'wdc1.wdc_0123456789ABCDEFGHIJKL.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    'wdc1.wdc_0123456789ABCDEFGHIJKL.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAé',
    ' wdc1.wdc_0123456789ABCDEFGHIJKL.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    `wdc1.wdc_0123456789ABCDEFGHIJKL.${'A'.repeat(44)}`,
  ])('rejects malformed envelopes without permissive fallback: %j', (token) => {
    expect(parseDelegatedCredentialToken(token)).toBeNull();
  });

  it('verifies old key-ring entries and fails closed for any mismatch', () => {
    const issuedWithPreviousKey = issueDelegatedCredential(
      keyRing(PREVIOUS_KEY_ID),
      deterministicRandom(5),
    );
    const stored = {
      hmacKeyId: issuedWithPreviousKey.hmacKeyId,
      tokenHmac: issuedWithPreviousKey.tokenHmac,
    };

    expect(
      verifyDelegatedCredentialToken(
        issuedWithPreviousKey.token,
        stored,
        keyRing(),
      ),
    ).toBe(true);
    expect(
      verifyDelegatedCredentialToken(
        `${issuedWithPreviousKey.token.slice(0, -1)}A`,
        stored,
        keyRing(),
      ),
    ).toBe(false);
    expect(
      verifyDelegatedCredentialToken(
        issuedWithPreviousKey.token,
        { ...stored, hmacKeyId: 'removed-2026-06' },
        keyRing(),
      ),
    ).toBe(false);
    expect(
      verifyDelegatedCredentialToken(
        issuedWithPreviousKey.token,
        { ...stored, tokenHmac: new Uint8Array(31) },
        keyRing(),
      ),
    ).toBe(false);
  });
});
