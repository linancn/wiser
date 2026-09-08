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

## Import and resume

The companion HTTP helper rechecks the entire inventory before each run. It registers every provider and catalog identity, merges registered interfaces into their catalog identity, and assigns each admitted file exactly once. Files with one known registry ID in their path join that source; other files join a stable collection for their relative directory. The collection is archival organization, not a claim of scientific lineage. Empty files remain explicit zero-byte manifest entries because upload sessions require positive object sizes.

```bash
python3 -B skills/wiser-data-foundation/scripts/water_import.py \
  --bundle /absolute/path/to/research-bundle \
  --inventory /absolute/case/inventory.json \
  --state-dir /absolute/case/import-state \
  --api-origin https://api.example.org \
  --token-file /absolute/private/access-token \
  --tenant <trusted-tenant-uuid> --project <trusted-project-uuid> \
  --workers 4
```

The token file must have owner-only permissions and contain a currently authorized short-lived bearer. Obtain it through the trusted Auth workflow; never place its value in command arguments or reports. The API origin must use HTTPS or loopback HTTP. The helper sends the API identity only to that origin, never follows unexpected redirects, and transfers files only through API-issued signed targets. The source bundle remains unchanged; the inventory, private token and checkpoint directory must be outside it.

Use `--source-ids DS-0001,DS-0409` for a bounded pilot. Omit that option to reconcile the entire bundle. The helper preserves source limitations and requests `L2_RESTRICTED`; publication remains scoped by the API's live authorization. Source registration does not certify scientific completeness, analytical quality, or redistribution rights.

Without review authorization, the helper stops each source at `REVIEW_REQUIRED`. Only when the trusted assignment explicitly authorizes registration review and the active identity has `data.publish`, use `--approve-registration`. Even then, approval requires the exact descriptor, a `WAITING_REVIEW` Operation, no quality issues, and no AI runs. The review conditions explicitly limit approval to registration and integrity. Unexpected states or unresolved evidence stop that source.

Each source keeps a private atomic checkpoint with stable command keys and preconditions. A lost upload-completion response replays completion before attempting to reopen a session. Signed URLs and credentials are never persisted in checkpoints. Use the same inventory, context, state directory and actor when resuming; refresh an expired token through Auth while preserving that identity. A changed source file, inventory or context requires explicit reconciliation instead of a new silent import. An expired incomplete upload is a reported failure; the helper does not discard it or generate a replacement import automatically.

Success requires a published immutable Version, the exact expected asset set, and downloaded SHA-256/size equality for every asset, including the generated source manifest. A rerun checks the authority and bytes again using existing identities. `last-run.json` contains the selected-source results, Operation/Version references, governance dimensions and counts. Generated manifest assets are counted separately from original files; empty manifest entries do not claim stored nonempty assets. Exit zero means every selected source was verified. The helper accepts files up to 64 MiB for readback; configure the trusted Worker object-size bound to cover the actual case before starting, without widening API authorization.

The synthetic safety tests create temporary files in memory-defined fixtures. Real source material is not redistributed in Git. Run the real case explicitly:

```bash
WISER_WATER_BUNDLE=/absolute/path/to/research-bundle \
  node --test scripts/data-foundation/water-research-bundle.test.mjs
```
