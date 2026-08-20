import 'server-only';

import { connection } from 'next/server';

import {
  createLiveReadModelSource,
  createReferenceReadModelSource,
  createUnavailableReadModelSource,
  type WebDataMode,
  type WebReadModelSource,
} from './read-model-source';

async function configuredMode(): Promise<string | undefined> {
  await connection();
  return process.env.AGENT_EXCON_WEB_DATA_MODE;
}

export async function getWebDataMode(): Promise<WebDataMode> {
  const mode = await configuredMode();
  return mode === undefined || mode === 'reference' ? 'reference' : 'live';
}

export async function getWebReadModelSource(): Promise<WebReadModelSource> {
  const mode = await configuredMode();
  if (mode === undefined || mode === 'reference') {
    return createReferenceReadModelSource();
  }
  if (mode !== 'live') {
    return createUnavailableReadModelSource(
      'live',
      'AGENT_EXCON_WEB_DATA_MODE must be either reference or live.',
    );
  }
  return createLiveReadModelSource({
    apiOrigin: process.env.AGENT_EXCON_API_INTERNAL_URL ?? '',
    operatorToken: process.env.WISER_WEB_OPERATOR_TOKEN ?? '',
  });
}
