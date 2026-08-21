import { Buffer } from 'node:buffer';

const SAFE_STATUS_FIELDS = Object.freeze([
  'API_URL',
  'DB_URL',
  'PUBLISHABLE_KEY',
]);
const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{16,256}$/;
const BASE64URL_SECRET_PATTERN = /^[A-Za-z0-9_-]{43,512}$/;

function runtimeError(message) {
  return new Error(`Supabase runtime bootstrap failed: ${message}`);
}

function parseUrl(value, protocols, field) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw runtimeError(`${field} is invalid`);
  }
  if (!protocols.includes(url.protocol) || url.hostname.length === 0) {
    throw runtimeError(`${field} is invalid`);
  }
  return url;
}

function localStatusLine(line) {
  const match = /^([A-Z][A-Z0-9_]*)="([^"\r\n]*)"$/.exec(line);
  return match === null ? null : { key: match[1], value: match[2] };
}

export function parseSupabaseStatusEnvironment(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > 64 * 1024) {
    throw runtimeError('status output is invalid');
  }
  const values = new Map();
  for (const line of output.split(/\r?\n/)) {
    if (line.length === 0) continue;
    const parsed = localStatusLine(line);
    if (parsed !== null && SAFE_STATUS_FIELDS.includes(parsed.key)) {
      if (values.has(parsed.key)) {
        throw runtimeError(`status contains duplicate ${parsed.key}`);
      }
      values.set(parsed.key, parsed.value);
    }
  }
  for (const field of SAFE_STATUS_FIELDS) {
    if (!values.has(field)) throw runtimeError(`status is missing ${field}`);
  }

  const api = parseUrl(values.get('API_URL'), ['http:', 'https:'], 'API_URL');
  if (
    api.username.length > 0 ||
    api.password.length > 0 ||
    api.pathname !== '/' ||
    api.search.length > 0 ||
    api.hash.length > 0
  ) {
    throw runtimeError('API_URL is invalid');
  }
  const database = parseUrl(
    values.get('DB_URL'),
    ['postgres:', 'postgresql:'],
    'DB_URL',
  );
  if (database.pathname.length < 2) throw runtimeError('DB_URL is invalid');
  const publishableKey = values.get('PUBLISHABLE_KEY');
  if (!PUBLISHABLE_KEY_PATTERN.test(publishableKey)) {
    throw runtimeError('PUBLISHABLE_KEY is invalid');
  }
  return Object.freeze({
    apiUrl: api.origin,
    databaseUrl: database.toString(),
    publishableKey,
  });
}

function containerUrl(value, protocols, field) {
  const url = parseUrl(value, protocols, field);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    url.hostname = 'host.docker.internal';
  }
  return url.toString().replace(/\/$/, '');
}

function validateKeyRing(value) {
  if (typeof value !== 'string' || value.length > 65_536) {
    throw runtimeError('delegated credential key ring is invalid');
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw runtimeError('delegated credential key ring is invalid');
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    typeof parsed.activeKeyId !== 'string' ||
    parsed.keys === null ||
    typeof parsed.keys !== 'object' ||
    Array.isArray(parsed.keys) ||
    !BASE64URL_SECRET_PATTERN.test(parsed.keys[parsed.activeKeyId] ?? '')
  ) {
    throw runtimeError('delegated credential key ring is invalid');
  }
  return value;
}

export function buildSupabaseComposeEnvironment(status, options) {
  const apiUrl = parseUrl(
    status?.apiUrl,
    ['http:', 'https:'],
    'API_URL',
  ).origin;
  const databaseUrl = parseUrl(
    status?.databaseUrl,
    ['postgres:', 'postgresql:'],
    'DB_URL',
  ).toString();
  if (!PUBLISHABLE_KEY_PATTERN.test(status?.publishableKey ?? '')) {
    throw runtimeError('PUBLISHABLE_KEY is invalid');
  }
  if (
    typeof options?.accessToken !== 'string' ||
    options.accessToken.length < 24 ||
    options.accessToken.length > 16_384 ||
    /\s/.test(options.accessToken)
  ) {
    throw runtimeError('operator access token is invalid');
  }
  const keyRing = validateKeyRing(options.delegatedCredentialHmacKeyRing);
  return Object.freeze({
    WISER_AUTH_MODE: 'supabase',
    SUPABASE_URL: containerUrl(apiUrl, ['http:', 'https:'], 'API_URL'),
    SUPABASE_PUBLISHABLE_KEY: status.publishableKey,
    DATABASE_URL: containerUrl(
      databaseUrl,
      ['postgres:', 'postgresql:'],
      'DB_URL',
    ),
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.publishableKey,
    WISER_DELEGATED_CREDENTIAL_HMAC_KEYS: keyRing,
    DATA_API_BEARER_TOKEN: options.accessToken,
  });
}

async function boundedJson(response) {
  let text;
  try {
    text = await response.text();
  } catch {
    throw runtimeError('operator sign-in response could not be read');
  }
  if (Buffer.byteLength(text) > 32 * 1024) {
    throw runtimeError('operator sign-in response is too large');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw runtimeError('operator sign-in response is invalid');
  }
}

export async function signInLocalOperator(status, options) {
  const apiUrl = parseUrl(
    status?.apiUrl,
    ['http:', 'https:'],
    'API_URL',
  ).origin;
  const publishableKey = status?.publishableKey;
  if (!PUBLISHABLE_KEY_PATTERN.test(publishableKey ?? '')) {
    throw runtimeError('PUBLISHABLE_KEY is invalid');
  }
  if (
    typeof options?.email !== 'string' ||
    options.email.length > 320 ||
    !/^[^\s@]+@[^\s@]+$/.test(options.email) ||
    typeof options.password !== 'string' ||
    options.password.length < 6 ||
    options.password.length > 4_096
  ) {
    throw runtimeError('local operator credentials are invalid');
  }
  const request = options.fetch ?? fetch;
  let response;
  try {
    response = await request(`${apiUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: options.email,
        password: options.password,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw runtimeError('local operator sign-in request failed');
  }
  const body = await boundedJson(response);
  if (!response.ok) throw runtimeError('local operator sign-in was rejected');
  const token = body?.access_token;
  if (
    typeof token !== 'string' ||
    token.length < 24 ||
    token.length > 16_384 ||
    /\s/.test(token)
  ) {
    throw runtimeError('local operator sign-in returned an invalid token');
  }
  return token;
}
