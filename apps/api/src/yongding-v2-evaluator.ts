import type { JsonObject, JsonValue } from '@agent-excon/contracts';

import {
  YONGDING_V2_CASE_PACK,
  type YongdingV2CaseRoleKey,
} from './yongding-v2-case.js';

export type YongdingV2EvaluationIssue =
  | 'OUTPUT_SCHEMA_TYPE'
  | 'OUTPUT_SCHEMA_REQUIRED_FIELD'
  | 'OUTPUT_SCHEMA_MIN_ITEMS'
  | 'OUTPUT_SCHEMA_ADDITIONAL_PROPERTY'
  | 'ARTIFACT_EVIDENCE_REQUIRED';

export interface YongdingV2RoleEvaluation {
  readonly verdict: 'ACCEPTED' | 'REWORK_REQUIRED';
  readonly issues: readonly YongdingV2EvaluationIssue[];
}

export interface EvaluateYongdingV2RoleOutputInput {
  readonly roleSlotId: YongdingV2CaseRoleKey;
  readonly payload: JsonObject;
  readonly artifactReferenceCount: number;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExpectedType(
  value: JsonValue,
  type: JsonValue | undefined,
): boolean {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isObject(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number';
  if (type === 'boolean') return typeof value === 'boolean';
  return true;
}

function evaluateSchema(
  payload: JsonObject,
  schema: JsonObject,
): YongdingV2EvaluationIssue[] {
  const issues: YongdingV2EvaluationIssue[] = [];
  const required = Array.isArray(schema['required'])
    ? schema['required'].filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  if (required.some((field) => payload[field] === undefined)) {
    issues.push('OUTPUT_SCHEMA_REQUIRED_FIELD');
  }

  const properties = isObject(schema['properties']) ? schema['properties'] : {};
  for (const [field, propertySchema] of Object.entries(properties)) {
    const value = payload[field];
    if (value === undefined || !isObject(propertySchema)) continue;
    const expectedType = propertySchema['type'];
    if (!hasExpectedType(value, expectedType)) {
      issues.push('OUTPUT_SCHEMA_TYPE');
      continue;
    }
    const minItems = propertySchema['minItems'];
    if (
      Array.isArray(value) &&
      typeof minItems === 'number' &&
      value.length < minItems
    ) {
      issues.push('OUTPUT_SCHEMA_MIN_ITEMS');
    }
  }

  if (schema['additionalProperties'] === false) {
    const permitted = new Set(Object.keys(properties));
    if (Object.keys(payload).some((field) => !permitted.has(field))) {
      issues.push('OUTPUT_SCHEMA_ADDITIONAL_PROPERTY');
    }
  }
  return [...new Set(issues)];
}

export function evaluateYongdingV2RoleOutput(
  input: EvaluateYongdingV2RoleOutputInput,
): YongdingV2RoleEvaluation {
  const role = YONGDING_V2_CASE_PACK.roles[input.roleSlotId];
  const issues = evaluateSchema(input.payload, role.taskOutputSchema);
  const minimumArtifactReferences =
    input.roleSlotId === 'dispatch-coordination' ? 3 : 1;
  if (input.artifactReferenceCount < minimumArtifactReferences) {
    issues.push('ARTIFACT_EVIDENCE_REQUIRED');
  }
  const uniqueIssues = [...new Set(issues)];
  return Object.freeze({
    verdict: uniqueIssues.length === 0 ? 'ACCEPTED' : 'REWORK_REQUIRED',
    issues: Object.freeze(uniqueIssues),
  });
}
