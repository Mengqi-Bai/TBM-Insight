"""Serve the TBM Insight panel data contract as one JSON request and response."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta
from hashlib import sha256
import json
from math import fsum
from pathlib import Path
import re
import sqlite3
import sys
from tempfile import NamedTemporaryFile
from time import time as unix_time
from zipfile import BadZipFile, ZipFile
import zlib

sys.dont_write_bytecode = True

import tbm_cutter_changes as cutters
import tbm_conditions_index as conditions_index
import tbm_daily_summary as daily
import tbm_evidence as evidence
import tbm_figure as figure
import tbm_insight as plc
import tbm_limits as limits
import tbm_panel_simulation as simulation


HISTORICAL_DAY = date(2016, 7, 24)
ARCHIVE_PATTERN = re.compile(rf"{plc.DEVICE}_([0-9]{{8}})\.zip")
ARCHIVE_INDEX_VERSION = f"plc-archive-index-v2:{plc.HEADER_SHA256}"
USER_CONFIRMED_MANIFEST = "58977b2a7449c26800c149c7afba81ed44a0c6215b66201adcd56ff1d8b9c561"
ACTIVITY_FIELDS = conditions_index.ACTIVITY_FIELDS
EVIDENCE_FILTERS = ("standard", "clause", "region", "machine", "domain", "stage", "geology", "as_of")
PANEL_FIELDS = {
    "progress": {"date", "detail", "prepare"},
    "conditions": {"date", "start_time", "end_time", "metrics", "limit_metrics"},
    "cutters": {"date", "start_date", "end_date", "positions", "reasons"},
    "evidence": {"query", "evidence_mode", "limit", *EVIDENCE_FILTERS},
}


def archive_name(day):
    return f"{plc.DEVICE}_{day:%Y%m%d}.zip"


def panel_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError("日期须为 YYYY-MM-DD")
    return date.fromisoformat(value)


def readable_archive(path, day):
    """Check the ZIP member, header and first record without expanding the day."""
    member = f"{plc.DEVICE}_{day:%Y%m%d}.txt"
    try:
        with ZipFile(path) as archive:
            if archive.namelist().count(member) != 1:
                return False
            with archive.open(member) as source:
                header = source.readline(32768).decode("utf-8-sig").rstrip("\r\n")
                if sha256(header.encode("utf-8")).hexdigest() != plc.HEADER_SHA256:
                    return False
                while line := source.readline(32768):
                    values = line.rstrip(b"\r\n").split(b"\t")
                    if len(values) != plc.RECORD_COLUMNS or not values[2].strip() or values[-1] != values[2]:
                        return False
                    stamp = plc.parse_time(values[1].decode("utf-8"))
                    if stamp.date() == day:
                        return True
    except (OSError, BadZipFile, EOFError, KeyError, RuntimeError, ValueError, zlib.error):
        return False
    return False


def archive_index(paths):
    key = sha256(str(paths.data_dir).encode("utf-8")).hexdigest()[:24]
    target = paths.output_dir / ".cache" / "metadata" / f"plc-dates-{key}.json"
    known = {}
    try:
        previous = json.loads(target.read_text(encoding="utf-8"))
        if previous.get("version") == ARCHIVE_INDEX_VERSION and isinstance(previous.get("entries"), dict):
            known = previous["entries"]
    except (OSError, ValueError, AttributeError, KeyError):
        pass
    current = {}
    pending = []
    for path in paths.data_dir.iterdir():
        match = ARCHIVE_PATTERN.fullmatch(path.name)
        if match is None or not path.is_file():
            continue
        try:
            day = datetime.strptime(match[1], "%Y%m%d").date()
        except ValueError:
            continue
        identity = file_identity(path)
        item = known.get(path.name)
        if (isinstance(item, dict) and item.get("identity") == identity
                and item.get("date") == day.isoformat() and isinstance(item.get("readable"), bool)):
            current[path.name] = item
        else:
            pending.append((path, day, identity))

    def validate(entry):
        path, day, identity = entry
        valid = readable_archive(path, day)
        return path.name, {"identity": identity, "date": day.isoformat(), "readable": valid} if identity == file_identity(path) else None

    if pending:
        with ThreadPoolExecutor(max_workers=min(8, len(pending))) as workers:
            current.update((name, item) for name, item in workers.map(validate, pending) if item is not None)
    if current != known:
        write_cache(target, {"version": ARCHIVE_INDEX_VERSION, "entries": current})
    return sorted(item["date"] for item in current.values() if item["readable"])


def panel_options(panel, mode, paths):
    dates, regions = [], []
    documents = []
    preferred = HISTORICAL_DAY.isoformat()
    if panel == "evidence":
        index = paths.knowledge_root / "index" / "evidence.sqlite"
        if index.is_file():
            with sqlite3.connect(index.as_uri() + "?mode=ro", uri=True) as catalog:
                metadata = [json.loads(row[0]) for row in catalog.execute("SELECT metadata FROM documents WHERE active=1")]
            regions = sorted({item["region"] for item in metadata if item.get("region")})
        documents = [{key: item[key] for key in ("id", "number", "title", "category", "type", "region")}
                     for item in evidence.pdf_catalog(paths.knowledge_root)]
    elif mode == "simulation":
        dates = [(simulation.WEEK_START + timedelta(days=offset)).isoformat() for offset in range(7)]
        preferred = simulation.DEFAULT_DAY.isoformat()
    elif panel == "cutters":
        def compute():
            records, _, _, _ = cutters.prepare(paths.cutter_source)
            return {"status": "ok", "dates": sorted({item["date"] for item in records if item.get("date")})}

        dates = cached_result(paths.output_dir / ".cache" / "metadata", [paths.cutter_source],
                              "cutter-ledger-dates-v1", (cutters,), compute)["dates"]
    else:
        dates = archive_index(paths)
    default = preferred if preferred in dates else dates[-1] if dates else None
    return {"status": "ok", "dates": dates, "default_date": default, "regions": regions, "documents": documents}


def file_identity(path):
    try:
        stat = path.stat()
    except FileNotFoundError:
        return [str(path), None]
    return [str(path), stat.st_size, stat.st_mtime_ns, stat.st_ino]


def cache_target(cache_dir, inputs, options, modules):
    identity = sha256(json.dumps([inputs, options], ensure_ascii=True, sort_keys=True).encode("utf-8"))
    for module in modules:
        identity.update(Path(module.__file__).read_bytes())
    return cache_dir / f"{identity.hexdigest()}.json"


def cached_value(target):
    try:
        result = json.loads(target.read_text(encoding="utf-8"))
        if isinstance(result, dict) and "status" in result:
            return result
    except (OSError, ValueError):
        pass
    return None


def cached_result(cache_dir, source_paths, options, modules, compute):
    inputs = [file_identity(path) for path in source_paths]
    target = cache_target(cache_dir, inputs, options, modules)
    result = cached_value(target)
    if result is not None:
        return result
    result = compute()
    if "error" in result or inputs != [file_identity(path) for path in source_paths]:
        return result
    write_cache(target, result)
    return result


def write_cache(target, result):
    temporary = None
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(result, stream, ensure_ascii=False, allow_nan=False)
        temporary.replace(target)
    except OSError:
        # A busy or unwritable cache does not affect the computed engineering result.
        pass
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def progress_cache_paths(day, paths):
    sources = [paths.data_dir / archive_name(source_day) for source_day in (day - timedelta(days=1), day)]
    inputs = [file_identity(path) for path in sources]
    cache_dir = paths.output_dir / ".cache"
    detail = cache_target(cache_dir / "progress", inputs, ["progress-v2", day.isoformat()], (daily, plc))
    summary = cache_dir / "progress-summary-v1" / detail.name
    return sources, inputs, detail, summary


def progress_summary(result):
    excavation = result.get("progress", {}).get("excavation", {})
    downtime = result.get("downtime", {})
    return {"status": result["status"], "date": result.get("date"), "cutoff": result.get("cutoff"),
            "distribution": result.get("distribution"), "evidence": result.get("evidence"),
            "progress": {"excavation": {key: excavation.get(key) for key in ("value", "farthest")}},
            "downtime": {key: downtime.get(key) for key in ("seconds", "classified_seconds")},
            "data_quality": [{"code": item["code"]} for item in result.get("data_quality", [])],
            "error": result.get("error")}


def daily_for_panel(day, paths, previous=None):
    """Compute one day's detail and compact summary with the same source identity."""
    sources, inputs, detail, summary = progress_cache_paths(day, paths)
    saved = cached_value(detail)
    if saved is not None:
        if cached_value(summary) is None:
            write_cache(summary, progress_summary(saved))
        return saved
    if previous is None and day > date.min:
        _, _, _, previous_summary = progress_cache_paths(day - timedelta(days=1), paths)
        previous = cached_value(previous_summary)
    frontier = previous and previous.get("progress", {}).get("excavation", {}).get("farthest")
    if frontier is not None:
        frontier = {**frontier, **{key: previous["evidence"][key] for key in ("zip", "txt")}}
    result, code = daily.run_daily(paths.data_dir, plc.DEVICE, day.isoformat(), previous_frontier=frontier,
                                 include_distribution=True)
    if inputs == [file_identity(path) for path in sources]:
        compact = progress_summary(result)
        if code == 0:
            write_cache(detail, result)
        else:
            compact["retry_at"] = unix_time() + 60
        write_cache(summary, compact)
    return result


