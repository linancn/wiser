"""HTTP batch recovery and exact source-path reconciliation."""
import copy
import tempfile
import unittest
from pathlib import Path

from analyze_bundle import AnalysisRunner, reconcile_paths
from water_import import ImportFailure

REG = {"sourceId": "DS-0001", "kind": "CATALOG_ENTRY", "name": "Sample",
       "dataItemId": "10000000-0000-4000-8000-000000000001",
       "versionId": "20000000-0000-4000-8000-000000000001", "filePaths": 3, "assets": 2}
HASH = "a" * 64
FILES = [{"path": path, "assetId": "asset", "preparedSha256": HASH,
          "preparedSizeBytes": 12, "artifactClass": "TABLE", "completeness": "SAMPLE"}
         for path in ["a.csv", "alias.csv"]] + [{"path": "empty.csv", "preparedSizeBytes": 0,
         "preparedSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
         "artifactClass": "TABLE", "completeness": "EMPTY"}]
ASSETS = [{"assetId": "asset", "sourceHash": HASH, "paths": ["a.csv", "alias.csv"],
           "status": "READY", "reason": None, "recordCount": 3, "featureCount": 0},
          {"assetId": "manifest", "sourceHash": "b" * 64, "paths": [], "status": "MANIFEST",
           "reason": None, "recordCount": None, "featureCount": None}]


class FakeClient:
    def __init__(self):
        self.keys = []
        self.fail = True

    def command(self, path, body, key):
        self.keys.append(key)
        if self.fail:
            self.fail = False
            raise ImportFailure("TRANSPORT_UNAVAILABLE")
        return {"analysisId": "30000000-0000-4000-8000-000000000001",
                "operation": {"operationId": "40000000-0000-4000-8000-000000000001"}}

    def get(self, path):
        return {"status": "SUCCEEDED", "version": 3}


class AnalysisTests(unittest.TestCase):
    def test_aliases_and_empty_paths_are_counted_without_inventing_assets(self):
        result = reconcile_paths(REG, {"sourceId": REG["sourceId"], "files": FILES}, ASSETS)
        self.assertEqual(len(result), 3)
        self.assertEqual(result[-1]["status"], "EMPTY")
        self.assertIsNone(result[-1]["assetId"])

    def test_hash_mismatch_extra_path_and_missing_asset_fail(self):
        for mutation in ["hash", "path", "missing"]:
            assets = copy.deepcopy(ASSETS)
            if mutation == "hash":
                assets[0]["sourceHash"] = "c" * 64
            elif mutation == "path":
                assets[0]["paths"].append("unregistered.csv")
            else:
                assets.pop(0)
            with self.subTest(mutation=mutation), self.assertRaises(ImportFailure):
                reconcile_paths(REG, {"sourceId": REG["sourceId"], "files": FILES}, assets)

    def test_duplicate_paths_and_nonempty_unbacked_files_fail(self):
        for mutation in ["duplicate", "missing"]:
            files = copy.deepcopy(FILES)
            if mutation == "duplicate":
                files[-1]["path"] = "a.csv"
            else:
                files[-1]["preparedSizeBytes"] = 1
            with self.subTest(mutation=mutation), self.assertRaises(ImportFailure):
                reconcile_paths(REG, {"sourceId": REG["sourceId"], "files": files}, ASSETS)

    def test_lost_command_response_reuses_key_then_resume_does_not_submit(self):
        with tempfile.TemporaryDirectory() as directory:
            client = FakeClient()
            runner = AnalysisRunner(client, Path(directory), {"actor": "one"}, "run", poll_seconds=0)
            with self.assertRaisesRegex(ImportFailure, "TRANSPORT_UNAVAILABLE"):
                runner.analyze(REG)
            result = runner.analyze(REG)
            self.assertEqual(result["status"], "SUCCEEDED")
            self.assertEqual(client.keys[0], client.keys[1])
            self.assertEqual(runner.analyze(REG)["analysisId"], result["analysisId"])
            self.assertEqual(len(client.keys), 2)
            changed = AnalysisRunner(client, Path(directory), {"actor": "two"}, "run")
            with self.assertRaisesRegex(ImportFailure, "CHECKPOINT_SCOPE_MISMATCH"):
                changed.analyze(REG)

    def test_changed_version_cannot_reuse_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            client = FakeClient()
            client.fail = False
            runner = AnalysisRunner(client, Path(directory), {"actor": "one"}, "run", poll_seconds=0)
            runner.analyze(REG)
            with self.assertRaisesRegex(ImportFailure, "CHECKPOINT_SCOPE_MISMATCH"):
                runner.analyze({**REG, "versionId": "different"})
