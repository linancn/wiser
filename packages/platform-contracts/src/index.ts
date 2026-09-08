import { z } from 'zod';

export const PlatformUuidSchema = z.string().uuid();

export const PlatformActorTypeSchema = z.enum([
  'human',
  'agent',
  'service',
  'system',
]);
export type PlatformActorType = z.infer<typeof PlatformActorTypeSchema>;

export const AuthenticationMethodSchema = z.enum([
  'supabase_jwt',
  'delegated_credential',
  'local_token',
]);
export type AuthenticationMethod = z.infer<typeof AuthenticationMethodSchema>;

export const PlatformRoleKeySchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z][a-z0-9-]*$/);

export const PlatformScopeSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/);
export type PlatformScope = z.infer<typeof PlatformScopeSchema>;

export const PlatformPurposeSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z][a-z0-9-]*$/);
export type PlatformPurpose = z.infer<typeof PlatformPurposeSchema>;

export const PlatformSecurityLevelSchema = z.enum([
  'L0_PUBLIC',
  'L1_INTERNAL',
  'L2_RESTRICTED',
  'L3_CONFIDENTIAL',
]);
export type PlatformSecurityLevel = z.infer<typeof PlatformSecurityLevelSchema>;

const PlatformPrincipalFields = {
  actorType: PlatformActorTypeSchema,
  actorId: PlatformUuidSchema,
  authUserId: PlatformUuidSchema.optional(),
  sessionId: PlatformUuidSchema.optional(),
  credentialId: PlatformUuidSchema.optional(),
  delegationId: PlatformUuidSchema.optional(),
  delegatedBy: PlatformUuidSchema.optional(),
  authenticationMethod: AuthenticationMethodSchema,
  expiresAt: z.string().datetime({ offset: true }).optional(),
} as const;

export const PlatformPrincipalSchema = z
  .strictObject(PlatformPrincipalFields)
  .superRefine((principal, context) => {
    if (principal.authenticationMethod === 'supabase_jwt') {
      if (principal.actorType !== 'human') {
        context.addIssue({
          code: 'custom',
          path: ['actorType'],
          message: 'Supabase user sessions authenticate human actors only.',
        });
      }
      for (const field of ['authUserId', 'sessionId'] as const) {
        if (principal[field] === undefined) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is required for a Supabase JWT principal.`,
          });
        }
      }
    }

    if (principal.authenticationMethod === 'delegated_credential') {
      if (
        principal.actorType !== 'agent' &&
        principal.actorType !== 'service'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['actorType'],
          message: 'Delegated credentials authenticate agents or services.',
        });
      }
      for (const field of [
        'credentialId',
        'delegationId',
        'delegatedBy',
      ] as const) {
        if (principal[field] === undefined) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is required for a delegated principal.`,
          });
        }
      }
    }
  });
export type PlatformPrincipal = z.infer<typeof PlatformPrincipalSchema>;

export const AuthorizedContextSchema = z.strictObject({
  tenantId: PlatformUuidSchema,
  projectId: PlatformUuidSchema,
  roles: z.array(PlatformRoleKeySchema).max(64),
  scopes: z.array(PlatformScopeSchema).max(256),
  purpose: PlatformPurposeSchema,
  maxSecurityLevel: PlatformSecurityLevelSchema,
  authzVersion: z.number().int().nonnegative(),
});
export type AuthorizedContext = z.infer<typeof AuthorizedContextSchema>;

export const PlatformTraceIdSchema = z.string().regex(/^[a-f0-9]{32}$/);

export const PlatformRequestContextSchema = z.strictObject({
  principal: PlatformPrincipalSchema,
  authorization: AuthorizedContextSchema,
  traceId: PlatformTraceIdSchema,
});
export type PlatformRequestContext = z.infer<
  typeof PlatformRequestContextSchema
>;

export const PlatformAgentResourceSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    return (
      /^https:\/\/[^/?#@\\\s]+\/mcp$/.test(value) ||
      /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?\/mcp$/.test(value)
    );
  });
export const PlatformAgentModeSchema = z.enum(['query', 'ingest']);
export const PlatformAgentAuthorizationIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);
export const PlatformAgentAuthorizeCommandSchema = z.strictObject({
  authorizationId: PlatformAgentAuthorizationIdSchema,
  tenantId: PlatformUuidSchema,
  projectId: PlatformUuidSchema,
  mode: PlatformAgentModeSchema,
  maxSecurityLevel: PlatformSecurityLevelSchema.default('L1_INTERNAL'),
  expiresInSeconds: z.number().int().min(60).max(3600).default(3600),
});
export type PlatformAgentAuthorizeCommand = z.input<
  typeof PlatformAgentAuthorizeCommandSchema
>;
export const PlatformAgentProjectSchema = z.strictObject({
  tenantId: PlatformUuidSchema,
  projectId: PlatformUuidSchema,
  tenantName: z.strictObject({
    'zh-CN': z.string().min(1).max(256),
    en: z.string().min(1).max(256),
  }),
  projectName: z.strictObject({
    'zh-CN': z.string().min(1).max(256),
    en: z.string().min(1).max(256),
  }),
  modes: z.array(PlatformAgentModeSchema).min(1).max(2),
  maxSecurityLevel: PlatformSecurityLevelSchema,
});
export const PlatformAgentAuthorizationViewSchema = z.strictObject({
  authorizationId: PlatformAgentAuthorizationIdSchema,
  clientId: PlatformUuidSchema,
  clientName: z.string().min(1).max(1024),
  redirectUri: z.string().url().max(2048),
  resource: PlatformAgentResourceSchema,
  projects: z.array(PlatformAgentProjectSchema).max(100),
});
export type PlatformAgentAuthorizationView = z.infer<
  typeof PlatformAgentAuthorizationViewSchema
>;
export const PlatformAgentConnectionViewSchema = z.strictObject({
  connectionId: PlatformUuidSchema,
  clientId: PlatformUuidSchema,
  delegationId: PlatformUuidSchema,
  tenantId: PlatformUuidSchema,
  projectId: PlatformUuidSchema,
  scopes: z.array(PlatformScopeSchema).min(1).max(128),
  purpose: z.literal('agent-data'),
  maxSecurityLevel: PlatformSecurityLevelSchema,
  expiresAt: z.iso.datetime(),
  status: z.enum(['active', 'expired', 'revoked']),
});
export type PlatformAgentConnectionView = z.infer<
  typeof PlatformAgentConnectionViewSchema
>;
export const PlatformAgentExchangeViewSchema = z.strictObject({
  connection: PlatformAgentConnectionViewSchema,
  token: z.string().regex(/^wdc1\.wdc_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime(),
});
export type PlatformAgentExchangeView = z.infer<
  typeof PlatformAgentExchangeViewSchema
>;
