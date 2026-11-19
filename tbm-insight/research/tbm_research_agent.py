"""Project data, literature and experimental tools for a Harness research session."""

import csv
from contextlib import contextmanager
from datetime import date
import hashlib
import io
import json
import logging
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import uuid
import zipfile

from tbm_dataset_profile import dataset_profile
from tbm_wasi_experiment import WasiExperimentSandbox


ROOT = Path(__file__).resolve().parent
TABLES = {".csv", ".tsv", ".txt"}
PLC_ZIP = re.compile(r"CREC188_(\d{8})\.zip$", re.I)
ROWS_PER_PART = 12_000


def project_folder(home, name):
    parent = home / name
    parent.mkdir(exist_ok=True)
    if parent.resolve() != parent:
        raise ValueError("项目产物目录不可用。")
    folder = parent / uuid.uuid4().hex
    folder.mkdir()
    return folder


def record_json(path, payload):
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")


def source_type(path):
    if path.name == "content" and path.parent.parent.name == "uploads":
        info = json.loads((path.parent / "metadata.json").read_text(encoding="utf-8"))
        return info["name"], info["kind"]
    return path.name, path.suffix.removeprefix(".").lower()


@contextmanager
def table_streams(path, kind):
    if kind != "zip":
        with path.open("rb") as stream:
            yield [(path.name, stream)]
        return
    with zipfile.ZipFile(path) as archive:
        members = [entry for entry in archive.infolist() if not entry.is_dir()
                   and PurePosixPath(entry.filename).suffix.lower() in TABLES]

        def open_members():
            for member in members:
                with archive.open(member) as stream:
                    yield member.filename, stream

        yield open_members()


def candidate_paths(path, start, end):
    if not path.is_dir():
        return [path]
    files = []
    for candidate in sorted(path.iterdir()):
        if candidate.name.startswith(".") or candidate.resolve() != candidate or not candidate.is_file():
            continue
        if candidate.suffix.lower() not in TABLES | {".zip"}:
            continue
        plc = PLC_ZIP.fullmatch(candidate.name)
        if plc:
            day = date.fromisoformat(plc.group(1))
            if (start and day < start) or (end and day > end):
                continue
        files.append(candidate)
    return files


def row_day(value):
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError:
        return None


def prepare(home, args):
    path = Path(args["path"])
    start = date.fromisoformat(args["startDate"]) if args.get("startDate") else None
    end = date.fromisoformat(args["endDate"]) if args.get("endDate") else None
    if start and end and start > end:
        raise ValueError("起止日期顺序有误。")
    folder = project_folder(home, "research-data")
    fields = None
    out = None
    row_count = skipped = outside = 0
    parts = []
    sources = []
    try:
        for file in candidate_paths(path, start, end):
            name, kind = source_type(file)
            if kind not in {"csv", "tsv", "txt", "zip"}:
                raise ValueError("此预处理操作适用于 CSV、TSV、PLC TXT 和包含这类数据的 ZIP。")
            profile = dataset_profile(file, kind)
            if not profile:
                raise ValueError(f"无法确认 {name} 的表头和数据行。请先查看该文件结构。")
            with file.open("rb") as raw:
                digest = hashlib.file_digest(raw, "sha256").hexdigest()
            source_rows = 0
            with table_streams(file, kind) as streams:
                for member, binary in streams:
                    with io.TextIOWrapper(binary, encoding=profile.get("encoding", "utf-8-sig"), newline="") as stream:
                        reader = csv.reader(stream, delimiter=profile.get("delimiter", "\t" if kind == "tsv" else ","))
                        headings = [name.strip() for name in next(reader, [])]
                        chainage = headings.index("桩号") if "桩号" in headings else None
                        requested = args.get("columns") or headings
                        if len(set(requested)) != len(requested) or any(headings.count(field) != 1 for field in requested):
                            raise ValueError(f"{name} 的字段缺失或重名。请核对字段后指定要保留的列。")
                        if fields is None:
                            fields = requested
                        if fields != requested:
                            raise ValueError("数据文件的表头不同。请指定可对齐的列，或按来源分别处理。")
                        if set(fields) & {"_source_file", "_source_member", "_source_line"}:
                            raise ValueError("输入字段与来源追溯列重名。请选择需要保留的业务字段。")
                        indices = [headings.index(column) for column in fields]
                        time_name = args.get("timeColumn") or ("运行时间" if "运行时间" in headings else None)
                        time_index = headings.index(time_name) if time_name in headings else None
                        if (start or end) and time_index is None and not PLC_ZIP.fullmatch(name):
                            raise ValueError(f"{name} 缺少可用的时间列，请核对时间列原名。")
                        for line, values in enumerate(reader, start=2):
                            if chainage is not None and len(values) == len(headings) + 1 and values[-1] == values[chainage] and values[-1]:
                                values = values[:-1]
                            if len(values) != len(headings):
                                skipped += 1
                                continue
                            if time_index is not None and (start or end):
                                observed = row_day(values[time_index])
                                if observed is None:
                                    skipped += 1
                                    continue
                                if (start and observed < start) or (end and observed > end):
                                    outside += 1
                                    continue
                            if row_count % ROWS_PER_PART == 0:
                                if out:
                                    out.close()
                                part = folder / f"part-{len(parts) + 1:05}.csv"
                                out = part.open("w", encoding="utf-8", newline="")
                                writer = csv.writer(out)
                                writer.writerow([*fields, "_source_file", "_source_member", "_source_line"])
                                parts.append(part.name)
                            writer.writerow([*[values[i] for i in indices], name, member, line])
                            row_count += 1
                            source_rows += 1
            sources.append({"path": str(file), "sha256": digest, "rows": source_rows})
    finally:
        if out:
            out.close()
    if not parts:
        raise ValueError("选定范围没有可用数据行。请检查文件、日期和字段。")
    manifest = {"source": "real", "rows": row_count, "invalid_rows": skipped, "outside_date_range": outside,
                "fields": fields, "parts": parts, "sources": sources, "selection": args}
    record_json(folder / "manifest.json", manifest)
    return {"directory": str(folder), "rows": row_count, "invalidRows": skipped, "files": len(sources), "parts": len(parts),
            "columns": fields, "manifest": str(folder / "manifest.json")}


