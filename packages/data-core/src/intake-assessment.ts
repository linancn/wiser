import type {
  IntakeDeclaration,
  IntakeSourceFacts,
  IntakeResult,
} from '@wiser/data-contracts';

export function assessIntake(
  input: IntakeDeclaration,
  facts: IntakeSourceFacts,
): IntakeResult {
  const findings: IntakeResult['findings'] = [];
  const add = (
    code: IntakeResult['findings'][number]['code'],
    path: string,
    severity: 'WARNING' | 'NEEDS_INFORMATION' = 'NEEDS_INFORMATION',
  ) => findings.push({ code, path, severity });
  const metadata = input.metadata;
  const changed = input.expectedSourceHash !== facts.sourceHash;
  if (changed) add('SOURCE_CHANGED', 'expectedSourceHash');
  if (
    input.selfCheck &&
    (input.selfCheck.ruleVersion !== 'wiser.intake.v1' ||
      input.selfCheck.sourceHash !== facts.sourceHash)
  )
    add('SELF_CHECK_STALE', 'selfCheck', 'WARNING');
  if (input.selfCheck?.model)
    add('MODEL_NOT_VALIDATED', 'selfCheck.model', 'WARNING');
  if (!metadata.source) add('SOURCE_UNKNOWN', 'metadata.source');
  if (!metadata.authorization)
    add('AUTHORIZATION_UNKNOWN', 'metadata.authorization');
  const parsed =
    facts.status === 'READY' ||
    facts.status === 'EMPTY' ||
    facts.status === 'PARTIAL';
  if (!parsed) add('CONTENT_NOT_PARSED', 'facts.status');
  if (facts.status === 'PARTIAL')
    add('PARTIAL_CONTENT', 'facts.status', 'WARNING');
  const uses: IntakeResult['uses'] = {
    map: 'NOT_APPLICABLE',
    calculation: 'NOT_APPLICABLE',
    join: 'NOT_APPLICABLE',
    citation: 'NEEDS_INFORMATION',
  };
  const base = !changed && !!metadata.source && !!metadata.authorization;
  const hasField = (field: string, path: string) => {
    if (facts.columns.includes(field)) return true;
    add('FIELD_NOT_FOUND', path);
    return false;
  };
  if (input.kind === 'TABLE') {
    const keys = metadata.businessKeys ?? [];
    if (!keys.length) add('BUSINESS_KEY_UNKNOWN', 'metadata.businessKeys');
    const keysValid = keys
      .map((key, i) => hasField(key, `metadata.businessKeys.${i}`))
      .every(Boolean);
    if (!metadata.time) add('TIME_ROLE_UNKNOWN', 'metadata.time');
    const timeValid = metadata.time
      ? hasField(metadata.time.field, 'metadata.time.field')
      : false;
    const measures = metadata.measures ?? [];
    if (!measures.length) add('UNIT_UNKNOWN', 'metadata.measures');
    const measuresValid = measures
      .map((measure, i) => {
        if (!measure.unit) add('UNIT_UNKNOWN', `metadata.measures.${i}.unit`);
        return (
          hasField(measure.field, `metadata.measures.${i}.field`) &&
          !!measure.unit
        );
      })
      .every(Boolean);
    uses.join =
      base && parsed && keys.length > 0 && keysValid && timeValid
        ? 'CHECKS_PASSED'
        : 'NEEDS_INFORMATION';
    uses.calculation =
      base && parsed && measures.length > 0 && measuresValid && timeValid
        ? 'CHECKS_PASSED'
        : 'NEEDS_INFORMATION';
  }
  if (input.kind === 'GIS') {
    const valid =
      (facts.featureCount ?? 0) > 0 &&
      facts.reason !== 'UNKNOWN_CRS' &&
      facts.reason !== 'CONFLICTING_CRS';
    if (!valid) add('CRS_UNVERIFIED', 'facts.featureCount');
    uses.map = base && parsed && valid ? 'CHECKS_PASSED' : 'NEEDS_INFORMATION';
  }
  if (!metadata.locator) add('LOCATOR_UNKNOWN', 'metadata.locator');
  uses.citation =
    base && !!metadata.locator ? 'CHECKS_PASSED' : 'NEEDS_INFORMATION';
  let acquisition = input.acquisition;
  // Saved HTML is evidence about the entry page, never proof of dataset bytes.
  const pageOnly =
    input.target === 'DATASET' &&
    (facts.mediaType.toLowerCase().includes('html') ||
      ['LOGIN_PAGE', 'INTRODUCTION_PAGE'].includes(facts.reason ?? ''));
  if (
    pageOnly &&
    ['ORIGINAL_ACQUIRED', 'PARTIAL_ACQUIRED'].includes(acquisition)
  ) {
    acquisition = 'REGISTERED_ONLY';
    add('TARGET_NOT_ACQUIRED', 'acquisition');
  }
  if (acquisition === 'REMOTE_QUERY_REPORTED')
    add('REMOTE_QUERY_UNVERIFIED', 'acquisition', 'WARNING');
  if (
    ['ORIGINAL_ACQUIRED', 'PARTIAL_ACQUIRED'].includes(acquisition) &&
    ['SAMPLE', 'PARTIAL'].includes(input.coverage)
  )
    acquisition = 'PARTIAL_ACQUIRED';
  const saved =
    acquisition === 'ORIGINAL_ACQUIRED' || acquisition === 'PARTIAL_ACQUIRED';
  const nextAction =
    !saved &&
    ['APPLICATION_REQUIRED', 'LOGIN_REQUIRED', 'RESTRICTED'].includes(
      input.access,
    )
      ? 'REQUEST_ACCESS'
      : acquisition === 'FAILED' &&
          ['RATE_LIMITED', 'TEMPORARY'].includes(input.failure ?? '')
        ? 'RETRY_LATER'
        : saved && facts.status === null
          ? 'PARSE_SAVED_ORIGINAL'
          : !saved
            ? 'ACQUIRE_ORIGINAL'
            : findings.some((f) => f.severity === 'NEEDS_INFORMATION')
              ? 'COMPLETE_METADATA'
              : 'REVIEW_EVIDENCE';
  return {
    ruleVersion: 'wiser.intake.v1',
    sourceHash: facts.sourceHash,
    archive: 'RECORDED',
    position: 'UNCHECKED',
    target: input.target,
    access: input.access,
    entry: input.entry,
    acquisition,
    coverage: input.coverage,
    nextAction,
    uses,
    findings,
  };
}
