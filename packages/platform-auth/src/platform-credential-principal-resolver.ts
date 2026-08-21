import type { PlatformRequestContext } from '@wiser/platform-contracts';

import type { ResolveSupabasePrincipalInput } from './index.js';

export interface PlatformPrincipalResolverLike {
  resolve(
    input: ResolveSupabasePrincipalInput,
  ): Promise<PlatformRequestContext | null>;
}

export interface PlatformCredentialPrincipalResolverOptions {
  readonly jwt: PlatformPrincipalResolverLike;
  readonly delegated: PlatformPrincipalResolverLike;
}

export class PlatformCredentialPrincipalResolver {
  readonly #jwt: PlatformPrincipalResolverLike;
  readonly #delegated: PlatformPrincipalResolverLike;

  constructor(options: PlatformCredentialPrincipalResolverOptions) {
    this.#jwt = options.jwt;
    this.#delegated = options.delegated;
  }

  resolve(
    input: ResolveSupabasePrincipalInput,
  ): Promise<PlatformRequestContext | null> {
    return input.token.startsWith('wdc1.')
      ? this.#delegated.resolve(input)
      : this.#jwt.resolve(input);
  }
}