def prepared_progress_day(day, paths, previous=None, *, prepare=False):
    sources, inputs, detail, summary = progress_cache_paths(day, paths)
    saved = cached_value(summary)
    if saved is not None and saved.get("retry_at", float("inf")) > unix_time():
        return saved
    saved_detail = cached_value(detail)
    if saved_detail is not None:
        compact = progress_summary(saved_detail)
        if inputs == [file_identity(path) for path in sources]:
            write_cache(summary, compact)
        return compact
    if inputs[-1][1] is None:
        return {"status": "archive_missing", "date": day.isoformat(),
                "error": {"code": "archive_missing", "message": f"{day.isoformat()} 无 PLC 日归档。"}}
    if prepare:
        return progress_summary(daily_for_panel(day, paths, previous))
    return {"status": "index_pending", "date": day.isoformat()}


def indexed_week(day, paths, prepare):
    result = week_progress(day, lambda selected, previous: prepared_progress_day(selected, paths, previous, prepare=prepare),
                           select_day=False)
    pending = [item["date"] for item in result["days"] if item["status"] == "index_pending"]
    total = sum(item["status"] != "archive_missing" for item in result["days"])
    result["index"] = {"pending_dates": pending, "prepared_days": total - len(pending),
                       "total_archive_days": total, "retry_after_ms": 3000 if pending else None}
    if pending:
        result["status"] = "index_pending"
    return result


