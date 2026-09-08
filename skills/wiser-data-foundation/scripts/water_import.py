"""Resume a reconciled research bundle through WISER HTTP Capabilities only."""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import uuid

from water_bundle import Sanitizer, build_inventory, digest, file_admission, safe_path


LIMITATIONS = [
    "Source registration and file integrity only; analytical quality and scientific usability have not been assessed.",
    "Access conditions, licensing, samples, partial downloads and unknown completeness retain their source declarations.",
    "Registry IDs found in file paths are discovery hints, not independently verified scientific lineage.",
]
ADMITTED = {"IMPORT", "SANITIZE_TEXT"}


class ImportFailure(Exception):
    """Only stable local codes may cross the CLI logging boundary."""


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def write_private(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".checkpoint-", delete=False) as out:
        temporary = Path(out.name)
        try:
            os.fchmod(out.fileno(), 0o600)
            out.write(encoded(value) + b"\n")
            out.flush()
            os.fsync(out.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    temporary.replace(path)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


class Checkpoint:
    def __init__(self, path, source_id):
        self.path = path
        if path.is_symlink():
            raise ImportFailure("UNSAFE_CHECKPOINT")
        self.data = json.loads(path.read_bytes()) if path.exists() else {"sourceId": source_id, "uploads": {}, "commands": {}}
        if self.data["sourceId"] != source_id:
            raise ImportFailure("CHECKPOINT_SCOPE_MISMATCH")

    def save(self):
        write_private(self.path, self.data)


def group_inventory(inventory):
    groups = {source["sourceId"]: {"source": source, "files": []} for source in inventory["sources"]}
    if len(groups) != len(inventory["sources"]):
        raise ImportFailure("DUPLICATE_SOURCE")
    seen = set()
    for file in inventory["files"]:
        if file["path"] in seen:
            raise ImportFailure("DUPLICATE_FILE")
        seen.add(file["path"])
        if file["disposition"] not in ADMITTED:
            continue
        related = file["relatedSourceIds"]
        if len(related) == 1 and related[0] in groups:
            identity = related[0]
        else:
            parent = PurePosixPath(file["path"]).parent.as_posix()
            identity = "files." + digest(parent.encode())[:24]
            if identity not in groups:
                groups[identity] = {"source": {"sourceId": identity, "kind": "FILE_COLLECTION", "name": parent[:256], "relativeDirectory": parent}, "files": []}
        groups[identity]["files"].append(file)
    for group in groups.values():
        group["files"].sort(key=lambda file: file["path"])
        if len(group["files"]) > 1000:
            raise ImportFailure("SOURCE_GROUP_TOO_LARGE")
        kinds = {file["completeness"] for file in group["files"]}
        group["completeness"] = next((kind for kind in ["PARTIAL", "SAMPLE", "UNKNOWN", "EMPTY", "NOT_A_DATASET"] if kind in kinds), "NOT_A_DATASET")
    return [groups[key] for key in sorted(groups)]


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_url(value):
    url = urlsplit(value)
    if url.username or url.password or url.fragment or not url.hostname:
        raise ImportFailure("UNSAFE_TRANSPORT_URL")
    if url.scheme != "https" and not (url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1", "::1"}):
        raise ImportFailure("UNSAFE_TRANSPORT_URL")
    return url


class HttpClient:
    def __init__(self, origin, token_file, tenant, project, purpose):
        parsed = validate_url(origin)
        if parsed.path not in {"", "/"} or parsed.query:
            raise ImportFailure("INVALID_API_ORIGIN")
        self.origin = origin.rstrip("/")
        self.token_file = token_file
        self.tenant, self.project, self.purpose = tenant, project, purpose
        self.opener = build_opener(NoRedirect())

    def headers(self):
        if self.token_file.is_symlink() or self.token_file.stat().st_mode & 0o077:
            raise ImportFailure("TOKEN_FILE_MUST_BE_PRIVATE")
        token = self.token_file.read_text().strip()
        if not token or re.search(r"\s", token):
            raise ImportFailure("INVALID_TOKEN_FILE")
        return {"Authorization": "Bearer " + token, "X-Wiser-Tenant-Id": self.tenant,
                "X-Wiser-Project-Id": self.project, "X-Wiser-Purpose": self.purpose,
                "Accept": "application/json"}

    def open(self, request):
        try:
            return self.opener.open(request, timeout=90)
        except HTTPError as error:
            return error
        except (URLError, TimeoutError, OSError):
            raise ImportFailure("TRANSPORT_UNAVAILABLE") from None

    def api(self, method, path, body=None, key=None, version=None):
        if not path.startswith("/") or path.startswith("//") or "#" in path:
            raise ImportFailure("INVALID_API_PATH")
        headers = self.headers()
        if key:
            headers["Idempotency-Key"] = key
        if version is not None:
            headers["If-Match"] = f'"v{version}"'
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(self.origin + "/api/data/v1" + path, data=encoded(body) if body is not None else None, headers=headers, method=method)
        with self.open(request) as response:
            if response.code < 200 or response.code >= 300:
                raise ImportFailure(f"HTTP_{response.code}")
            content = response.read(2 * 1024 * 1024 + 1)
            if len(content) > 2 * 1024 * 1024:
                raise ImportFailure("API_RESPONSE_TOO_LARGE")
            try:
                return json.loads(content)
            except ValueError:
                raise ImportFailure("INVALID_API_RESPONSE") from None

    def get(self, path):
        return self.api("GET", path)

    def command(self, path, body, key, version=None):
        return self.api("POST", path, body, key, version)

    def put(self, target, content):
        validate_url(target["uploadUrl"])
        headers = target["headers"]
        if any(key.lower() in {"authorization", "cookie", "proxy-authorization"} for key in headers):
            raise ImportFailure("UNSAFE_UPLOAD_HEADERS")
        with self.open(Request(target["uploadUrl"], data=content, headers=headers, method="PUT")) as response:
            if response.code < 200 or response.code >= 300:
                raise ImportFailure(f"UPLOAD_HTTP_{response.code}")

    def download(self, path):
        if not path.startswith("/") or path.startswith("//") or "#" in path:
            raise ImportFailure("INVALID_API_PATH")
        request = Request(self.origin + "/api/data/v1" + path, headers=self.headers())
        with self.open(request) as response:
            if response.code != 303:
                raise ImportFailure(f"DOWNLOAD_HTTP_{response.code}")
            target = response.headers.get("Location", "")
            validate_url(target)
        # A fresh signed request deliberately has no API headers.
        with self.open(Request(target)) as response:
            if response.code != 200:
                raise ImportFailure(f"SIGNED_DOWNLOAD_HTTP_{response.code}")
            hasher, size = hashlib.sha256(), 0
            while content := response.read(1024 * 1024):
                size += len(content)
                if size > 64 * 1024 * 1024:
                    raise ImportFailure("DOWNLOAD_TOO_LARGE")
                hasher.update(content)
            return {"sizeBytes": size, "sha256": hasher.hexdigest()}


class Uploader:
    def __init__(self, client, checkpoint, scope, project):
        self.client, self.checkpoint, self.scope, self.project = client, checkpoint, scope, project

    def key(self, phase):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, self.scope + ":" + self.checkpoint.data["sourceId"] + ":" + phase))

    def upload(self, phase, objects, read_content):
        if not objects:
            return []
        uploads = self.checkpoint.data["uploads"]
        state = uploads.setdefault(phase, {"objectsHash": digest(encoded(objects))})
        if state["objectsHash"] != digest(encoded(objects)):
            raise ImportFailure("UPLOAD_PLAN_CHANGED")
        if state.get("completed"):
            return state["assetIds"]
        if not state.get("uploaded"):
            plan = self.client.command("/upload-sessions", {"ownerProjectId": self.project, "preferredMode": "PRESIGNED_PUT", "objects": objects}, self.key(phase + ":create"))
            session = plan["uploadSession"]
            targets = {target["assetId"]: target for target in plan["uploadTargets"]}
            if len(session["assetIds"]) != len(objects) or len(targets) != len(objects):
                raise ImportFailure("INVALID_UPLOAD_PLAN")
            if state.get("sessionId") and state["sessionId"] != session["uploadSessionId"]:
                raise ImportFailure("UPLOAD_IDENTITY_CHANGED")
            state.update({"sessionId": session["uploadSessionId"], "version": session["version"], "assetIds": session["assetIds"]})
            self.checkpoint.save()
            for index, asset_id in enumerate(state["assetIds"]):
                target = targets[asset_id]
                if target["method"] != "PRESIGNED_PUT":
                    raise ImportFailure("UNSUPPORTED_UPLOAD_MODE")
                content = read_content(index)
                if len(content) != objects[index]["sizeBytes"] or digest(content) != objects[index]["sha256"]:
                    raise ImportFailure("PREPARED_FILE_CHANGED")
                self.client.put(target, content)
            state["uploaded"] = True
            state["completeBody"] = {"objects": [{"assetId": asset_id, "sizeBytes": objects[index]["sizeBytes"], "sha256": objects[index]["sha256"]} for index, asset_id in enumerate(state["assetIds"])]}
            self.checkpoint.save()
        # Persisted completion inputs survive a lost response. Never reopen a
        # session that may already be completed at the authority.
        result = self.client.command(f'/upload-sessions/{state["sessionId"]}/complete', state["completeBody"], self.key(phase + ":complete"), state["version"])
        if result["uploadSession"]["status"] != "COMPLETED" or result["uploadSession"]["assetIds"] != state["assetIds"]:
            raise ImportFailure("UPLOAD_COMPLETION_MISMATCH")
        state["completed"] = True
        self.checkpoint.save()
        return state["assetIds"]


