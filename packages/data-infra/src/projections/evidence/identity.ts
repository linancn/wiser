import { createHash } from 'node:crypto';

import type { EvidenceProjectionInput } from './types.js';
import { validateEvidenceProjectionInput } from './validation.js';

const NAMESPACE = Buffer.from('43f4c960daee5f1991954ffad9f14d86', 'hex');

export function deterministicEvidenceProjectionId(value: unknown): string {
  const input: EvidenceProjectionInput = validateEvidenceProjectionInput(value);
  const identity = [
    input.tenantId,
    input.projectId,
    input.dataItemId,
    input.versionId,
    input.assetId,
    input.chunkId,
    input.evidenceId,
    input.sourceHash,
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