def week_progress(day, daily_result, unit=None, *, select_day=True):
    monday = day - timedelta(days=day.weekday())
    days = []
    selected = None
    previous = None
    cumulative = {key: None for key in ("advance", "running_seconds", "downtime_seconds")}
    for offset in range(7):
        day_in_week = monday + timedelta(days=offset)
        result = daily_result(day_in_week, previous)
        previous = result
        advance = result.get("progress", {}).get("excavation", {}).get("value")
        downtime = result.get("downtime", {})
        distribution = result.get("distribution")
        running = distribution["running_seconds"] if distribution else None
        days.append({"date": day_in_week.isoformat(), "status": result["status"], "advance": advance,
                     "downtime_seconds": downtime.get("seconds"), "classified_seconds": downtime.get("classified_seconds"),
                     "running_seconds": running, "distribution": distribution,
                     "cutoff": result.get("cutoff"), "evidence": result.get("evidence"), "data_quality": [item["code"] for item in result.get("data_quality", [])],
                     "error": result.get("error")})
        for key, total in cumulative.items():
            value = days[-1][key]
            if value is not None:
                cumulative[key] = (total or 0) + value
            days[-1][f"cumulative_{key}"] = cumulative[key]
        if "planned_advance" in result:
            days[-1].update(planned_advance=result["planned_advance"], completion_ratio=result["completion_ratio"])
        if select_day and day_in_week == day:
            selected = result
    advances = [item["advance"] for item in days if item["advance"] is not None]
    stops = [item["downtime_seconds"] for item in days if item["downtime_seconds"] is not None]
    observed = sum(item["status"] == "ok" for item in days)
    totals = {"advance": fsum(advances) if advances else None, "unit": unit,
              "downtime_seconds": sum(stops) if stops else None, "observed_days": observed,
              "running_seconds": cumulative["running_seconds"],
              "advance_days": len(advances), "downtime_days": len(stops)}
    distributions = [item["distribution"] for item in days if item["distribution"] is not None]
    duration_fields = ("denominator_seconds", "excavating_seconds", "stopped_seconds", "other_seconds",
                       "undetermined_seconds", "running_seconds")
    totals["distribution"] = daily.distribution_summary(*[
        sum(item[key] for item in distributions) for key in duration_fields
    ]) if distributions else None
    plans = [item["planned_advance"] for item in days if item.get("planned_advance") is not None]
    if plans:
        totals["planned_advance"] = fsum(plans)
        totals["completion_ratio"] = totals["advance"] / totals["planned_advance"] if len(plans) == len(advances) else None
    return {
        "status": "ok" if observed == 7 else "partial" if observed else "no_records",
        "window": {"start": monday.isoformat(), "end": (monday + timedelta(days=7)).isoformat(), "bounds": "[start,end)"},
        "totals": totals,
        "days": days, "selected_day": selected,
    }


