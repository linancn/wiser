import {
  RelationCandidateSchema,
  RelationEntitySchema,
  type RelationCandidate,
} from '@wiser/data-contracts';

export function assertRelationEntityConsistency(
  entities: readonly unknown[],
): void {
  const seen = new Map<string, string>();
  for (const raw of entities) {
    const entity = RelationEntitySchema.parse(raw),
      value = JSON.stringify(entity),
      old = seen.get(entity.key);
    if (old && old !== value) throw Error('Conflicting source entity');
    seen.set(entity.key, value);
  }
}

/** Stable identity within the separately bound source Version. No cross-source merge. */
export function groupRelationCandidates(
  rows: readonly unknown[],
): readonly { identity: string; candidate: RelationCandidate }[] {
  const parsed = rows.map((row) => RelationCandidateSchema.parse(row));
  assertRelationEntityConsistency(
    parsed.flatMap((row) => [row.subject, row.object]),
  );
  const grouped = new Map<
    string,
    {
      base: string;
      candidate: RelationCandidate;
      evidence: Map<string, RelationCandidate['evidence'][number]>;
    }
  >();
  for (const row of parsed) {
    const candidate = RelationCandidateSchema.parse(row);
    const identity = JSON.stringify([
      candidate.subject.key,
      candidate.predicate,
      candidate.object.key,
    ]);
    const { evidence, ...attributes } = candidate;
    const base = JSON.stringify(attributes);
    const existing = grouped.get(identity);
    if (existing && existing.base !== base)
      throw new Error('Conflicting relation candidate');
    const group = existing ?? { base, candidate, evidence: new Map() };
    for (const item of evidence) group.evidence.set(JSON.stringify(item), item);
    if (group.evidence.size > 64)
      throw new Error('Too many evidence locations');
    grouped.set(identity, group);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([identity, g]) => ({
      identity,
      candidate: {
        ...g.candidate,
        evidence: [...g.evidence.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([, e]) => e),
      },
    }));
}
