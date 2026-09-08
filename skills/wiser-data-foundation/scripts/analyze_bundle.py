"""Resume published-source analyses and reconcile paths using governed HTTP only."""
import argparse
import base64
import fcntl
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import Request

from water_import import HttpClient, ImportFailure, digest, encoded, validate_url, write_private


def reconcile_paths(registration, manifest, assets):
    by_id = {asset["assetId"]: asset for asset in assets}
    files = manifest["files"]
    if (manifest["sourceId"] != registration["sourceId"] or len(files) != registration["filePaths"]
            or len(assets) != registration["assets"] or len(by_id) != len(assets)
            or sum(asset["status"] == "MANIFEST" for asset in assets) != 1):
        raise ImportFailure("SOURCE_RECONCILIATION_MISMATCH")
    paths, expected, result = set(), {}, []
    for file in files:
        path = file["path"]
        if path in paths:
            raise ImportFailure("DUPLICATE_SOURCE_PATH")
        paths.add(path)
        asset_id = file.get("assetId")
        if asset_id is None:
            if file["preparedSizeBytes"] != 0 or file["preparedSha256"] != digest(b""):
                raise ImportFailure("UNBACKED_SOURCE_PATH")
            asset = {"status": "EMPTY", "reason": "REGISTERED_EMPTY_SOURCE", "recordCount": 0, "featureCount": 0}
        else:
            asset = by_id.get(asset_id)
            if not asset or asset["status"] == "MANIFEST" or asset["sourceHash"] != file["preparedSha256"]:
                raise ImportFailure("SOURCE_HASH_MISMATCH")
            expected.setdefault(asset_id, set()).add(path)
        result.append({"path": path, "assetId": asset_id, "sourceHash": file["preparedSha256"],
                       "artifactClass": file["artifactClass"], "completeness": file["completeness"],
                       **{key: asset[key] for key in ["status", "reason", "recordCount", "featureCount"]}})
    for asset in assets:
        if asset["status"] != "MANIFEST" and (asset["assetId"] not in expected
                or set(asset["paths"]) != expected[asset["assetId"]]
                or len(set(asset["paths"])) != len(asset["paths"])):
            raise ImportFailure("SOURCE_PATH_MISMATCH")
    return result


