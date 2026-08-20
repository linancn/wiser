import 'server-only';

import {
  createLiveReadModelSource,
  createReferenceReadModelSource,
  createUnavailableReadModelSource,
  type WebDataMode,
  type WebReadModelSource,
} from './read-model-source';

const configuredMode = process.env.AGENT_EXCON_WEB_DATA_MODE;

export function getWebDataMode(): WebDataMode {
  return configuredMode === undefined || configuredMode === 'reference'
    ? 'reference'
    : 'live';
}

export function getWebReadModelSource(): WebReadModelSource {
  if (configuredMode === undefined || configuredMode === 'reference') {
    return createReferenceReadModelSource();
  }
  if (configuredMode !== 'live') {
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