def selected_names(request, key, default=None):
    values = request.get(key, default)
    if key in request and (not isinstance(values, list) or not values or len(values) > 12
                           or any(not isinstance(value, str) or not value.strip() for value in values)):
        raise ValueError(f"{key} 须包含 1 至 12 个有效名称")
    return values


def window_for_conditions(day, mode, request):
    default_start, default_end = ("08:00", "10:00") if mode == "simulation" else ("00:00", "24:00")
    if ("start_time" in request) != ("end_time" in request):
        raise ValueError("须同时指定现场开始和结束时刻")
    start_text = request.get("start_time", default_start)
    end_text = request.get("end_time", default_end)
    midnight = datetime.combine(day, time.min)
    start = limits.clock_time(midnight, start_text)
    end = limits.clock_time(midnight, end_text, is_end=True)
    if start >= end:
        raise ValueError("开始时刻须早于结束时刻")
    return start, end, start_text, end_text


def sampled_series(records, metrics, start, end, *, stepped_columns=()):
    """Retain per-bucket extrema and gaps for interactive rendering."""
    seconds = (end - start) // plc.SECOND
    width = max(1, (seconds + 299) // 300)
    rows = list(figure.gap_rows(((stamp, values) for stamp, _, _, values in daily.samples_by_second(records)),
                                plc.SECOND))
    series = []
    for index, (key, name, column) in enumerate(metrics):
        trace = ((stamp, values[index]) for stamp, values in rows)
        points = (figure.step_changes(trace) if column in stepped_columns
                  else figure.bucket_extrema(trace, width, start, plc.SECOND))
        series.append({**figure.metric(key, name), "field": name, "column": column,
                       "points": [[stamp.isoformat(), value] for stamp, value in points]})
    return series, {"method": "bucket_extrema_and_gaps", "bucket_seconds": width, "max_buckets": 300}


def sampled_limits(records, metrics, names, start, end):
    stepped_columns = {column for index, (_, _, column) in enumerate(metrics) if index % 3}
    series, sampling = sampled_series(records, metrics, start, end, stepped_columns=stepped_columns)
    plots = []
    for index, _ in enumerate(names):
        measure, warning, alarm = series[index * 3:index * 3 + 3]
        settings = [{"level": level, "label": entry["field"], "column": entry["column"], "points": entry["points"]}
                    for level, entry in (("warning", warning), ("alarm", alarm))]
        plots.append({**measure, "settings": settings})
    return plots, sampling


def conditions_distribution(records, metrics, start):
    if not records:
        return None
    samples = list(daily.samples_by_second(records))
    stop = daily.downtime(samples, start, [])
    distribution = daily.observed_time_distribution(samples, metrics, start, stop)
    distribution["denominator_basis"] = "查询起点至最后一条实测，截止后不外推"
    return distribution


def conditions_summary(records, metrics, start, end, source, distribution, simulated=False):
    count = len({record.timestamp for record in records})
    quality = [] if simulated else [{"code": "units_unverified"}]
    if count < len(records):
        quality.append({"code": "duplicate_timestamps", "count": len(records) - count})
    missing = (end - start) // plc.SECOND - count
    if missing:
        quality.append({"code": "missing_seconds", "count": missing})
    source.update(physical_line_start=min((row.line for row in records), default=None),
                  physical_line_end=max((row.line for row in records), default=None))
    series, sampling = sampled_series(records, metrics, start, end)
    return {"status": "ok" if records else "empty_window", "device": plc.DEVICE,
            "window": {"start": start.isoformat(), "end": end.isoformat(), "bounds": "[start,end)"},
            "actual_start": records[0].timestamp.isoformat() if records else None,
            "actual_end": records[-1].timestamp.isoformat() if records else None, "record_count": len(records),
            "metrics": plc.summarize(records, metrics, quality), "data_quality": quality, "evidence": source,
            "series": series, "sampling": sampling, "distribution": distribution,
            "chart": {"status": "not_requested", "path": None}}


def history_conditions(day, request, paths):
    start, end, start_text, end_text = window_for_conditions(day, "history", request)
    metrics_requested = selected_names(request, "metrics", [name for _, name, _ in plc.DEFAULT_METRICS])
    limits_requested = selected_names(request, "limit_metrics", list(limits.POINTS))
    archive, member = archive_name(day), f"{plc.DEVICE}_{day:%Y%m%d}.txt"
    source = paths.data_dir / archive

    def compute():
        limit_fields = [field for name in limits_requested if name in limits.POINTS
                        for field, _ in limits.POINTS[name][1:]] or ["桩号"]
        fields = list(dict.fromkeys([*metrics_requested, *limit_fields, *ACTIVITY_FIELDS]))
        index_root = paths.output_dir / ".cache" / "conditions-index"
        records, metrics = conditions_index.read_records(source, member, start, end, fields, index_root)
        field_indices = {name: index for index, (_, name, _) in enumerate(metrics)}

        def select_fields(names):
            indices = [field_indices[name] for name in dict.fromkeys(names)]
            selected = [plc.Record(row.timestamp, row.line, tuple(row.values[index] for index in indices)) for row in records]
            return selected, tuple(metrics[index] for index in indices)

        selected_records, selected_metrics = select_fields(metrics_requested)
        activity_records, activity_metrics = select_fields(ACTIVITY_FIELDS)
        distribution = conditions_distribution(activity_records, activity_metrics, start)
        conditions = conditions_summary(selected_records, selected_metrics, start, end, {"zip": archive, "txt": member}, distribution)
        check = {"date": day.isoformat(), "start_time": start_text, "end_time": end_text, "metrics": limits_requested}
        checked, _ = limits.run_limits(paths.data_dir, check,
                                      record_reader=lambda _archive, _member, _start, _end, names: select_fields(names))
        if checked.get("points"):
            names = [point["point"]["field"] for point in checked["points"]]
            limit_records, limit_metrics = select_fields(
                [field for name in names for field, _ in limits.POINTS[name][1:]])
            checked["series"], checked["sampling"] = sampled_limits(limit_records, limit_metrics, names, start, end)
        return {"status": conditions["status"], "conditions": conditions, "limits": checked}

    key = ["conditions-v3", start.isoformat(), end.isoformat(), metrics_requested, limits_requested]
    return cached_result(paths.output_dir / ".cache" / "conditions", [source], key, (plc, daily, limits, figure), compute)


def simulation_conditions(day, request):
    start, end, _, _ = window_for_conditions(day, "simulation", request)
    names = selected_names(request, "metrics", [name for _, name, _ in plc.DEFAULT_METRICS])
    unavailable = [name for name in names if name not in simulation.BASE_FIELDS]
    if unavailable:
        raise ValueError("模拟场景未配置测点 " + "、".join(unavailable))
    records, metrics = simulation.sample_records(day, start, end, names)
    activity_records, activity_metrics = simulation.sample_records(day, start, end, ACTIVITY_FIELDS)
    distribution = conditions_distribution(activity_records, activity_metrics, start)
    conditions = conditions_summary(records, metrics, start, end, simulation.source_evidence(records), distribution, simulated=True)
    limits_requested = selected_names(request, "limit_metrics", list(limits.POINTS))
    checked = simulation.simulated_limits(day, start, end, list(dict.fromkeys(limits_requested)))
    return {"status": conditions["status"], "conditions": conditions, "limits": checked,
            "scenario": simulation.SCENARIO}


def cutter_parameters(request, day):
    positions = request.get("positions")
    if "positions" in request and (not isinstance(positions, list) or not positions
                                   or any(type(value) is not int or value <= 0 for value in positions)):
        raise ValueError("positions 须为非空正整数刀位数组")
    reasons = selected_names(request, "reasons")
    if "date" in request and ("start_date" in request or "end_date" in request):
        raise ValueError("换刀单日与日期范围须择一")
    start, end = request.get("start_date"), request.get("end_date")
    if ("start_date" in request) != ("end_date" in request):
        raise ValueError("换刀范围须同时提供起止日期")
    if "start_date" in request:
        start, end = panel_date(start), panel_date(end)
    elif "date" in request:
        start, end = day, day + timedelta(days=1)
    else:
        start = day - timedelta(days=day.weekday())
        end = start + timedelta(days=7)
    if start >= end:
        raise ValueError("换刀开始日期须早于排除的结束日期")
    return start, end, positions, reasons


def confirmed_standard_hashes(root):
    try:
        manifest = (root / "sources" / "source_manifest.json").read_bytes()
    except OSError:
        return set()
    if sha256(manifest).hexdigest() != USER_CONFIRMED_MANIFEST:
        return set()
    return {item["sha256"] for item in json.loads(manifest)["files"] if item["path"].startswith("standards_ocr/")}


def search_evidence(request, paths):
    query = request.get("query")
    mode = request.get("evidence_mode", "auto")
    limit = request.get("limit", 5)
    filters = {name: request[name] for name in EVIDENCE_FILTERS if name in request}
    if not isinstance(query, str) or not query.strip() or len(query) > 2000:
        raise ValueError("请输入不超过 2000 字的检索问题")
    if mode not in ("auto", "standard", "case", "both") or type(limit) is not int or not 1 <= limit <= 20:
        raise ValueError("检索类型或结果数量无效")
    if any(not isinstance(value, str) for value in filters.values()):
        raise ValueError("检索筛选条件须为字符串")
    if not (paths.knowledge_root / "index" / "evidence.sqlite").is_file():
        return {"status": "insufficient_evidence", "standards": [], "cases": [],
                "evidence_gaps": ["请先在「设置 → 工程数据」配置已入库的规范与案例库。"]}
    settings = evidence.config_at(paths.knowledge_root / "models.json")
    result = evidence.search_and_save(paths.knowledge_root, query, settings, limit, mode, **filters)
    confirmed = confirmed_standard_hashes(paths.knowledge_root)
    for item in result["standards"]:
        metadata = item["metadata"]
        if item["citation"]["version_hash"] in confirmed:
            metadata["library_validity"] = {"status": "current", "basis": "user_confirmed_catalog",
                                            "label": "现行（本地库标注）"}
    if result.get("result_file"):
        result["result_file"] = Path(result["result_file"]).as_posix()
    return result


def panel_request(request, paths):
    if not isinstance(request, dict):
        raise ValueError("面板查询须为 JSON 对象")
    panel, mode = request.get("panel"), request.get("mode", "history")
    if not isinstance(panel, str) or panel not in PANEL_FIELDS or mode not in ("history", "simulation"):
        raise ValueError("面板或数据模式无效")
    if request.keys() - {"panel", "mode", "metadata", *PANEL_FIELDS[panel]}:
        raise ValueError("该面板收到不支持的筛选字段")
    metadata = request.get("metadata", False)
    if type(metadata) is not bool:
        raise ValueError("metadata 须为布尔值")
    origin = "historical" if mode == "history" else "synthetic"
    if panel == "evidence":
        origin = "knowledge_index"
    if metadata:
        result = panel_options(panel, mode, paths)
        return {"schema_version": "1.0.0", "panel": panel, "mode": mode, "data_origin": origin,
                "status": result["status"], "data": result}
    default_day = HISTORICAL_DAY if mode == "history" else simulation.DEFAULT_DAY
    if mode == "history" and panel in ("progress", "conditions") and "date" not in request:
        if not readable_archive(paths.data_dir / archive_name(default_day), default_day):
            dates = archive_index(paths)
            if dates:
                default_day = panel_date(dates[-1])
    day = panel_date(request["date"]) if "date" in request else default_day
    if panel == "evidence":
        result = search_evidence(request, paths)
    elif panel == "progress":
        detail = request.get("detail")
        if detail not in (None, "week", "day"):
            raise ValueError("进度查询 detail 须为 week 或 day")
        prepare = request.get("prepare", False)
        if type(prepare) is not bool or (prepare and (mode != "history" or detail != "week")):
            raise ValueError("prepare 只用于准备历史周索引")
        if detail == "day":
            result = simulation.simulated_day(day) if mode == "simulation" else daily_for_panel(day, paths)
        elif mode == "simulation":
            result = week_progress(day, lambda selected, _: simulation.simulated_day(selected), unit="m",
                                   select_day=detail != "week")
        elif detail == "week":
            result = indexed_week(day, paths, prepare)
        else:
            result = week_progress(day, lambda selected, previous: daily_for_panel(selected, paths, previous),
                                   select_day=detail != "week")
        if mode == "simulation":
            result["scenario"] = simulation.SCENARIO
    elif panel == "conditions":
        result = simulation_conditions(day, request) if mode == "simulation" else history_conditions(day, request, paths)
    else:
        start, end, positions, reasons = cutter_parameters(request, day)
        if mode == "simulation":
            result = simulation.simulated_cutters(start, end, positions, reasons)
        else:
            def compute():
                return cutters.query(paths.cutter_source, start.isoformat(), end.isoformat(),
                                     position_filter=positions, reason_filter=reasons)

            key = ["cutters-v2", start.isoformat(), end.isoformat(), positions, reasons]
            result = cached_result(paths.output_dir / ".cache" / "cutters", [paths.cutter_source], key, (cutters,), compute)
    if panel != "evidence":
        result["figure_style"] = figure.STYLE
    return {"schema_version": "1.0.0", "panel": panel, "mode": mode, "data_origin": origin,
            "status": result["status"], "data": result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=daily.DEFAULT_DATA)
    parser.add_argument("--cutter-source", type=Path, default=cutters.DEFAULT_SOURCE)
    parser.add_argument("--knowledge-root", type=Path, default=evidence.ROOT)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent.parent / "outputs" / "panels")
    parser.add_argument("--figure-dir", type=Path, help="Export a weekly progress PNG on demand")
    paths = parser.parse_args()
    for name, path in vars(paths).items():
        if path is not None:
            setattr(paths, name, path.resolve())
    request = None
    try:
        request = json.load(sys.stdin)
        if any(paths.output_dir.is_relative_to(source) for source in (
            paths.data_dir, paths.cutter_source.parent, paths.knowledge_root / "sources"
        )):
            raise ValueError("输出目录须位于原始资料目录之外")
        if paths.figure_dir is not None:
            if (not isinstance(request, dict) or request.get("panel") != "progress"
                    or request.get("detail") == "day" or request.get("metadata")):
                raise ValueError("--figure-dir 仅适用于进度周查询")
            if any(paths.figure_dir.is_relative_to(source) for source in (
                paths.data_dir, paths.cutter_source.parent, paths.knowledge_root / "sources"
            )):
                raise ValueError("图表目录须位于原始资料目录之外")
        result = panel_request(request, paths)
        if paths.figure_dir is not None:
            figure.export_week(result["data"], plc.DEVICE, paths.figure_dir,
                               data_origin=result["data_origin"])
    except (plc.StructureError, cutters.StructureError, UnicodeError) as error:
        result = {"status": "data_structure_error", "error": {"message": str(error)}}
    except (ValueError, OverflowError) as error:
        result = {"status": "invalid_arguments", "error": {"message": str(error)}}
    except (OSError, BadZipFile, EOFError, KeyError, RuntimeError, sqlite3.DatabaseError, zlib.error) as error:
        result = {"status": "source_unreadable", "error": {"message": str(error)}}
    if "error" in result:
        result.update(schema_version="1.0.0", data=None)
        if isinstance(request, dict):
            result.update(panel=request.get("panel"), mode=request.get("mode", "history"))
    print(json.dumps(result, ensure_ascii=True, allow_nan=False))


if __name__ == "__main__":
    main()
