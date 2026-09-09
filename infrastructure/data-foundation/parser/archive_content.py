"""Expand bounded archives, preserve member identities, and parse supported contents."""

import csv
import hashlib
import json
import tempfile
from pathlib import Path

from parser import (
    MAX_EXPANDED_BYTES,
    ParseError,
    parse_asset,
    record,
    safe_archive,
    schema,
)

SUPPORTED = {
    "csv",
    "json",
    "doc",
    "docx",
    "md",
    "html",
    "txt",
    "pdf",
    "xls",
    "xlsx",
    "shp",
    "tif",
    "tiff",
    "nc",
    "adf",
}
COMPANIONS = {".dbf", ".shx", ".prj", ".sbn", ".sbx", ".cpg", ".qix"}


def tabular(path, kind):
    if kind == "csv":
        csv.field_size_limit(1024 * 1024)
        with path.open(encoding="utf-8-sig", newline="") as source:
            rows = csv.reader(source, strict=True)
            labels = next(rows, [])
            if len(labels) != len(set(labels)) or any(not label for label in labels):
                raise ParseError("INVALID_CONTENT")
            yield schema(labels)
            for values in rows:
                if not values:
                    continue
                if len(values) != len(labels):
                    raise ParseError("INCONSISTENT_COLUMNS")
                yield record(
                    {
                        f"c{index + 1}": value if value else None
                        for index, value in enumerate(values)
                    }
                )
    else:
        values = json.loads(path.read_text(encoding="utf-8-sig"))
        rows = values if isinstance(values, list) else [values]
        if any(not isinstance(row, dict) for row in rows):
            raise ParseError("INVALID_CONTENT")
        labels = list(dict.fromkeys(key for row in rows for key in row))
        yield schema(labels)
        for value in rows:
            yield record(
                {
                    f"c{index + 1}": value.get(label)
                    for index, label in enumerate(labels)
                }
            )


def member_events(path, kind):
    if kind not in ("csv", "json"):
        yield from parse_asset(path, kind)
        return
    count = 0
    for event in tabular(path, kind):
        if event["type"] == "record":
            count += 1
            event["index"] = count
        yield event
    yield {
        "type": "summary",
        "status": "READY" if count else "EMPTY",
        "recordCount": count,
        "featureCount": 0,
        "reason": None,
    }


def archive_content(path):
    yield schema(
        [
            "Member path",
            "Bytes",
            "SHA-256",
            "Format",
            "Source row",
            "Content",
            "Content kind",
            "Columns",
        ]
    )
    partial = False
    with tempfile.TemporaryDirectory(prefix="wiser-archive-") as directory:
        root = Path(directory)
        members = []
        with safe_archive(path) as archive:
            total = 0
            for entry in archive.infolist():
                if entry.is_dir():
                    continue
                target = root / entry.filename
                target.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                size = 0
                with archive.open(entry) as source, target.open("xb") as output:
                    for chunk in iter(lambda: source.read(65536), b""):
                        size += len(chunk)
                        total += len(chunk)
                        if size > entry.file_size or total > MAX_EXPANDED_BYTES:
                            raise ParseError("ARCHIVE_LIMIT")
                        digest.update(chunk)
                        output.write(chunk)
                members.append((entry.filename, target, size, digest.hexdigest()))
        for name, member, size, digest in members:
            kind = member.suffix.lower()[1:]
            columns = []
            records = 0
            features = 0
            outcome = {
                "status": "UNSUPPORTED",
                "reason": "FORMAT_UNSUPPORTED",
                "recordCount": 0,
                "featureCount": 0,
            }
            companion = (
                member.suffix.lower() in COMPANIONS
                and member.with_suffix(".shp").is_file()
            )
            companion |= (
                kind == "adf"
                and member.name.lower() != "hdr.adf"
                and (member.parent / "hdr.adf").is_file()
            )
            if companion:
                outcome = {
                    "status": "READY",
                    "reason": "FORMAT_COMPANION",
                    "recordCount": 0,
                    "featureCount": 0,
                }
            elif kind in SUPPORTED:
                try:
                    for event in member_events(member, kind):
                        if event["type"] == "schema":
                            columns = event["columns"]
                        elif event["type"] == "record":
                            records += 1
                            features += int(event["geometry"] is not None)
                            yield record(
                                {
                                    "c1": name,
                                    "c2": size,
                                    "c3": digest,
                                    "c4": kind,
                                    "c5": event["index"],
                                    "c6": event["values"],
                                    "c7": "CONTENT",
                                    "c8": columns,
                                },
                                event["geometry"],
                                source_crs=event["sourceCrs"],
                            )
                        elif event["type"] == "summary":
                            outcome = {
                                key: event[key]
                                for key in (
                                    "status",
                                    "reason",
                                    "recordCount",
                                    "featureCount",
                                )
                            }
                except (ParseError, ValueError, csv.Error, OSError) as error:
                    outcome = {
                        "status": "PARTIAL" if records else "INVALID",
                        "reason": str(error)
                        if isinstance(error, ParseError)
                        else "INVALID_CONTENT",
                        "recordCount": records,
                        "featureCount": features,
                    }
            partial |= outcome["status"] not in ("READY", "EMPTY")
            yield record(
                {
                    "c1": name,
                    "c2": size,
                    "c3": digest,
                    "c4": kind,
                    "c5": None,
                    "c6": outcome,
                    "c7": "MEMBER_SUMMARY",
                    "c8": columns,
                }
            )
    if partial:
        yield {"type": "warning", "reason": "ARCHIVE_MEMBERS_PARTIAL"}
