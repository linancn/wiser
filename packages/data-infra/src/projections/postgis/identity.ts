import { createHash } from 'node:crypto';

import { validateSpatialProjectionInput } from './validation.js';

const NAMESPACE = Buffer.from('6b215d43bd2e5bc5bb0bd9db39e8269a', 'hex');

export function deterministicSpatialExtentId(value: unknown): string {
  const input = validateSpatialProjectionInput(value);
  if (input.spatialExtentId !== undefined) return input.spatialExtentId;
  const identity = [
    input.tenantId,
    input.projectId,
    input.dataItemId,
    input.versionId,
  ].join('\u001f');
  const bytes = createHash('sha1')
    .update(NAMESPACE)
    .update(identity, 'utf8')
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
