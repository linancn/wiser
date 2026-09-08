"""Reconcile a local research bundle without executing its code or instructions.

Only Python's standard library is used. Credentials never enter the inventory;
the source directory remains untouched. HTTP ingestion is a separate phase.
"""

import argparse
import csv
import hashlib
import io
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


csv.field_size_limit(64 * 1024 * 1024)
SECRET_KEY = re.compile(r"(?i)(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|cookie|signature|credential)$")
URL_PATTERN = re.compile(r"https?://[^\s<>\"'`]+", re.IGNORECASE)
TEXT_SUFFIXES = {".csv", ".json", ".yaml", ".yml", ".md", ".txt", ".html", ".htm", ".xml", ".js", ".mjs", ".py", ".prj", ".lock", ".in"}


def digest(content):
    return hashlib.sha256(content).hexdigest()


def safe_path(root, relative):
    path = PurePosixPath(relative)
    if not relative or path.is_absolute() or ".." in path.parts or "\\" in relative:
        raise ValueError("UNSAFE_PATH")
    candidate = root.joinpath(*path.parts)
    if any(item.is_symlink() for item in [candidate, *candidate.parents] if item != root.parent):
        raise ValueError("UNSAFE_PATH")
    if not candidate.resolve().is_relative_to(root):
        raise ValueError("UNSAFE_PATH")
    return candidate


def read_csv(root, relative):
    with safe_path(root, relative).open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        fields = reader.fieldnames or []
        if not fields or len(fields) != len(set(fields)):
            raise ValueError("INVALID_CSV_HEADER")
        rows = list(reader)
        if any(None in row or any(value is None for value in row.values()) for row in rows):
            raise ValueError("INVALID_CSV_ROW")
        return rows


def unique(rows, key):
    result = {}
    for row in rows:
        value = row.get(key)
        if not value or value in result:
            raise ValueError("DUPLICATE_SOURCE")
        result[value] = row
    return result


class Sanitizer:
    def __init__(self, root):
        values = set()
        environment = root / ".env"
        if environment.is_file():
            for line in environment.read_text(encoding="utf-8-sig").splitlines():
                match = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)", line)
                if not match or not SECRET_KEY.search(match[1]):
                    continue
                value = match[2].strip()
                if value[:1] in {"'", '"'} and value[-1:] == value[:1]:
                    value = value[1:-1]
                else:
                    value = value.split(" #", 1)[0].strip()
                if len(value) >= 8 and not value.startswith(("${", "<", "your_", "your-")):
                    values.add(value)
        self.secrets = re.compile("|".join(re.escape(value) for value in sorted(values, key=len, reverse=True))) if values else None

    @staticmethod
    def url(match):
        try:
            url = urlsplit(match[0])
            host = url.hostname or ""
            if ":" in host:
                host = f"[{host}]"
            if url.port:
                host += f":{url.port}"
            query = [(key, value) for key, value in parse_qsl(url.query, keep_blank_values=True)
                     if not SECRET_KEY.search(key) and not key.lower().startswith(("x-amz-", "x-goog-"))]
            if not url.username and not url.password and len(query) == len(parse_qsl(url.query, keep_blank_values=True)):
                return match[0]
            return urlunsplit((url.scheme, host, url.path, urlencode(query), ""))
        except ValueError:
            return "[REDACTED_URL]"

    def text(self, value):
        value = URL_PATTERN.sub(self.url, value)
        if self.secrets:
            value = self.secrets.sub("[REDACTED]", value)
        value = re.sub(r"(?i)(authorization\s*[:=]\s*(?:Bearer|Basic)\s+)[^\s\"'<>]+", r"\1[REDACTED]", value)
        value = re.sub(r"\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b", "[REDACTED_JWT]", value)
        return value

    @staticmethod
    def credential_field(key):
        key = key.strip()
        return re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", key) and SECRET_KEY.search(key)

    @staticmethod
    def cell(key, value):
        if key.strip().lower() == "requires_login_or_credential" and value.lower() in {"yes", "no", "true", "false", "0", "1"}:
            return value
        return "[REDACTED]" if value and Sanitizer.credential_field(key) else value

    def row(self, row):
        return {key: self.text(self.cell(key, value)) for key, value in row.items()}

    def csv(self, value):
        reader = csv.DictReader(io.StringIO(value, newline=""))
        fields = reader.fieldnames or []
        if not any(self.credential_field(key) for key in fields):
            return value
        rows = list(reader)
        if len(fields) != len(set(fields)) or any(None in row or any(cell is None for cell in row.values()) for row in rows):
            raise ValueError("INVALID_CREDENTIAL_CSV")
        cleaned = [{key: self.cell(key, cell) for key, cell in row.items()} for row in rows]
        if cleaned == rows:
            return value
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(cleaned)
        return output.getvalue()


def detected_media(path, content):
    prefix = content[:4096].lstrip().lower()
    if prefix.startswith((b"<!doctype html", b"<html", b"<head", b"<body")):
        return "text/html"
    if content.startswith(b"%PDF-"):
        return "application/pdf"
    if content.startswith((b"II*\0", b"MM\0*")):
        return "image/tiff"
    if content.startswith(b"PK\x03\x04") and path.suffix.lower() not in {".xlsx", ".docx"}:
        return "application/zip"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    media = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return {"text/x-python": "text/plain"}.get(media, media)


