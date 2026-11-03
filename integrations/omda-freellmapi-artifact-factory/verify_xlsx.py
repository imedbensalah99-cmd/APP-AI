"""Independent standard-library verification for a generated OMDA XLSX and manifest.
No external provider, package manager, network, or commercial office software used.
"""
from pathlib import Path
from zipfile import ZipFile, BadZipFile
import xml.etree.ElementTree as ET
import hashlib
import json

ROOT = Path(__file__).parent / "generated"
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
assert manifest["paidApiCalls"] == 0 and manifest["externalActions"] == []
assert manifest["publishing"] is False
xlsx = [item for item in manifest["files"] if item["path"].endswith(".xlsx")]
assert len(xlsx) == 1, "Expected one genuine XLSX from default multi-intent request"
for item in manifest["files"]:
    path = ROOT / item["path"]
    data = path.read_bytes()
    assert len(data) == item["bytes"] and item["bytes"] > 0
    assert hashlib.sha256(data).hexdigest() == item["sha256"]
data = (ROOT / xlsx[0]["path"]).read_bytes()
assert data[:4] == b"PK\x03\x04"
assert xlsx[0]["mime"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
required = {
    "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels", "xl/styles.xml",
    "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
}
with ZipFile(ROOT / xlsx[0]["path"]) as z:
    names = z.namelist()
    assert set(names) == required
    assert len(names) == len(set(names))
    assert all(not n.startswith("/") and ".." not in n.split("/") for n in names)
    assert z.testzip() is None
    parsed = {name: ET.fromstring(z.read(name)) for name in names if name.endswith(".xml") or name.endswith(".rels")}
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    sheets = parsed["xl/workbook.xml"].findall("m:sheets/m:sheet", ns)
    assert [s.attrib["name"] for s in sheets] == ["Data", "Summary"]
    data_sheet = parsed["xl/worksheets/sheet1.xml"]
    assert data_sheet.find("m:sheetViews/m:sheetView/m:pane",ns) is not None
    assert data_sheet.find("m:autoFilter",ns) is not None
    rows = data_sheet.findall("m:sheetData/m:row",ns)
    assert len(rows) >= 2
    assert not data_sheet.findall(".//m:f",ns), "User data must never be executable formulas"
    summary = parsed["xl/worksheets/sheet2.xml"]
    formula = summary.find(".//m:f",ns)
    assert formula is not None and formula.text.startswith("COUNTA(")
    assert parsed["xl/styles.xml"].find("m:cellXfs",ns) is not None
print("OMDA_XLSX_INDEPENDENT_ZIP_XML_MANIFEST_PASS")

# EML is independently inspected through Python's MIME parser; never sent.
from email import policy
from email.parser import BytesParser
eml_files = [item for item in manifest["files"] if item["path"].endswith(".eml")]
assert len(eml_files) == 1
email_bytes = (ROOT / eml_files[0]["path"]).read_bytes()
msg = BytesParser(policy=policy.default).parsebytes(email_bytes)
assert not msg.defects
assert msg["X-OMDA-Draft"] == "true"
assert msg["MIME-Version"] == "1.0"
assert msg.get_content_type() == "text/plain"
assert msg.get_content_charset().lower() == "utf-8"
assert msg["To"] is None
assert "Build website" in msg.get_content()
print("OMDA_EML_INDEPENDENT_MIME_PARSER_PASS")
