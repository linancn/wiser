import { z } from 'zod';
import {
  ExplorationViewSpecSchema,
  type ExplorationViewSpec,
} from '@wiser/data-contracts';
import { DataCapabilityHandlerError } from './capability-handler.js';
/** Reissue typed continuation bindings for a fresh owner-bound manifest. */
export function rebindExplorationView(
  value: ExplorationViewSpec,
  previousId: string,
  queryId: string,
): ExplorationViewSpec {
  const next = structuredClone(value);
  const cursor = (encoded: string): string => {
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      );
      const direct = z
        .strictObject({
          queryId: z.literal(previousId),
          offset: z.number().int().min(1).max(10000),
        })
        .safeParse(parsed);
      if (direct.success)
        return Buffer.from(
          JSON.stringify({ ...direct.data, queryId }),
        ).toString('base64url');
      const page = z
        .strictObject({
          binding: z.string().max(8192),
          offset: z.number().int().min(1).max(10000000),
        })
        .parse(parsed);
      const binding = z
        .object({ queryId: z.literal(previousId) })
        .passthrough()
        .parse(JSON.parse(page.binding));
      return Buffer.from(
        JSON.stringify({
          ...page,
          binding: JSON.stringify({ ...binding, queryId }),
        }),
      ).toString('base64url');
    } catch {
      throw new DataCapabilityHandlerError('VALIDATION_FAILED');
    }
  };
  for (const request of Object.values(next.requests)) {
    if (!request) continue;
    if (request.queryId !== previousId)
      throw new DataCapabilityHandlerError('VALIDATION_FAILED');
    request.queryId = queryId;
    if (request.after) request.after = cursor(request.after);
  }
  for (const navigation of Object.values(next.navigation ?? {}))
    if (navigation)
      navigation.cursors = navigation.cursors.map((value) =>
        value === null ? null : cursor(value),
      );
  return ExplorationViewSpecSchema.parse(next);
}
