import { PlatformAgentResourceSchema } from '@wiser/platform-contracts';
import { createAgentHttpAuthorizer } from './agent-http-authorizer.js';

export function createAgentMcpRuntimeFromEnvironment(
  environment: NodeJS.ProcessEnv,
) {
  const mode = environment['WISER_MCP_AUTH_MODE'] ?? 'static';
  if (mode === 'static') return null;
  if (mode !== 'oauth')
    throw new Error('WISER_MCP_AUTH_MODE must be static or oauth.');
  const resource = PlatformAgentResourceSchema.safeParse(
    environment['WISER_AGENT_MCP_RESOURCE'],
  );
  const issuer = environment['WISER_AGENT_AUTH_ISSUER'];
  const dataApiUrl = environment['DATA_API_URL'];
  if (
    !resource.success ||
    issuer === undefined ||
    !issuer.endsWith('/auth/v1') ||
    !PlatformAgentResourceSchema.safeParse(
      issuer.replace(/\/auth\/v1$/, '/mcp'),
    ).success ||
    !dataApiUrl
  ) {
    throw new Error(
      'Agent OAuth requires DATA_API_URL, WISER_AGENT_MCP_RESOURCE and WISER_AGENT_AUTH_ISSUER.',
    );
  }
  return {
    resourceMetadata: { resource: resource.data, authorizationServer: issuer },
    authorize: createAgentHttpAuthorizer({ dataApiUrl }),
  };
}