class AnalysisRunner:
    def __init__(self, client, state_dir, context, run_id, *, poll_seconds=1, timeout=1800):
        self.client, self.state_dir, self.context, self.run_id = client, state_dir, context, run_id
        self.poll_seconds, self.timeout = poll_seconds, timeout

    def analyze(self, registration):
        path = self.state_dir / (digest(registration["sourceId"].encode()) + ".json")
        identity = {"context": self.context, "runId": self.run_id,
                    **{key: registration[key] for key in ["sourceId", "dataItemId", "versionId"]}}
        if path.is_symlink():
            raise ImportFailure("UNSAFE_CHECKPOINT")
        checkpoint = json.loads(path.read_bytes()) if path.exists() else {
            "identity": identity, "key": str(uuid.uuid5(uuid.NAMESPACE_URL, digest(encoded(identity))))}
        if checkpoint["identity"] != identity:
            raise ImportFailure("CHECKPOINT_SCOPE_MISMATCH")
        write_private(path, checkpoint)
        if "operationId" not in checkpoint:
            response = self.client.command("/analyses", {key: registration[key] for key in ["dataItemId", "versionId"]}, checkpoint["key"])
            try:
                analysis_id = str(uuid.UUID(response["analysisId"]))
                operation_id = str(uuid.UUID(response["operation"]["operationId"]))
            except (KeyError, ValueError, TypeError):
                raise ImportFailure("INVALID_ANALYSIS_RESPONSE") from None
            checkpoint.update(analysisId=analysis_id, operationId=operation_id)
            write_private(path, checkpoint)
        deadline = time.monotonic() + self.timeout
        while True:
            operation = self.client.get("/operations/" + checkpoint["operationId"])
            checkpoint.update(status=operation["status"], operationVersion=operation["version"])
            if operation["status"] in {"SUCCEEDED", "FAILED", "CANCELLED"} or operation["status"].startswith("WAITING_"):
                write_private(path, checkpoint)
                return checkpoint
            if time.monotonic() >= deadline:
                write_private(path, checkpoint)
                raise ImportFailure("ANALYSIS_POLL_TIMEOUT")
            time.sleep(self.poll_seconds)

    def manifest(self, registration, asset):
        path = f'/tenants/{self.client.tenant}/projects/{self.client.project}/versions/{registration["versionId"]}/assets/{asset["assetId"]}'
        with self.client.open(Request(self.client.origin + "/api/data/v1" + path, headers=self.client.headers())) as response:
            if response.code != 303:
                raise ImportFailure("MANIFEST_REDIRECT_REQUIRED")
            target = response.headers.get("Location", "")
            validate_url(target)
        # API credentials must never follow the signed asset redirect.
        with self.client.open(Request(target)) as response:
            if response.code != 200:
                raise ImportFailure("MANIFEST_DOWNLOAD_FAILED")
            content = response.read(512 * 1024 + 1)
        if len(content) > 512 * 1024 or digest(content) != asset["sourceHash"]:
            raise ImportFailure("MANIFEST_HASH_MISMATCH")
        value = json.loads(content)
        if value.get("schemaVersion") != "wiser.source-registration.v1":
            raise ImportFailure("MANIFEST_SCHEMA_MISMATCH")
        return value

    def process_with_retry(self, registration, *, pause=time.sleep):
        for attempt in range(6):
            try:
                return self.process(registration)
            except ImportFailure as error:
                if str(error) not in {"TRANSPORT_UNAVAILABLE", "HTTP_429", "HTTP_502", "HTTP_503", "HTTP_504", "MANIFEST_DOWNLOAD_FAILED"} or attempt == 5:
                    raise
                pause(min(30, 2 ** (attempt + 1)))
        raise ImportFailure("RETRY_EXHAUSTED")

    def process(self, registration):
        checkpoint = self.analyze(registration)
        result = {key: registration[key] for key in ["sourceId", "kind", "name", "dataItemId", "versionId"]}
        result.update({key: checkpoint[key] for key in ["analysisId", "operationId", "status", "operationVersion"]})
        if checkpoint["status"] != "SUCCEEDED":
            return result
        resource = self.client.api("POST", "/explore/query", {
            "spec": {"versions": [{key: registration[key] for key in ["dataItemId", "versionId"]}]}, "view": "resources", "first": 1})
        members = resource["resources"]
        if (len(members) != 1 or members[0]["versionId"] != registration["versionId"]
                or members[0].get("analysis", {}).get("analysisId") != checkpoint["analysisId"]):
            raise ImportFailure("ANALYSIS_SNAPSHOT_CHANGED")
        records = self.client.api("POST", "/explore/query", {"queryId": resource["queryId"],
            "view": "records", "versionId": registration["versionId"], "first": 1})
        assets = records["assets"]
        manifests = [asset for asset in assets if asset["status"] == "MANIFEST"]
        if len(manifests) != 1:
            raise ImportFailure("MANIFEST_ASSET_MISMATCH")
        result.update(paths=reconcile_paths(registration, self.manifest(registration, manifests[0]), assets),
                      assets=assets, coverage=records["coverage"], analysis=members[0]["analysis"])
        write_private(self.state_dir / "results" / (digest(registration["sourceId"].encode()) + ".json"), result)
        return result


