# Local water research bundles

The Skill includes a Python 3 standard-library helper for the 2026-09-08 research bundle format. It verifies package/download SHA-256 manifests and config references, joins registered interfaces to the full catalog by registry ID, and inventories unlisted files. It rejects symlinks, path escapes, duplicate identities and mismatched hashes before producing an import plan.

```bash
python3 -B skills/wiser-data-foundation/scripts/water_bundle.py inventory \
  --bundle /absolute/path/to/research-bundle \
  --out /absolute/path/outside-the-bundle/inventory.json
```

The source directory is read-only. Inventory output has owner-only permissions. `.env` and environment templates remain excluded credential configuration; operating-system files and source implementation scripts remain accounted-for exclusions. Supporting records containing credential material receive a sanitized derivative, retaining both original and prepared hashes. Credential references remain references. The helper does not execute source scripts, log credentials, call provider endpoints, or infer complete datasets from extensions or successful HTTP responses.

`files` accounts for every input file and states original bytes/hash, detected media type, manifest verification, artifact class, declared and normalized completeness, disposition, prepared bytes/hash, and registry IDs explicitly present in its path. A path-derived association is a discovery hint, not independently verified scientific lineage. `sources` contains one record per provider and one per full-catalog ID; registered interface details extend their matching catalog record.

An inventory proves source reconciliation, not upload or publication. Ingestion must subsequently use discovered HTTP Capabilities, preserve the inventory identities and limitations, and reconcile every resulting asset/Operation/version. Report persisted raw files separately from parsed, validated, analytically usable datasets.

Register sources with ingestion 1.1 `sourceRegistration` and its strict `wiser.source-registration.v1` manifest. After publication, obtain the immutable Version's `assetIds`. Read each file through `/api/data/v1/tenants/{tenantId}/projects/{projectId}/versions/{versionId}/assets/{assetId}` and follow the returned short-lived redirect without forwarding the API bearer. Check downloaded bytes and SHA-256 against the prepared manifest; `assets/source` selects only the first asset and cannot verify an entire multi-file Version.

The synthetic safety tests create temporary files in memory-defined fixtures. Real source material is not redistributed in Git. Run the real case explicitly:

```bash
WISER_WATER_BUNDLE=/absolute/path/to/research-bundle \
  node --test scripts/data-foundation/water-research-bundle.test.mjs
```