def registration_review_allowed(snapshot, registration, operation):
    return (snapshot["ingestion"]["state"] == "REVIEW_REQUIRED"
            and snapshot["ingestion"].get("sourceRegistration") == registration
            and operation["status"] == "WAITING_REVIEW"
            and snapshot.get("qualityIssues") == []
            and snapshot.get("agentRuns") == [])


class GroupImporter:
    def __init__(self, client, bundle, inventory, state_dir, scope, *, approve=False, timeout=1800):
        self.client, self.bundle, self.inventory = client, bundle, inventory
        self.state_dir, self.scope, self.approve, self.timeout = state_dir, scope, approve, timeout
        self.sanitizer = Sanitizer(bundle)

    def process(self, group):
        source = group["source"]
        checkpoint = Checkpoint(self.state_dir / (digest(source["sourceId"].encode()) + ".json"), source["sourceId"])
        upload = Uploader(self.client, checkpoint, self.scope, self.client.project)

        def command(phase, path, body, version=None):
            commands = checkpoint.data["commands"]
            if phase not in commands:
                commands[phase] = {"path": path, "body": body, "key": upload.key(phase), "version": version}
                checkpoint.save()
            saved = commands[phase]
            if "result" not in saved:
                saved["result"] = self.client.command(saved["path"], saved["body"], saved["key"], saved["version"])
                checkpoint.save()
            return saved["result"]

        nonempty = [file for file in group["files"] if file["preparedSizeBytes"] > 0]
        objects = [{"fileName": PurePosixPath(file["path"]).name, "mediaType": file["mediaType"], "sizeBytes": file["preparedSizeBytes"], "sha256": file["preparedSha256"]} for file in nonempty]

        def read_content(index):
            file = nonempty[index]
            content = safe_path(self.bundle, file["path"]).read_bytes()
            if digest(content) != file["sha256"] or len(content) != file["sizeBytes"]:
                raise ImportFailure("ORIGINAL_FILE_CHANGED")
            disposition, prepared = file_admission(PurePosixPath(file["path"]), content, self.sanitizer)
            if disposition != file["disposition"] or prepared is None:
                raise ImportFailure("ADMISSION_CHANGED")
            return prepared

        asset_ids = upload.upload("files", objects, read_content)
        path_to_asset = {file["path"]: asset for file, asset in zip(nonempty, asset_ids, strict=True)}
        manifest = {"schemaVersion": "wiser.source-registration.v1", "sourceId": source["sourceId"], "record": source,
                    "files": [{**{key: file[key] for key in ["path", "sizeBytes", "sha256", "preparedSizeBytes", "preparedSha256", "artifactClass", "completeness", "disposition", "relatedSourceIds"]},
                               **({"assetId": path_to_asset[file["path"]]} if file["path"] in path_to_asset else {})} for file in group["files"]]}
        manifest_bytes = encoded(manifest)
        if len(manifest_bytes) > 512 * 1024:
            raise ImportFailure("MANIFEST_TOO_LARGE")
        manifest_object = {"fileName": "source-registration.json", "mediaType": "application/json", "sizeBytes": len(manifest_bytes), "sha256": digest(manifest_bytes)}
        manifest_id = upload.upload("manifest", [manifest_object], lambda _: manifest_bytes)[0]
        catalog, entry, provider = source.get("catalog", {}), source.get("registration", {}), source.get("provider", {})
        registration = {"sourceId": source["sourceId"], "kind": source["kind"], "name": source["name"][:256],
                        "bundleId": self.inventory["bundleName"], "manifestAssetId": manifest_id, "manifestSha256": digest(manifest_bytes),
                        "providerName": (entry.get("provider_name") or catalog.get("provider_guess") or provider.get("provider_name") or "Research bundle")[:256],
                        "accessStatus": (entry.get("access_status") or catalog.get("minimal_access_status") or provider.get("credential_ref_status") or "NOT_VERIFIED")[:256],
                        "completeness": group["completeness"], "limitations": LIMITATIONS}
        created = command("ingestion-create", "/ingestions", {"ownerProjectId": self.client.project, "assetIds": asset_ids + [manifest_id], "intendedUses": ["source-registration"], "requestedSecurityLevel": "L2_RESTRICTED", "sourceRegistration": registration})
        ingestion_id, operation_id = created["ingestionId"], created["operation"]["operationId"]
        checkpoint.data.update({"ingestionId": ingestion_id, "operationId": operation_id, "registration": registration})
        checkpoint.save()
        ingestion_path = "/ingestions/" + ingestion_id
        # A recorded submit always replays its original precondition after an
        # ambiguous response; fetching a newer version cannot change its body.
        if "ingestion-submit" not in checkpoint.data["commands"]:
            snapshot = self.client.get(ingestion_path)
            if snapshot["ingestion"]["state"] != "RECEIVED":
                raise ImportFailure("UNEXPECTED_INITIAL_INGESTION_STATE")
            initial_version = snapshot["ingestion"]["version"]
        else:
            initial_version = checkpoint.data["commands"]["ingestion-submit"]["version"]
        command("ingestion-submit", ingestion_path + "/submit", {}, initial_version)
        deadline = time.monotonic() + self.timeout
        while True:
            snapshot = self.client.get(ingestion_path)
            ingestion = snapshot["ingestion"]
            operation = self.client.get("/operations/" + operation_id)
            checkpoint.data["state"] = ingestion["state"]
            if ingestion.get("sourceRegistration") != registration:
                raise ImportFailure("REGISTERED_SOURCE_MISMATCH")
            if operation["status"] in {"FAILED", "CANCELLED", "WAITING_INPUT"} or ingestion["state"] in {"FAILED", "CANCELLED", "REJECTED"}:
                checkpoint.save()
                code = operation.get("error", {}).get("code", operation["status"])
                raise ImportFailure("INGESTION_" + code if re.fullmatch(r"[A-Z_0-9]{1,128}", code) else "INGESTION_FAILED")
            if ingestion["state"] == "REVIEW_REQUIRED":
                if not self.approve:
                    checkpoint.save()
                    return self.result(checkpoint, group)
                if not registration_review_allowed(snapshot, registration, operation):
                    raise ImportFailure("REGISTRATION_REVIEW_EVIDENCE_REQUIRED")
                command("ingestion-approve", ingestion_path + "/approve", {"reviewNote": "Authorized research-bundle registration: exact manifest and asset integrity verified. Approval covers scoped source registration only, not analytical quality or external redistribution.", "conditions": LIMITATIONS}, ingestion["version"])
            if ingestion["state"] == "PUBLISHED" and operation["status"] == "SUCCEEDED":
                break
            if time.monotonic() >= deadline:
                checkpoint.save()
                raise ImportFailure("PUBLICATION_TIMEOUT")
            time.sleep(1)
        version = self.client.get("/catalog/data-items/" + ingestion_id).get("selectedVersion")
        if not version or version["publicationStatus"] != "PUBLISHED" or set(version["assetIds"]) != set(asset_ids + [manifest_id]):
            raise ImportFailure("PUBLISHED_ASSET_SET_MISMATCH")
        if version["processingStage"] != "METADATA_QUALITY" or version["generationMethod"] != "DECLARED" or version["securityLevel"] != "L2_RESTRICTED":
            raise ImportFailure("PUBLISHED_REGISTRATION_SCOPE_MISMATCH")
        checkpoint.data["versionId"] = version["versionId"]
        checkpoint.data["governance"] = {key: version[key] for key in ["processingStage", "generationMethod", "qualityGrade", "acceptanceStatus", "publicationStatus", "securityLevel"]}
        expected = dict(zip(asset_ids, [{"sizeBytes": item["sizeBytes"], "sha256": item["sha256"]} for item in objects], strict=True))
        expected[manifest_id] = {"sizeBytes": len(manifest_bytes), "sha256": digest(manifest_bytes)}
        # Re-running a completed group rechecks authority and all bytes without
        # issuing fresh ingestion commands or trusting a cached success label.
        for asset_id, fingerprint in expected.items():
            path = f'/tenants/{self.client.tenant}/projects/{self.client.project}/versions/{version["versionId"]}/assets/{asset_id}'
            if self.client.download(path) != fingerprint:
                raise ImportFailure("PERSISTED_FILE_HASH_MISMATCH")
        checkpoint.data.update({"verifiedAssets": len(expected), "verifiedFileBytes": sum(file["preparedSizeBytes"] for file in group["files"]), "state": "VERIFIED"})
        checkpoint.data.pop("lastError", None)
        checkpoint.save()
        return self.result(checkpoint, group)

    @staticmethod
    def result(checkpoint, group):
        return {key: checkpoint.data[key] for key in ["sourceId", "state", "ingestionId", "operationId", "versionId", "verifiedAssets", "verifiedFileBytes", "governance"] if key in checkpoint.data} | {"files": len(group["files"]), "kind": group["source"]["kind"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--api-origin", required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--purpose", default="operate")
    parser.add_argument("--approve-registration", action="store_true", help="Use only an authorized reviewer's identity and assignment for registration-only approval.")
    parser.add_argument("--source-ids", help="Comma-separated pilot identities; omit to process the entire inventory.")
    parser.add_argument("--workers", type=int, default=4, choices=range(1, 9))
    parser.add_argument("--timeout", type=int, default=1800)
    args = parser.parse_args()
    args.bundle = args.bundle.resolve(strict=True)
    for output in [args.inventory, args.state_dir, args.token_file]:
        if output.resolve().is_relative_to(args.bundle):
            raise ImportFailure("STATE_MUST_BE_OUTSIDE_BUNDLE")
    inventory = json.loads(args.inventory.read_bytes())
    # Full re-reconciliation detects changes even in empty/excluded inputs.
    if inventory != build_inventory(args.bundle):
        raise ImportFailure("INVENTORY_CHANGED")
    groups = group_inventory(inventory)
    if args.source_ids:
        selected = set(args.source_ids.split(","))
        groups = [group for group in groups if group["source"]["sourceId"] in selected]
        if len(groups) != len(selected):
            raise ImportFailure("UNKNOWN_SOURCE_SELECTION")
    client = HttpClient(args.api_origin, args.token_file, args.tenant, args.project, args.purpose)
    discovery = client.get("/capabilities")
    capabilities = {capability["id"]: capability for capability in discovery["capabilities"]}
    if capabilities.get("data.ingestion.create", {}).get("version") != "1.1.0":
        raise ImportFailure("SOURCE_REGISTRATION_CAPABILITY_REQUIRED")
    context = {"schemaVersion": "wiser.water-import.v1", "inventoryHash": digest(encoded(inventory)), "apiOrigin": client.origin, "tenantId": args.tenant, "projectId": args.project, "purpose": args.purpose, "securityLevel": "L2_RESTRICTED"}
    args.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (args.state_dir / ".lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ImportFailure("IMPORT_ALREADY_RUNNING") from None
        context_file = args.state_dir / "context.json"
        if context_file.exists() and json.loads(context_file.read_bytes()) != context:
            raise ImportFailure("IMPORT_CONTEXT_CHANGED")
        write_private(context_file, context)
        importer = GroupImporter(client, args.bundle, inventory, args.state_dir / "groups", digest(encoded(context)), approve=args.approve_registration, timeout=args.timeout)
        results = []
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            pending = {executor.submit(importer.process, group): group for group in groups}
            for future in as_completed(pending):
                group = pending[future]
                try:
                    result = future.result()
                except Exception as error:
                    code = str(error) if isinstance(error, ImportFailure) and re.fullmatch(r"[A-Z_0-9]{1,160}", str(error)) else "IMPORT_UNEXPECTED_FAILURE"
                    result = {"sourceId": group["source"]["sourceId"], "state": "FAILED", "error": code}
                results.append(result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
        summary = {"selectedGroups": len(groups), "verifiedGroups": sum(result["state"] == "VERIFIED" for result in results), "verifiedFiles": sum(result.get("files", 0) for result in results if result["state"] == "VERIFIED"), "verifiedAssets": sum(result.get("verifiedAssets", 0) for result in results), "verifiedFileBytes": sum(result.get("verifiedFileBytes", 0) for result in results), "failedGroups": sum(result["state"] == "FAILED" for result in results)}
        write_private(args.state_dir / "last-run.json", {"context": context, "summary": summary, "results": sorted(results, key=lambda result: result["sourceId"])})
        print(json.dumps(summary), flush=True)
        return 0 if summary["verifiedGroups"] == len(groups) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ImportFailure, ValueError, OSError) as error:
        code = str(error) if isinstance(error, (ImportFailure, ValueError)) and re.fullmatch(r"[A-Z_0-9]{1,160}", str(error)) else "IMPORT_PREFLIGHT_FAILED"
        print(json.dumps({"state": "FAILED", "error": code}), flush=True)
        raise SystemExit(1) from None
