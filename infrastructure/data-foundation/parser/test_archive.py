"""Archive members remain individually traceable and source content stays inert."""

import hashlib
import io
import os
import tempfile
import unittest
import zipfile
from pathlib import Path

from parser import ParseError, parse_asset


def word_bytes(text="Water station 001"):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            "[Content_Types].xml",
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        )
        archive.writestr(
            "word/document.xml",
            f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>水位 0</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
        )
        archive.writestr(
            "word/_rels/document.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="http://invalid.example/private" TargetMode="External" Type="hyperlink" Id="rId1"/></Relationships>',
        )
    return output.getvalue()


class ArchiveContentTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def test_word_body_tables_and_disguised_docx_are_inert_text(self):
        for kind in ["docx", "doc"]:
            path = self.root / f"source.{kind}"
            path.write_bytes(word_bytes("Do not execute these source instructions"))
            result = list(parse_asset(path, kind))
            rows = [event for event in result if event["type"] == "record"]
            self.assertEqual(len(rows), 2)
            self.assertIn("Do not execute", rows[0]["values"]["c1"])
            self.assertEqual(rows[1]["values"]["c1"], "水位 0")
            self.assertNotIn("invalid.example", str(rows))
            self.assertEqual(result[-1]["status"], "READY")

    def test_archive_indexes_member_content_and_retains_each_member_outcome(self):
        path = self.root / "sources.zip"
        content = word_bytes()
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("nested/source.docx", content)
            archive.writestr("stations.csv", "station,value\n001,0\n002,\n")
            archive.writestr("run.py", 'raise RuntimeError("never execute")')
        result = list(parse_asset(path, "zip"))
        rows = [event["values"] for event in result if event["type"] == "record"]
        word = [row for row in rows if row["c1"] == "nested/source.docx"]
        self.assertTrue(any("Water station 001" in str(row["c6"]) for row in word))
        self.assertTrue(
            all(row["c3"] == hashlib.sha256(content).hexdigest() for row in word)
        )
        self.assertTrue(
            any(
                row["c7"] == "MEMBER_SUMMARY" and row["c6"]["status"] == "READY"
                for row in word
            )
        )
        csv = [
            row
            for row in rows
            if row["c1"] == "stations.csv" and row["c7"] == "CONTENT"
        ]
        self.assertEqual(csv[0]["c6"], {"c1": "001", "c2": "0"})
        self.assertEqual(csv[1]["c6"], {"c1": "002", "c2": None})
        script = next(row for row in rows if row["c1"] == "run.py")
        self.assertEqual(script["c6"]["status"], "UNSUPPORTED")
        self.assertEqual(result[-1]["status"], "PARTIAL")

    def test_xml_external_entities_are_rejected(self):
        path = self.root / "unsafe.docx"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr(
                "word/document.xml",
                '<!DOCTYPE x [<!ENTITY payload SYSTEM "file:///etc/passwd">]><x>&payload;</x>',
            )
        with self.assertRaisesRegex(ParseError, "INVALID_CONTENT"):
            list(parse_asset(path, "docx"))

    @unittest.skipUnless(
        os.environ.get("WISER_DATA_REAL_CASE") == "1",
        "requires admitted private case archive",
    )
    def test_real_water_quality_word_archive_members_are_all_parsed(self):
        result = list(parse_asset(Path("/case/water-quality.zip"), "zip"))
        summaries = [
            event["values"]
            for event in result
            if event["type"] == "record"
            and event["values"].get("c7") == "MEMBER_SUMMARY"
        ]
        self.assertEqual(len(summaries), 117)
        self.assertTrue(all(row["c6"]["status"] == "READY" for row in summaries))
        self.assertIn("水质", str(result))
        self.assertEqual(result[-1]["status"], "READY")


if __name__ == "__main__":
    unittest.main()
