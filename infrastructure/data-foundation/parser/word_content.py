"""Extract inert Word text without evaluating macros, fields or external relationships."""

import re
import subprocess
import tempfile
import zipfile

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException
from parser import MAX_INPUT_BYTES, MAX_TEXT, ParseError, safe_archive

WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def word_segments(path):
    if zipfile.is_zipfile(path):
        with safe_archive(path) as archive:
            names = archive.namelist()
            if "word/document.xml" not in names:
                raise ParseError("INVALID_FORMAT")
            parts = ["word/document.xml"] + sorted(
                name
                for name in names
                if re.fullmatch(
                    r"word/(?:header\d+|footer\d+|footnotes|endnotes)\.xml", name
                )
            )
            for part in parts:
                if archive.getinfo(part).file_size > MAX_INPUT_BYTES:
                    raise ParseError("SIZE_LIMIT")
                try:
                    with archive.open(part) as source:
                        number = 0
                        for _, node in ElementTree.iterparse(
                            source,
                            events=("end",),
                            forbid_dtd=True,
                            forbid_entities=True,
                            forbid_external=True,
                        ):
                            if node.tag != WORD_NS + "p":
                                continue
                            number += 1
                            text = "".join(
                                (child.text or "")
                                if child.tag == WORD_NS + "t"
                                else "\t"
                                if child.tag == WORD_NS + "tab"
                                else "\n"
                                if child.tag in (WORD_NS + "br", WORD_NS + "cr")
                                else ""
                                for child in node.iter()
                            )
                            yield text, f"{part}#paragraph:{number}"
                            node.clear()
                except (DefusedXmlException, ElementTree.ParseError) as error:
                    raise ParseError("INVALID_CONTENT") from error
        return
    with path.open("rb") as source:
        if source.read(8) != bytes.fromhex("d0cf11e0a1b11ae1"):
            raise ParseError("INVALID_FORMAT")
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        try:
            result = subprocess.run(
                ["/usr/bin/antiword", "-m", "UTF-8.txt", "-w", "0", str(path)],
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=errors,
                timeout=30,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise ParseError("CAPACITY_LIMIT") from error
        if result.returncode:
            errors.seek(0)
            message = errors.read(4096).lower()
            raise ParseError(
                "ENCRYPTED_CONTENT"
                if b"encrypted" in message or b"password" in message
                else "INVALID_CONTENT"
            )
        output.seek(0)
        text = output.read(MAX_TEXT * 4 + 1).decode("utf-8", errors="strict")
        yield text, "document"
