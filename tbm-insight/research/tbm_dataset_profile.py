"""Sample the structure of submitted datasets without modifying source files."""

import csv
import io
import json
from pathlib import PurePosixPath
import xml.etree.ElementTree as ET
import zipfile


SAMPLE_BYTES = 128 * 1024
SAMPLE_ROWS = 48
TABLE_SUFFIXES = {".csv", ".tsv", ".txt"}


def table_profile(sample, delimiter=None):
    if len(sample) == SAMPLE_BYTES:
        sample = sample[:sample.rfind(b"\n") + 1]
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            text = sample.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        return None
    if "\n" not in text:
        return None
    first_line = text.splitlines()[0]
    delimiter = delimiter or max(("\t", ",", ";"), key=first_line.count)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    headings = next(reader, [])
    if len(headings) < 2 or not any(cell.strip() for cell in headings):
        return None
    rows = []
    repeated_chainage = 0
    same_chainage = headings.index("桩号") if "桩号" in headings and delimiter == "\t" else None
    for row in reader:
        if same_chainage is not None and len(row) == len(headings) + 1 and row[-1] == row[same_chainage] and row[-1]:
            row = row[:-1]
            repeated_chainage += 1
        if len(row) == len(headings) and any(cell.strip() for cell in row):
            rows.append(row)
        if len(rows) >= SAMPLE_ROWS:
            break
    if not rows:
        return None
    result = {"columns": [cell.strip()[:160] for cell in headings[:256]],
            "column_count": len(headings), "sampled_rows": len(rows), "encoding": encoding,
            "delimiter": delimiter, "sampled_missing_fields": sum(
                any(not row[i].strip() for row in rows) for i in range(len(headings)))}
    if repeated_chainage:
        result["trailing_chainage"] = f"{repeated_chainage} sampled rows repeat 桩号 in an unnamed trailing value"
    if "运行时间" in headings:
        index = headings.index("运行时间")
        result["sampled_runtime"] = [rows[0][index][:40], rows[-1][index][:40]]
    return result


def xml_sample(archive, name, tag):
    with archive.open(name) as file:
        parser = ET.XMLPullParser(events=("end",))
        parser.feed(file.read(SAMPLE_BYTES))
        return [node for _, node in parser.read_events() if node.tag.rsplit("}", 1)[-1] == tag]


def excel_profile(archive):
    names = archive.namelist()
    sheets = [name for name in names if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")]
    shared = []
    if "xl/sharedStrings.xml" in names:
        shared = ["".join(part.text or "" for part in node.iter() if part.tag.endswith("}t"))
                  for node in xml_sample(archive, "xl/sharedStrings.xml", "si")]
    profiles = []
    for name in sheets[:4]:
        rows = xml_sample(archive, name, "row")[:SAMPLE_ROWS + 1]
        if len(rows) < 2:
            continue
        headings = []
        for cell in rows[0]:
            value = next((node.text or "" for node in cell.iter() if node.tag.rsplit("}", 1)[-1] in {"v", "t"}), "")
            if cell.get("t") == "s" and value.isdecimal():
                index = int(value)
                value = shared[index] if index < len(shared) else ""
            headings.append(value[:160])
        if headings:
            profiles.append({"sheet_file": PurePosixPath(name).name, "columns": headings[:160],
                             "column_count": len(headings), "sampled_rows": len(rows) - 1})
    return {"sheet_count": len(sheets), "sampled_sheets": profiles} if profiles else None


def dataset_profile(path, kind):
    try:
        if f".{kind}" in TABLE_SUFFIXES:
            with path.open("rb") as file:
                return table_profile(file.read(SAMPLE_BYTES), "\t" if kind == "tsv" else None)
        if kind in {"zip", "xlsx"}:
            with zipfile.ZipFile(path) as archive:
                if kind == "xlsx":
                    return excel_profile(archive)
                members = [m for m in archive.infolist() if not m.is_dir()
                           and PurePosixPath(m.filename).suffix.lower() in TABLE_SUFFIXES]
                for member in members[:4]:
                    with archive.open(member) as file:
                        profile = table_profile(file.read(SAMPLE_BYTES))
                    if profile:
                        return {**profile, "sampled_archive_member": PurePosixPath(member.filename).name[:240],
                                "candidate_table_count": len(members)}
        if kind == "json" and path.stat().st_size <= 2 * 1024 * 1024:
            records = json.loads(path.read_text(encoding="utf-8-sig"))
            if isinstance(records, list) and records and isinstance(records[0], dict) and records[0]:
                return {"columns": [str(key)[:160] for key in list(records[0])[:160]],
                        "column_count": len(records[0]), "record_count": len(records)}
        if kind == "parquet" and path.stat().st_size > 12:
            with path.open("rb") as file:
                header = file.read(4)
                file.seek(-4, io.SEEK_END)
                if header == file.read(4) == b"PAR1":
                    return {"schema_status": "格式标记有效，字段尚未读取，请提供字段字典或转为 CSV。"}
    except (ValueError, OSError, RuntimeError, EOFError, zipfile.BadZipFile, csv.Error, ET.ParseError):
        return None
    return None