def file_admission(path, content, sanitizer):
    if path.name == ".env" or path.name.startswith(".env."):
        return "EXCLUDE_SECRET", None
    if path.name in {".DS_Store", ".gitignore"} or "__pycache__" in path.parts:
        return "EXCLUDE_SYSTEM", None
    if path.parts[0] in {"scripts", "src"} or path.name in {"requirements.in", "requirements.lock"}:
        return "EXCLUDE_IMPLEMENTATION", None
    media = detected_media(path, content)
    if path.suffix.lower() in TEXT_SUFFIXES or media.startswith("text/"):
        try:
            original = content.decode("utf-8")
            text = sanitizer.csv(original) if path.suffix.lower() == ".csv" else original
            cleaned = sanitizer.text(text).encode("utf-8")
            if cleaned != content:
                return "SANITIZE_TEXT", cleaned
        except UnicodeDecodeError:
            if sanitizer.secrets and sanitizer.secrets.search(content.decode("latin-1")):
                raise ValueError("NON_UTF8_CREDENTIAL_MATERIAL")
    elif sanitizer.secrets and sanitizer.secrets.search(content.decode("latin-1")):
        raise ValueError("BINARY_CREDENTIAL_MATERIAL")
    return "IMPORT", content


def completeness(path, content, download):
    kind = download.get("artifact_class", "")
    if len(content) == 0:
        return "EMPTY"
    if kind in {"bounded_partial_sample", "partial_download"} or download.get("likely_complete") == "no" or path.suffix.lower() == ".part":
        return "PARTIAL"
    if kind == "page_or_entry_snapshot" or detected_media(path, content) == "text/html":
        return "NOT_A_DATASET"
    if kind == "validation_sample":
        return "SAMPLE"
    return "UNKNOWN"


def verify_manifest(root, rows):
    result = unique(rows, "relative_path")
    for relative, row in result.items():
        path = safe_path(root, relative)
        if not path.is_file():
            raise ValueError("MANIFEST_INTEGRITY_MISSING")
        content = path.read_bytes()
        if len(content) != int(row["size_bytes"]) or digest(content) != row["sha256"]:
            raise ValueError("MANIFEST_INTEGRITY_MISMATCH")
    return result


def build_inventory(root):
    root = Path(root).resolve(strict=True)
    paths = sorted(root.rglob("*"))
    for path in paths:
        if path.is_symlink():
            raise ValueError("UNSAFE_PATH")
    package = verify_manifest(root, read_csv(root, "MANIFEST/package_files_manifest.csv"))
    downloads = verify_manifest(root, read_csv(root, "MANIFEST/downloaded_files_manifest.csv"))
    registrations = unique(read_csv(root, "MANIFEST/registered_data_entries.csv"), "registry_id")
    providers = unique(read_csv(root, "MANIFEST/registered_providers.csv"), "provider_id")
    catalog = unique(read_csv(root, "data_registry/catalog/data_sources_catalog.csv"), "registry_id")
    if registrations.keys() - catalog.keys():
        raise ValueError("UNMAPPED_REGISTRATION")
    for record in [*registrations.values(), *providers.values()]:
        source = safe_path(root, record["source_config_path"])
        if digest(source.read_bytes()) != record["source_config_sha256"]:
            raise ValueError("MANIFEST_INTEGRITY_CONFIG")
    sanitizer = Sanitizer(root)
    sources = [
        {"sourceId": key, "kind": "PROVIDER", "name": row["provider_name"], "provider": sanitizer.row(row)}
        for key, row in sorted(providers.items())
    ]
    sources += [
        {"sourceId": key, "kind": "DATASET_INTERFACE" if key in registrations else "CATALOG_ENTRY",
         "name": sanitizer.text(row["canonical_name"]), "catalog": sanitizer.row(row),
         **({"registration": sanitizer.row(registrations[key])} if key in registrations else {})}
        for key, row in sorted(catalog.items())
    ]
    files = []
    for path in paths:
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        if sanitizer.text(relative) != relative:
            raise ValueError("CREDENTIAL_IN_SOURCE_PATH")
        content = path.read_bytes()
        relative_path = PurePosixPath(relative)
        disposition, prepared = file_admission(relative_path, content, sanitizer)
        downloaded = downloads.get(relative, {})
        files.append({
            "path": relative, "sizeBytes": len(content), "sha256": digest(content),
            "mediaType": detected_media(relative_path, content),
            "manifestStatus": "VERIFIED" if relative in package else "MANIFEST" if relative.startswith("MANIFEST/") else "UNLISTED",
            "artifactClass": downloaded.get("artifact_class") or ("unlisted_download" if relative.startswith("downloads/") else "supporting_record"),
            "declaredCompleteness": downloaded.get("likely_complete", "unknown"),
            "completeness": completeness(relative_path, content, downloaded),
            "disposition": disposition,
            "relatedSourceIds": sorted(set(re.findall(r"DS-\d{4}", relative)) & catalog.keys()),
            **({"preparedSha256": digest(prepared), "preparedSizeBytes": len(prepared)} if prepared is not None else {}),
        })
    counts = {}
    for item in files:
        counts[item["disposition"]] = counts.get(item["disposition"], 0) + 1
    return {
        "schemaVersion": "wiser.water-bundle.v1", "bundleName": root.name,
        "summary": {"fileCount": len(files), "byteCount": sum(x["sizeBytes"] for x in files),
                    "providerCount": len(providers), "registeredCount": len(registrations), "catalogCount": len(catalog),
                    "verifiedPackageFileCount": len(package), "verifiedDownloadFileCount": len(downloads),
                    "dispositions": counts},
        "sources": sources, "files": files,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["inventory"])
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.out.resolve().is_relative_to(args.bundle.resolve()):
        parser.error("Output must be outside the source bundle.")
    report = build_inventory(args.bundle)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.out.with_suffix(args.out.suffix + ".tmp")
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as out:
        json.dump(report, out, ensure_ascii=False, indent=2)
        out.write("\n")
    temporary.replace(args.out)
    print(json.dumps(report["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
