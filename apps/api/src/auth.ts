import type {
  ParticipantAuthenticator,
  ParticipantPrincipal,
} from './types.js';

/**
 * Demo/test authenticator. Production deployments should inject an adapter that
 * verifies a short-lived Supabase JWT and derives the participant identity from
 * its trusted claims.
 */
export class StaticParticipantAuthenticator implements ParticipantAuthenticator {
  readonly #participants: ReadonlyMap<string, ParticipantPrincipal>;

  constructor(tokens: Readonly<Record<string, string>>) {
    this.#participants = new Map(
      Object.entries(tokens).map(([token, id]) => [token, { id }]),
    );
  }

  authenticate(token: string): Promise<ParticipantPrincipal | null> {
    return Promise.resolve(this.#participants.get(token) ?? null);
  }
}
