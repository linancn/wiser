export interface ProjectAccessBootstrapInput {
  readonly sourceProjectSlug: string;
  readonly demo: {
    readonly slug: string;
    readonly nameZh: string;
    readonly nameEn: string;
    readonly managerEmail: string;
    readonly approverEmail: string;
    readonly applicantEmail: string;
    readonly expiresAt: string;
  };
  readonly researcher: {
    readonly email: string;
    readonly expiresAt: string;
  };
  readonly intake: {
    readonly slug: string;
    readonly nameZh: string;
    readonly nameEn: string;
    readonly expiresAt: string;
  };
}

export interface ProjectAccessBootstrapPlan {
  readonly sourceProjectSlug: string;
  readonly projects: readonly {
    readonly slug: string;
    readonly nameZh: string;
    readonly nameEn: string;
    readonly requestsEnabled: boolean;
  }[];
  readonly roles: readonly {
    readonly key: string;
    readonly system: 'platform' | 'data';
    readonly securityLevel: 'L3_CONFIDENTIAL';
    readonly scopes: readonly string[];
  }[];
  readonly assignments: readonly {
    readonly projectSlug: string;
    readonly email: string;
    readonly roleKey: string;
    readonly expiresAt: string;
  }[];
}

function validSlug(value: string) {
  return /^[a-z][a-z0-9-]{1,62}$/.test(value);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function expiry(value: string, now: number, maxDays: number) {
  const parsed = Date.parse(value);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value ||
    parsed <= now ||
    parsed > now + maxDays * 86_400_000
  ) {
    throw new Error('Invalid bootstrap expiry');
  }
}

/** A fixed, reviewable scope plan; no database operation is performed here. */
export function buildProjectAccessBootstrapPlan(
  input: ProjectAccessBootstrapInput,
  nowIso: string,
): ProjectAccessBootstrapPlan {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) throw new Error('Invalid bootstrap time');
  const { sourceProjectSlug, demo, researcher, intake } = input;
  if (
    !validSlug(sourceProjectSlug) ||
    !validSlug(demo.slug) ||
    !validSlug(intake.slug) ||
    new Set([sourceProjectSlug, demo.slug, intake.slug]).size !== 3 ||
    !demo.nameZh.trim() ||
    !demo.nameEn.trim() ||
    !intake.nameZh.trim() ||
    !intake.nameEn.trim()
  ) {
    throw new Error('Invalid bootstrap projects');
  }
  const emails = [
    demo.managerEmail,
    demo.approverEmail,
    demo.applicantEmail,
    researcher.email,
  ].map((email) => email.toLowerCase());
  if (emails.some((email) => !validEmail(email)) || new Set(emails).size !== 4)
    throw new Error('Bootstrap identities must be distinct');
  expiry(demo.expiresAt, now, 7);
  expiry(researcher.expiresAt, now, 31);
  expiry(intake.expiresAt, now, 31);
  return {
    sourceProjectSlug,
    projects: [
      {
        slug: demo.slug,
        nameZh: demo.nameZh,
        nameEn: demo.nameEn,
        requestsEnabled: true,
      },
      {
        slug: intake.slug,
        nameZh: intake.nameZh,
        nameEn: intake.nameEn,
        requestsEnabled: false,
      },
    ],
    roles: [
      {
        key: 'access-demo-manager',
        system: 'platform',
        securityLevel: 'L3_CONFIDENTIAL',
        scopes: ['platform.membership.manage'],
      },
      {
        key: 'access-demo-approver',
        system: 'platform',
        securityLevel: 'L3_CONFIDENTIAL',
        scopes: ['platform.access.approve'],
      },
      {
        key: 'researcher-read-delegate',
        system: 'data',
        securityLevel: 'L3_CONFIDENTIAL',
        scopes: [
          'data.catalog.read',
          'data.geo.read',
          'data.graph.read',
          'data.knowledge.read',
          'data.operation.read',
          'data.query',
          'data.query.execute',
          'data.search.execute',
          'platform.delegation.manage',
        ],
      },
      {
        key: 'intake-submitter',
        system: 'data',
        securityLevel: 'L3_CONFIDENTIAL',
        scopes: [
          'data.catalog.read',
          'data.ingestion.write',
          'data.operation.read',
          'data.query.execute',
          'data.search.execute',
          'platform.delegation.manage',
        ],
      },
    ],
    assignments: [
      {
        projectSlug: demo.slug,
        email: emails[0]!,
        roleKey: 'access-demo-manager',
        expiresAt: demo.expiresAt,
      },
      {
        projectSlug: demo.slug,
        email: emails[1]!,
        roleKey: 'access-demo-approver',
        expiresAt: demo.expiresAt,
      },
      {
        projectSlug: demo.slug,
        email: emails[2]!,
        roleKey: 'data-project-preview',
        expiresAt: demo.expiresAt,
      },
      {
        projectSlug: sourceProjectSlug,
        email: emails[3]!,
        roleKey: 'researcher-read-delegate',
        expiresAt: researcher.expiresAt,
      },
      {
        projectSlug: sourceProjectSlug,
        email: emails[3]!,
        roleKey: 'intake-submitter',
        expiresAt: researcher.expiresAt,
      },
      {
        projectSlug: intake.slug,
        email: emails[3]!,
        roleKey: 'intake-submitter',
        expiresAt: intake.expiresAt,
      },
    ],
  };
}
