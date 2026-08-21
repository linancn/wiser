import type { SecurityLevel } from '@wiser/data-contracts';

import { DataFoundationDomainError } from '../domain-error.js';

const SECURITY_RANK = Object.freeze({
  L0_PUBLIC: 0,
  L1_INTERNAL: 1,
  L2_RESTRICTED: 2,
  L3_CONFIDENTIAL: 3,
} satisfies Readonly<Record<SecurityLevel, number>>);

export class InvalidSecurityLevelSetError extends DataFoundationDomainError {
  constructor() {
    super(
      'INVALID_SECURITY_LEVEL_SET',
      'At least one source security level is required.',
    );
    this.name = 'InvalidSecurityLevelSetError';
  }
}

export class SecurityLevelDowngradeError extends DataFoundationDomainError {
  constructor(
    readonly inheritedLevel: SecurityLevel,
    readonly proposedLevel: SecurityLevel,
  ) {
    super(
      'SECURITY_LEVEL_DOWNGRADE',
      `Security level ${proposedLevel} is lower than inherited level ${inheritedLevel}.`,
    );
    this.name = 'SecurityLevelDowngradeError';
  }
}

export function maximumSecurityLevel(
  levels: readonly SecurityLevel[],
): SecurityLevel {
  const [first, ...remaining] = levels;
  if (first === undefined) {
    throw new InvalidSecurityLevelSetError();
  }

  return remaining.reduce(
    (maximum, level) =>
      SECURITY_RANK[level] > SECURITY_RANK[maximum] ? level : maximum,
    first,
  );
}

export function inheritSecurityLevel(
  sourceLevels: readonly SecurityLevel[],
  requestedLevel?: SecurityLevel,
): SecurityLevel {
  const inheritedLevel = maximumSecurityLevel(sourceLevels);
  if (requestedLevel === undefined) {
    return inheritedLevel;
  }
  return maximumSecurityLevel([inheritedLevel, requestedLevel]);
}

export function assertSecurityLevelNotLowered(
  inheritedLevel: SecurityLevel,
  proposedLevel: SecurityLevel,
): SecurityLevel {
  if (SECURITY_RANK[proposedLevel] < SECURITY_RANK[inheritedLevel]) {
    throw new SecurityLevelDowngradeError(inheritedLevel, proposedLevel);
  }
  return proposedLevel;
}
