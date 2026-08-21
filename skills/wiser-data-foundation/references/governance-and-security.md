# Governance and security

## Four independent dimensions

| Dimension          | Values                                                                                          | Meaning                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| quality grade      | `A`, `B`, `C`                                                                                   | Deterministic weighted-check summary. A blocking failure still fails the gate.                                   |
| acceptance status  | `PENDING`, `PASSED`, `CONDITIONALLY_PASSED`, `CORRECTION_REQUIRED`, `ARCHIVED_ONLY`, `REJECTED` | Governed disposition for intended use. Only `PASSED` and `CONDITIONALLY_PASSED` can become publication-eligible. |
| publication status | `UNPUBLISHED`, `PUBLISHING`, `PUBLISHED`, `WITHDRAWN`                                           | Release lifecycle, independent of quality and access.                                                            |
| security level     | `L0_PUBLIC`, `L1_INTERNAL`, `L2_RESTRICTED`, `L3_CONFIDENTIAL`                                  | Authorization classification. The caller's live Supabase context must meet the level.                            |

Never compress these values into one “good/bad” status. A high-quality item can remain restricted or unpublished; a published item still requires authorization where applicable.

## Inheritance and derivation

Derived data inherits the highest security level of all sources. A caller may explicitly raise the result but cannot lower it. Keep source version IDs, evidence IDs, generation method, limitations, assumptions, applicability, and uncertainty with every derived result.

AI may interpret fields, propose schema/semantic mappings, extract candidate entities, and explain anomalies. Deterministic code owns parsing, conversion, hashes, validation, quality scoring, authoritative writes, and projections. Human review owns high-risk or low-confidence decisions.

## Safe interpretation

- A search score is retrieval rank, not confidence in truth.
- An Agent confidence is proposal metadata, not quality or acceptance.
- Missing results can mean no authorized match; never infer protected data.
- Projection results are rebuildable and cannot widen access. The API rechecks Supabase-derived scope, Project, policy version, and security ceiling.
- A citation should pin `dataItemId`, `versionId`, content/source hash where supplied, evidence ID, and limitations.

## Publication gate

Publication requires a committed authoritative version, a passed deterministic quality gate, eligible acceptance, ingestion in projection, and one successful unique result for every required projection. Upload, parsing, AI mapping, transformation, or one successful search index is not publication.
