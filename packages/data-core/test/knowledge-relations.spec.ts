import { describe, expect, it } from 'vitest';
import { groupRelationCandidates } from '../src/knowledge-relations.js';

const entity = (key: string, label = key) => ({
  key,
  label,
  kind: 'MONITORING_POINT',
  externalId: null,
});
const evidence = (locator: string, polarity = 'SUPPORTS') => ({
  assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sourceHash: 'a'.repeat(64),
  locator,
  excerpt: null,
  polarity,
});
const candidate = () => ({
  subject: entity('enterprise:1'),
  predicate: 'HAS_DECLARED_MONITORING_POINT',
  object: entity('point:1'),
  qualifiers: {
    measure: null,
    unit: null,
    observedAt: null,
    missing: true,
    spatialScope: null,
    limitations: ['Source-local identity only'],
    reportedConclusion: null,
  },
  generation: { method: 'SOURCE_TABLE', model: null },
  evidence: [evidence('page 1, row 1')],
  supersedesId: null,
});

describe('source-scoped business relation candidates', () => {
  it('rejects inconsistent attributes of the same source identity across different triples', () => {
    const first = candidate(),
      second = {
        ...candidate(),
        subject: entity(first.subject.key, 'Different name'),
        object: entity('point:2'),
      };
    expect(() => groupRelationCandidates([first, second])).toThrow(
      'Conflicting source entity',
    );
  });
  it('retains all 24 source locations of a real-world-sized shared monitoring point', () => {
    const rows = Array.from({ length: 24 }, (_, i) => ({
      ...candidate(),
      evidence: [evidence(`page 1 row ${i + 1}`)],
    }));
    expect(groupRelationCandidates(rows)[0]?.candidate.evidence).toHaveLength(
      24,
    );
  });
  it('counts one triple with two supporting locations rather than two relations', () => {
    const first = candidate(),
      second = { ...candidate(), evidence: [evidence('page 2, row 4')] };
    const grouped = groupRelationCandidates([first, second, first]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.candidate.evidence).toHaveLength(2);
    expect(groupRelationCandidates([second, first])).toEqual(grouped);
  });
  it('preserves contradictory evidence, unknown units and external targets without inventing location', () => {
    const row = {
      ...candidate(),
      object: { ...entity('outside:154'), externalId: 'HydroRIVERS:154' },
      evidence: [evidence('page 1'), evidence('page 2', 'CONTRADICTS')],
    };
    const [result] = groupRelationCandidates([row]);
    expect(result?.candidate.object.externalId).toBe('HydroRIVERS:154');
    expect(result?.candidate.qualifiers.unit).toBeNull();
    expect(result?.candidate.evidence.map((e) => e.polarity)).toContain(
      'CONTRADICTS',
    );
    expect(result?.candidate.object).not.toHaveProperty('geometry');
  });
  it('keeps same-name distinct identities separate and refuses conflicting attributes for one key', () => {
    const first = candidate(),
      second = { ...candidate(), object: entity('point:2', 'point:1') };
    expect(groupRelationCandidates([first, second])).toHaveLength(2);
    expect(() =>
      groupRelationCandidates([
        first,
        { ...first, object: entity('point:1', 'Different') },
      ]),
    ).toThrow(/Conflicting/);
  });
  it('requires a saved-source hash and an explicit evidence locator', () => {
    expect(() =>
      groupRelationCandidates([
        {
          ...candidate(),
          evidence: [{ ...evidence(''), sourceHash: 'unverified' }],
        },
      ]),
    ).toThrow();
  });
});
