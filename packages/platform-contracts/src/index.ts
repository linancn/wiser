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
