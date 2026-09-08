"""Synthetic invariants plus an optional local, non-redistributed real case."""

import csv
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest

from water_bundle import Sanitizer, build_inventory, file_admission, read_csv


def csv_file(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.write(".env", b'PROVIDER_TOKEN="private-token-never-upload-this"\n')
        self.write("output/downloads/DS-0001_sample.bin", b"partial bytes")
        self.write("downloads/unlisted.csv", b"station,value\r\nA,1\r\n")
        self.write("downloads/.DS_Store", b"desktop metadata")
        self.write("scripts/unsafe.py", b'raise Exception("must never run")\n')
        self.write("output/access.md", b"Authorization: Bearer private-token-never-upload-this\n")
        self.write("config/datasets.yaml", b"datasets: []\n")
        self.write("config/providers.yaml", b"providers: []\n")
        csv_file(self.root / "MANIFEST/registered_data_entries.csv", [{
            "dataset_id": "ds_one", "registry_id": "DS-0001", "canonical_name": "River sample",
            "provider": "river", "credential_ref": "env:PROVIDER_TOKEN",
            "authoritative_url": "https://example.test/data?token=private-token-never-upload-this&format=csv",
            "source_config_path": "config/datasets.yaml",
            "source_config_sha256": self.sha("config/datasets.yaml"),
        }])
        csv_file(self.root / "MANIFEST/registered_providers.csv", [{
            "provider_id": "river", "provider_name": "River provider",
            "source_config_path": "config/providers.yaml",
            "source_config_sha256": self.sha("config/providers.yaml"),
        }])
        csv_file(self.root / "data_registry/catalog/data_sources_catalog.csv", [
            {"registry_id": "DS-0001", "canonical_name": "River sample"},
            {"registry_id": "DS-0002", "canonical_name": "Unregistered portal"},
        ])
        csv_file(self.root / "MANIFEST/downloaded_files_manifest.csv", [{
            "relative_path": "output/downloads/DS-0001_sample.bin",
            "size_bytes": 13, "sha256": self.sha("output/downloads/DS-0001_sample.bin"),
            "artifact_class": "bounded_partial_sample", "likely_complete": "no",
        }])
        csv_file(self.root / "MANIFEST/package_files_manifest.csv", [
            {"relative_path": path, "size_bytes": (self.root / path).stat().st_size,
             "sha256": self.sha(path), "content_category": "test"}
            for path in [".env", "output/downloads/DS-0001_sample.bin", "output/access.md"]
        ])

    def write(self, path, content):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def sha(self, path):
        return hashlib.sha256((self.root / path).read_bytes()).hexdigest()

    def test_reconciles_every_file_and_merges_registered_entries_with_catalog(self):
        report = build_inventory(self.root)
        self.assertEqual(report["summary"]["fileCount"], len(list(self.root.rglob("*.*"))))
        self.assertEqual(report["summary"]["providerCount"], 1)
        self.assertEqual(report["summary"]["catalogCount"], 2)
        self.assertEqual(report["summary"]["registeredCount"], 1)
        self.assertEqual(len(report["sources"]), 3)
        one = next(x for x in report["sources"] if x["sourceId"] == "DS-0001")
        self.assertEqual(one["registration"]["dataset_id"], "ds_one")
        self.assertEqual(one["registration"]["credential_ref"], "env:PROVIDER_TOKEN")
        self.assertEqual(one["registration"]["authoritative_url"], "https://example.test/data?format=csv")
        files = {x["path"]: x for x in report["files"]}
        self.assertEqual(files["downloads/unlisted.csv"]["manifestStatus"], "UNLISTED")
        self.assertEqual(files["output/downloads/DS-0001_sample.bin"]["completeness"], "PARTIAL")
        self.assertEqual(files["output/downloads/DS-0001_sample.bin"]["relatedSourceIds"], ["DS-0001"])
        self.assertEqual(files[".env"]["disposition"], "EXCLUDE_SECRET")
        self.assertEqual(files["downloads/.DS_Store"]["disposition"], "EXCLUDE_SYSTEM")
        self.assertEqual(files["scripts/unsafe.py"]["disposition"], "EXCLUDE_IMPLEMENTATION")
        self.assertEqual(files["output/access.md"]["disposition"], "SANITIZE_TEXT")
        self.assertNotIn("private-token-never-upload-this", json.dumps(report))

    def test_detects_corruption_before_returning_an_import_plan(self):
        self.write("output/downloads/DS-0001_sample.bin", b"changed bytes")
        with self.assertRaisesRegex(ValueError, "MANIFEST_INTEGRITY"):
            build_inventory(self.root)

    def test_redacts_credential_columns_in_every_source_registry_without_env_values(self):
        fields = {"password": "new-password", "API_KEY": "new-api-key", "access_token": "new-access-token"}
        for relative in ["MANIFEST/registered_providers.csv", "MANIFEST/registered_data_entries.csv",
                         "data_registry/catalog/data_sources_catalog.csv"]:
            rows = read_csv(self.root, relative)
            csv_file(self.root / relative, [{**row, **fields, "credential_ref": "env:PROVIDER_TOKEN"} for row in rows])
        report = build_inventory(self.root)
        for source in report["sources"]:
            for kind in ["provider", "catalog", "registration"]:
                if kind not in source:
                    continue
                for key in fields:
                    self.assertEqual(source[kind][key], "[REDACTED]")
                self.assertEqual(source[kind]["credential_ref"], "env:PROVIDER_TOKEN")
        for value in fields.values():
            self.assertNotIn(value, json.dumps(report))

    def test_prepares_csv_assets_without_credential_cells_and_preserves_references(self):
        path = Path("downloads/credentials.csv")
        content = b'name,password,api_key,credential_ref\r\n"River, sample",p,"new,key",env:PROVIDER_TOKEN\r\nEmpty,,,\r\n'
        self.write(path, content)
        disposition, prepared = file_admission(path, content, Sanitizer(self.root))
        self.assertEqual(disposition, "SANITIZE_TEXT")
        self.assertEqual(list(csv.DictReader(prepared.decode().splitlines())), [
            {"name": "River, sample", "password": "[REDACTED]", "api_key": "[REDACTED]", "credential_ref": "env:PROVIDER_TOKEN"},
            {"name": "Empty", "password": "", "api_key": "", "credential_ref": ""},
        ])
        self.assertEqual((self.root / path).read_bytes(), content)

    def test_rejects_ambiguous_credential_csv_before_admission(self):
        for content in [b"name,password,password\nRiver,one,two\n", b"name,password\nRiver,one,two\n"]:
            with self.subTest(content=content), self.assertRaisesRegex(ValueError, "INVALID_CREDENTIAL_CSV"):
                file_admission(Path("downloads/credentials.csv"), content, Sanitizer(self.root))

    def test_preserves_boolean_access_requirements_without_exempting_credential_values(self):
        sanitizer = Sanitizer(self.root)
        self.assertEqual(sanitizer.row({"requires_login_or_credential": "yes", "password": "false"}),
                         {"requires_login_or_credential": "yes", "password": "[REDACTED]"})
        self.assertEqual(sanitizer.row({"requires_login_or_credential": "unexpected-private-value"}),
                         {"requires_login_or_credential": "[REDACTED]"})
        content = b'requires_login_or_credential,credential_ref\r\nyes,env:PROVIDER_TOKEN\r\n'
        self.assertEqual(file_admission(Path("requirements.csv"), content, sanitizer), ("IMPORT", content))

    def test_rejects_a_manifest_path_escape(self):
        csv_file(self.root / "MANIFEST/package_files_manifest.csv", [{
            "relative_path": "../elsewhere", "size_bytes": 1, "sha256": "0" * 64,
        }])
        with self.assertRaisesRegex(ValueError, "UNSAFE_PATH"):
            build_inventory(self.root)

    def test_rejects_symlinks_even_when_not_in_the_manifest(self):
        (self.root / "downloads/link").symlink_to(self.root / ".env")
        with self.assertRaisesRegex(ValueError, "UNSAFE_PATH"):
            build_inventory(self.root)

    def test_rejects_duplicate_registry_ids_and_unmapped_registrations(self):
        catalog = self.root / "data_registry/catalog/data_sources_catalog.csv"
        csv_file(catalog, [{"registry_id": "DS-0002"}, {"registry_id": "DS-0002"}])
        with self.assertRaisesRegex(ValueError, "DUPLICATE_SOURCE"):
            build_inventory(self.root)
        csv_file(catalog, [{"registry_id": "DS-0002"}])
        with self.assertRaisesRegex(ValueError, "UNMAPPED_REGISTRATION"):
            build_inventory(self.root)


@unittest.skipUnless(os.environ.get("WISER_WATER_BUNDLE"), "real bundle is local and not redistributed")
class RealBundleTests(unittest.TestCase):
    def test_complete_20260908_case(self):
        report = build_inventory(Path(os.environ["WISER_WATER_BUNDLE"]))
        self.assertEqual(report["summary"]["fileCount"], 3162)
        self.assertEqual(report["summary"]["byteCount"], 351448119)
        self.assertEqual(report["summary"]["providerCount"], 338)
        self.assertEqual(report["summary"]["registeredCount"], 745)
        self.assertEqual(report["summary"]["catalogCount"], 1657)
        self.assertEqual(report["summary"]["verifiedPackageFileCount"], 3023)
        self.assertEqual(report["summary"]["verifiedDownloadFileCount"], 1773)
        self.assertEqual(len(report["sources"]), 1995)
        self.assertEqual(sum(x["path"].startswith("downloads/") for x in report["files"]), 133)
        self.assertFalse(any(x["completeness"] == "COMPLETE" for x in report["files"]))


if __name__ == "__main__":
    unittest.main()