def run(args):
    state_dir = args.state_dir.resolve()
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.state_dir.is_symlink() or state_dir.stat().st_mode & 0o077:
        raise ImportFailure("STATE_DIRECTORY_MUST_BE_PRIVATE")
    client = HttpClient(args.api_origin, args.token_file, args.tenant, args.project, args.purpose)
    # Decoding only binds local recovery to the same actor; the HTTP API verifies the token.
    token = client.headers()["Authorization"].removeprefix("Bearer ")
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        actor = str(uuid.UUID(claims["sub"]))
    except (IndexError, ValueError, KeyError):
        raise ImportFailure("TOKEN_ACTOR_REQUIRED") from None
    context = {"origin": client.origin, "tenant": args.tenant, "project": args.project,
               "purpose": args.purpose, "actor": actor}
    content = args.registrations.read_bytes()
    registry = json.loads(content)
    if registry["tenantId"] != args.tenant or registry["projectId"] != args.project:
        raise ImportFailure("REGISTRATION_SCOPE_MISMATCH")
    registrations = registry["registrations"]
    if len({r["sourceId"] for r in registrations}) != len(registrations):
        raise ImportFailure("DUPLICATE_SOURCE")
    if args.source_ids:
        selected = set(args.source_ids.split(","))
        registrations = [r for r in registrations if r["sourceId"] in selected]
        if {r["sourceId"] for r in registrations} != selected:
            raise ImportFailure("UNKNOWN_SOURCE_SELECTION")
    capabilities = client.get("/capabilities")
    # Preserve discovery evidence without credentials; requests follow the published contracts.
    write_private(state_dir / "capabilities.json", capabilities)
    lock_path = state_dir / ".lock"
    if lock_path.is_symlink():
        raise ImportFailure("UNSAFE_CHECKPOINT")
    with lock_path.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ImportFailure("ANALYSIS_BATCH_ALREADY_RUNNING") from None
        run_path = state_dir / "run.json"
        if run_path.is_symlink():
            raise ImportFailure("UNSAFE_CHECKPOINT")
        identity = {"context": context, "registrationsHash": digest(content)}
        state = json.loads(run_path.read_bytes()) if run_path.exists() else {"identity": identity, "runId": str(uuid.uuid4())}
        if state["identity"] != identity:
            raise ImportFailure("CHECKPOINT_SCOPE_MISMATCH")
        write_private(run_path, state)
        runner = AnalysisRunner(client, state_dir, context, state["runId"], timeout=args.timeout)
        results = []
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            pending = {executor.submit(runner.process_with_retry, registration): registration for registration in registrations}
            for future in as_completed(pending):
                registration = pending[future]
                try:
                    result = future.result()
                except ImportFailure as error:
                    result = {"sourceId": registration["sourceId"], "status": "ERROR", "reason": str(error)}
                except Exception:
                    result = {"sourceId": registration["sourceId"], "status": "ERROR", "reason": "UNEXPECTED_RESPONSE"}
                if "paths" not in result:
                    write_private(state_dir / "failures" / (digest(registration["sourceId"].encode()) + ".json"), result)
                results.append(result)
                progress = {"selected": len(registrations), "finished": len(results),
                            "reconciled": sum("paths" in r for r in results),
                            "failed": sum("paths" not in r for r in results)}
                write_private(state_dir / "progress.json", progress)
                if len(results) % 25 == 0 or "paths" not in result or len(results) == len(registrations):
                    print(json.dumps(progress), flush=True)
        paths = [p["path"] for r in results for p in r.get("paths", [])]
        if len(paths) != len(set(paths)):
            raise ImportFailure("DUPLICATE_GLOBAL_PATH")
        success = all("paths" in r for r in results)
        if success and len(paths) != sum(r["filePaths"] for r in registrations):
            raise ImportFailure("BUNDLE_PATH_COUNT_MISMATCH")
        report = {"context": context, "runId": state["runId"], "complete": success,
                  "registrationCount": len(registrations), "pathCount": len(paths),
                  "assetCount": sum(len(r.get("assets", [])) for r in results),
                  "indexedRepresentationRecords": sum(r.get("coverage", {}).get("indexedRecordCount", 0) for r in results),
                  "indexedFeatures": sum(r.get("coverage", {}).get("indexedFeatureCount", 0) for r in results),
                  "results": sorted(results, key=lambda r: r["sourceId"])}
        write_private(state_dir / "last-run.json", report)
        return 0 if success else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registrations", required=True, type=Path)
    parser.add_argument("--state-dir", required=True, type=Path)
    parser.add_argument("--api-origin", required=True)
    parser.add_argument("--token-file", required=True, type=Path)
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--purpose", default="data-steward-console")
    parser.add_argument("--source-ids")
    parser.add_argument("--workers", type=int, choices=[1, 2], default=2)
    parser.add_argument("--timeout", type=int, default=1800)
    args = parser.parse_args()
    try:
        return run(args)
    except ImportFailure as error:
        print(json.dumps({"status": "ERROR", "reason": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