def run_python(home, args):
    figure_language = args.get("figure_language", "auto")
    if figure_language not in ("auto", "zh", "en"):
        raise ValueError("科研绘图语言无效。")
    sys.path.insert(0, str(ROOT / "vendor" / "AutoResearchClaw"))
    job = project_folder(home, "research-experiments")
    inputs = job / "inputs"
    inputs.mkdir()
    output = job / "artifacts"
    workspace = output / "sandbox"
    workspace.mkdir(parents=True)
    code = args["code"]
    (job / "main.py").write_text(code, encoding="utf-8")
    inventory = []
    for raw in args.get("inputs", []):
        source = Path(raw)
        files = [source]
        if source.is_dir():
            manifest = source / "manifest.json"
            if source.parent != home / "research-data" or not manifest.is_file():
                raise ValueError("请先预处理原始目录，或者直接指定要运行的文件。")
            parts = json.loads(manifest.read_text(encoding="utf-8"))["parts"]
            files = [source / part for part in parts]
        for file in files:
            if file.resolve() != file or not file.is_file() or (source.is_dir() and file.parent != source):
                raise ValueError("输入文件不存在或已发生变化。")
            name, kind = source_type(file)
            profile = dataset_profile(file, kind)
            if not profile:
                raise ValueError(f"无法核对 {name} 的数据结构。可先盘点并预处理。")
            alias = name if len(args.get("inputs", [])) == 1 else f"{len(inventory) + 1}-{name}"
            target = inputs / alias
            if target.parent != inputs or target.exists():
                raise ValueError("发现同名输入，请先整理或分别运行。")
            shutil.copyfile(file, target)
            with target.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            inventory.append({"name": name, "size": target.stat().st_size, "dataset_profile": profile,
                              "source": str(file), "sha256": digest, "experiment_path": f"/data/{alias}"})
    experimental = args["purpose"] == "experiment"
    if experimental and not inventory:
        raise ValueError("实测试验需要提供实际输入。可先盘点或预处理用户给出的工程数据。")
    record_json(output / "research-materials.json", {"materials": inventory})
    sandbox = WasiExperimentSandbox(output, workspace, require_evidence=experimental, figure_language=figure_language)
    result = sandbox.run(code, timeout_sec=600)
    produced = workspace / "_project"
    report = {"status": "succeeded" if result.returncode == 0 and not result.timed_out else "failed",
              "elapsedSeconds": result.elapsed_sec, "stdout": result.stdout[-18_000:], "stderr": result.stderr[-6000:],
              "metrics": result.metrics, "inputs": inventory, "figureLanguage": figure_language,
              "files": [str(file) for file in sorted(produced.rglob("*")) if file.is_file()],
              "code": str(job / "main.py"), "directory": str(job)}
    record_json(job / "run.json", report)
    return {**report, "inputs": [item["experiment_path"] for item in inventory], "report": str(job / "run.json")}


def search(home, args):
    sys.path.insert(0, str(ROOT / "vendor" / "AutoResearchClaw"))
    from researchclaw.literature import cache
    from researchclaw.literature.search import search_papers

    cache._DEFAULT_CACHE_DIR = home / ".literature-cache"
    papers = search_papers(args["query"], limit=8)
    results = [{"title": paper.title, "year": paper.year, "doi": paper.doi, "url": paper.url, "source": paper.source,
                "authors": [author.name for author in paper.authors], "abstract": paper.abstract[:1600]}
               for paper in papers[:24]]
    folder = project_folder(home, "literature")
    record_json(folder / "results.json", {"query": args["query"], "results": results})
    return {"results": results, "path": str(folder / "results.json")}


def verify_citations(home, args):
    sys.path.insert(0, str(ROOT / "vendor" / "AutoResearchClaw"))
    from researchclaw.literature import verify

    verify._CACHE_DIR = home / ".citation-cache"
    report = verify.verify_citations(args["bibtex"]).to_dict()
    if not report["summary"]["total"]:
        raise ValueError("未识别到 BibTeX 条目。请提供带题名的有效参考文献记录。")
    folder = project_folder(home, "literature")
    target = folder / "citation-verification.json"
    record_json(target, report)
    return {"summary": report["summary"], "results": report["results"][:40], "path": str(target)}


def inspect(_home, args):
    path = Path(args["path"])
    name, kind = source_type(path)
    return {"path": str(path), "name": name, "format": kind, "bytes": path.stat().st_size,
            "profile": dataset_profile(path, kind)}


def main():
    operations = {"inspect": inspect, "prepare": prepare, "run": run_python, "search": search, "verify": verify_citations}
    logging.disable(logging.CRITICAL)
    try:
        result = operations[sys.argv[1]](Path(sys.argv[2]), json.load(sys.stdin))
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    except (OSError, RuntimeError, ValueError, zipfile.BadZipFile, csv.Error) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
