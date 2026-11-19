"""Acceptance anchors, case fidelity and incremental source-version checks."""
from hashlib import sha256
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile

from tbm_evidence import ROOT, build, config_at, search_and_save


def main():
    settings = config_at(ROOT / "models.json")
    source_cases = json.loads((ROOT / "sources/cases/tbm_kg_data.json").read_text(encoding="utf-8-sig"))
    tests = json.loads((ROOT / "acceptance.json").read_text(encoding="utf-8"))
    for test in tests:
        result = search_and_save(ROOT, test["query"], settings)
        if "route" in test:
            assert result["status"] == "not_needed" and result["route"] == test["route"], result
        if "status" in test:
            assert result["status"] == test["status"], result
        if "number" in test:
            hits = [item for item in result["standards"] if item["metadata"]["number"] == test["number"]]
            assert hits, (test, [(item["metadata"]["number"], item["citation"]["locator"]) for item in result["standards"]])
            for clause, line in zip(test.get("clauses", []), test.get("lines", [])):
                item = next(item for item in hits if item["citation"]["locator"] == clause)
                assert item["citation"]["start_line"] == line, item
            if test.get("expect_region_mismatch"):
                assert any("地域不同" in difference for item in hits for difference in item["differences"])
                assert any("工程领域不同" in difference for item in hits for difference in item["differences"])
        for item in result["standards"]:
            citation = item["citation"]
            snapshot = Path(citation["path"])
            assert sha256(snapshot.read_bytes()).hexdigest() == citation["version_hash"]
            lines = snapshot.read_text(encoding="utf-8-sig").splitlines()
            assert "\n".join(lines[citation["start_line"] - 1:citation["end_line"]]).rstrip() == item["text"]
        if test.get("expect_cases"):
            assert result["cases"]
            for item in result["cases"]:
                data = item["metadata"]
                assert data["event"] == source_cases[data["project_index"]]["construction_events"][data["event_index"]]
                assert data["original_publication"] is None
                assert "jamming" in item["matched_concepts"]
        print(test["category"], result["status"], test["query"], flush=True)

    again = build(ROOT, settings)
    assert again["unchanged"] == again["documents"] == 65, again
    with tempfile.TemporaryDirectory(prefix="tbm-evidence-version-") as temp:
        root = Path(temp)
        (root / "sources/standards_ocr").mkdir(parents=True)
        source = next((ROOT / "sources/standards_ocr").glob("GB_T 41051*"))
        target = root / "sources/standards_ocr" / source.name
        shutil.copyfile(source, target)
        (root / "sources/source_manifest.json").write_text(json.dumps({"files": [
            {"path": target.relative_to(root / "sources").as_posix(), "sha256": sha256(target.read_bytes()).hexdigest()}
        ]}), encoding="utf-8")
        assert build(root, settings)["indexed"] == 1
        db = sqlite3.connect(root / "index/evidence.sqlite")
        old_path, old_hash = db.execute("SELECT snapshot,hash FROM documents WHERE active=1").fetchone()
        db.close()
        with target.open("a", encoding="utf-8") as stream:
            stream.write("\n\n增量验收附记\n")
        assert build(root, settings)["indexed"] == 1
        assert sha256(Path(old_path).read_bytes()).hexdigest() == old_hash
        db = sqlite3.connect(root / "index/evidence.sqlite")
        assert db.execute("SELECT sum(active),count(*) FROM documents").fetchone() == (1, 2)
        db.close()
    request = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
        "name": "search_tbm_evidence", "arguments": {"query": tests[0]["query"], "limit": 3}}}
    completed = subprocess.run([sys.executable, "-B", str(Path(__file__).with_name("tbm_evidence_server.py"))],
                               input=json.dumps(request) + "\n", text=True, capture_output=True, check=True)
    reply = json.loads(completed.stdout)["result"]
    assert not reply["isError"] and not completed.stderr
    assert "5.2.1.4" in reply["content"][0]["text"]
    print("Incremental rebuild, immutable historical citations and standalone MCP passed.")


if __name__ == "__main__":
    main()
