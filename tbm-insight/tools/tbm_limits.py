"""CREC188 temperature setpoint checks against the original PLC archives."""

import argparse
from base64 import b64encode
from datetime import date, datetime, time, timedelta
from hashlib import sha256
from html import escape
from itertools import groupby
import json
from math import nan
from pathlib import Path
import re
import sys
from tempfile import NamedTemporaryFile
from zipfile import BadZipFile
import zlib

from tbm_daily_summary import DEFAULT_DATA, load_day, samples_by_second
from tbm_insight import DEVICE, SECOND, StructureError, read_records
from tbm_figure import (COLORS, LABELS, STYLE, chart_arrays, clock_axis, figure_data, legend,
                        full_day, metric, new_figure, save_png, title)


VERSION = "crec188-temperature-setpoints-1"
POINTS = {
    "主液压油箱温度": ("主液压油箱", ("主液压油箱温度", 8),
                      ("液压油箱温度预警设置", 9), ("液压油箱温度报警设置", 10)),
    "齿轮油温度": ("齿轮油润滑系统", ("齿轮油温度", 46),
                  ("齿轮油温度预警设置", 70), ("齿轮油温度报警设置", 71)),
}
LEVELS = {"warning": "达到预警设定", "alarm": "达到报警设定"}
END_REASONS = {
    "below_setpoint": "恢复至设定值以下",
    "missing_timestamp": "缺少连续秒级记录，区段截断",
    "missing_value_or_setpoint": "实测值或设定缺失，区段截断",
    "inverted_setpoints": "预警设定高于报警设定，区段截断",
    "query_cutoff": "截至实测截止仍达到设定",
}


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError(message)


def rule(device, component, point, setting, level):
    def field(entry):
        return {"field": entry[0], "column": entry[1]}

    return {
        "id": f"{device}.{point[1]}.{level}", "version": VERSION, "device": device,
        "component": component, "point": field(point), "unit": None,
        "applicability": "同一采样时刻的PLC实测值与设定原值比较",
        "kind": f"plc_{level}_setpoint", "level": level, "comparison": ">=",
        "source": {"kind": "same_sample_plc_setpoint", **field(setting)},
        "verified_delay_seconds": None, "verified_recovery_hysteresis": None,
    }


def clock_time(day, value, *, is_end=False):
    if is_end and value in ("24:00", "24:00:00"):
        return day + timedelta(days=1)
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{2}:[0-9]{2}(?::[0-9]{2})?", value):
        raise ValueError("Time must be HH:MM or HH:MM:SS")
    return datetime.combine(day.date(), time.fromisoformat(value))


def resolve_window(data_dir, args):
    explicit = args.get("date")
    relative = args.get("relative_day")
    if relative not in (None, "today", "yesterday") or (explicit is not None and relative is not None):
        raise ValueError("Specify date or relative_day (today/yesterday)")
    anchor = latest = None
    if explicit is not None:
        if not isinstance(explicit, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", explicit):
            raise ValueError("Date must be YYYY-MM-DD")
        day = date.fromisoformat(explicit)
        if day == date.max:
            raise ValueError("Date is outside the supported range")
    else:
        anchor, _, _, records, _ = load_day(data_dir, None, "chainage")
        if not records:
            raise FileNotFoundError(f"No {DEVICE} runtime records in {data_dir}")
        day = anchor - timedelta(days=1) if relative == "yesterday" else anchor
        latest = records[-1].timestamp
    midnight = datetime.combine(day, time.min)
    start_text, end_text = args.get("start_time"), args.get("end_time")
    if (start_text is None) != (end_text is None):
        raise ValueError("Specify both start_time and end_time")
    start = midnight if start_text is None else clock_time(midnight, start_text)
    end = midnight + timedelta(days=1) if end_text is None else clock_time(midnight, end_text, is_end=True)
    if end_text is None and day == anchor:
        end = latest + SECOND
    if start >= end:
        raise ValueError("Window must advance within one local date")
    return day, anchor, start, end


def comparison(values, index):
    value, warning, alarm = values
    limit = values[index]
    if value is None or limit is None:
        return "missing_value_or_setpoint"
    if warning is not None and alarm is not None and warning > alarm:
        return "inverted_setpoints"
    return "reached" if value >= limit else "below"


def evidence(sample, index):
    stamp, first, last, values = sample
    return {"time": stamp.isoformat(), "line": first, "line_end": last,
            "value": values[0], "setpoint": values[index]}


def intervals(samples, index, rule_info):
    result = []
    hits = []
    previous = None

    def close(end, reason, boundary=None):
        peak = max(hits, key=lambda sample: sample[3][0])
        excess = max(hits, key=lambda sample: sample[3][0] - sample[3][index])
        result.append({
            "rule_id": rule_info["id"], "level": rule_info["level"],
            "point": rule_info["point"]["field"], "component": rule_info["component"],
            "start": hits[0][0].isoformat(), "end": end.isoformat(),
            "last_reached": hits[-1][0].isoformat(), "duration_seconds": (end - hits[0][0]) // SECOND,
            "reached_observations": len(hits), "end_reason": reason,
            "ongoing_at_observed_cutoff": reason == "query_cutoff",
            "peak": evidence(peak, index), "max_excess": excess[3][0] - excess[3][index],
            "max_excess_evidence": evidence(excess, index),
            "start_evidence": evidence(hits[0], index), "last_reached_evidence": evidence(hits[-1], index),
            "boundary_evidence": evidence(boundary, index) if boundary is not None else None,
        })
        hits.clear()

    for sample in samples:
        state = comparison(sample[3], index)
        consecutive = previous is not None and sample[0] - previous[0] == SECOND
        if hits:
            if not consecutive:
                close(hits[-1][0], "missing_timestamp", sample)
            elif state in ("missing_value_or_setpoint", "inverted_setpoints"):
                close(hits[-1][0], state, sample)
            elif state == "below":
                close(sample[0], "below_setpoint", sample)
        if state == "reached":
            hits.append(sample)
        previous = sample
    if hits:
        close(hits[-1][0], "query_cutoff")
    return result


def evaluate_point(records, samples, triplet, rules):
    start_index = triplet * 3
    rows = [record.values[start_index:start_index + 3] for record in records]
    point_samples = [(stamp, first, last, values[start_index:start_index + 3])
                     for stamp, first, last, values in samples]
    peak = max((row[0] for row in rows if row[0] is not None), default=None)
    tied = [record for record, row in zip(records, rows) if peak is not None and row[0] == peak]
    occurrences = [{"time": record.timestamp.isoformat(), "line": record.line}
                   for record in (tied if len(tied) <= 12 else [tied[0], tied[-1]])]
    result = {"point": rules[0]["point"], "component": rules[0]["component"], "unit": None,
              "peak": {"value": peak, "record_count": len(tied), "occurrences": occurrences,
                       "occurrences_complete": len(tied) <= 12}, "checks": {}, "events": []}
    for index, info in enumerate(rules, 1):
        counts = {state: 0 for state in ("reached", "below", "missing_value_or_setpoint", "inverted_setpoints")}
        for row in rows:
            counts[comparison(row, index)] += 1
        setpoints = [row[index] for row in rows if row[index] is not None]
        events = intervals(point_samples, index, info)
        result["checks"][info["level"]] = {
            "rule": info, "counts": counts, "event_count": len(events),
            "setpoint_min": min(setpoints, default=None), "setpoint_max": max(setpoints, default=None),
            "status": "evaluated" if counts["reached"] or counts["below"] else "missing_applicable_limit",
        }
        result["events"].extend(events)
    result["highest_level"] = next((level for level in ("alarm", "warning")
                                    if result["checks"][level]["counts"]["reached"]), None)
    return result



def draw_chart(samples, names, result, target):
    start = datetime.fromisoformat(result["window"]["start"])
    end = datetime.fromisoformat(result["window"]["end"])
    figure = new_figure(1.45 + 2.15 * len(names), align_time=full_day(start, end))
    axes = figure.subplots(len(names), 1, sharex=True, squeeze=False)[:, 0]
    stamps, series = chart_arrays(((stamp, row) for stamp, _, _, row in samples), SECOND)
    for index, (name, axis) in enumerate(zip(names, axes)):
        measure, warning, alarm = series[index * 3:index * 3 + 3]
        axis.plot(stamps, measure, color=COLORS["measured"], linewidth=STYLE["line_width"],
                  label=LABELS["measured"])
        for values, level, label in ((warning, "warning", "预警设定"), (alarm, "alarm", "报警设定")):
            axis.step(stamps, values, where="post", color=COLORS[level], linestyle=STYLE["line_styles"][level],
                      linewidth=STYLE["line_width"], label=label)
            events = [event for event in result["points"][index]["events"] if event["level"] == level]
            if events:
                peak = max(events, key=lambda item: item["max_excess"])["peak"]
                axis.scatter(datetime.fromisoformat(peak["time"]), peak["value"],
                             marker="^" if level == "warning" else "s", s=34,
                             color=COLORS[level], label=LABELS[level], zorder=5)
        axis.set_title(name, loc="left", wrap=True)
        axis.set_ylabel(STYLE["unknown_unit"])
        axis.margins(y=.20)
        legend(axis, loc="best", ncol=2)
    clock_axis(axes[-1], start, end)
    title(figure, "温度实测与限值", DEVICE, result["date"], result["record_count"])
    data = figure_data("limits", DEVICE, [metric(name, name) for name in names], result["window"],
                       {"start": result["actual_start"], "end": result["actual_end"]}, result["record_count"],
                       result["coverage"], {**result["evidence"], "fields": [
                           {"field": field, "column": column} for name in names for field, column in POINTS[name][1:]]})
    save_png(figure, target, data)
    return data


def write_report(result, target):
    events = sorted((event for point in result["points"] for event in point["events"]),
                    key=lambda event: (event["start"], event["point"], event["level"]))
    rows = []
    for event in events:
        peak = event["peak"]
        cells = (event["point"], LEVELS[event["level"]], event["start"], event["end"],
                 event["duration_seconds"], peak["value"], peak["setpoint"], event["max_excess"],
                 f'{event["start_evidence"]["line"]}–{event["last_reached_evidence"]["line"]}',
                 peak["line"], event["max_excess_evidence"]["line"],
                 event["end_label"], event["rule_id"])
        rows.append("<tr>" + "".join(f"<td>{escape(str(cell))}</td>" for cell in cells) + "</tr>")
    headers = ("测点", "等级", "开始", "结束", "秒", "峰值", "峰值时设定", "最大超出量",
               "触及行范围", "峰值行", "最大超出行", "结束依据", "规则")
    source = result["evidence"]
    chart = b64encode(Path(result["chart"]["path"]).read_bytes()).decode("ascii")
    rules = []
    for point in result["points"]:
        for check in point["checks"].values():
            info = check["rule"]
            value, setting = info["point"], info["source"]
            rules.append(f"<li>{escape(info['id'])} · {escape(value['field'])} 第 {value['column']} 列 · "
                         f"{escape(setting['field'])} 第 {setting['column']} 列</li>")
    document = f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>掘进参数超限检查</title>
<style>body{{font:15px system-ui,sans-serif;margin:2rem;color:#172333}}img{{max-width:100%}}
table{{border-collapse:collapse}}th,td{{padding:.45rem;border:1px solid #d8e0e7;text-align:left}}
summary{{cursor:pointer;font-weight:bold;margin:1rem 0}}</style>
<h1>掘进参数超限检查</h1>
<p>{DEVICE} · {result['date']} · {escape(result['actual_start'])} 至 {escape(result['actual_end'])}</p>
<p>来源 {escape(source['zip'])} / {escape(source['txt'])}。表头为第 1 行。规则版本 {VERSION}。</p>
<p>按采样时刻对照 PLC 设定原值。单位待确认。达到设定是测量比较，实际报警和保护触发须核对状态或日志，部件损伤须核对检修证据。</p>
<details><summary>查看限值规则与列号</summary><ul>{''.join(rules)}</ul></details>
<details><summary>查看事件表（{len(events)} 段，预警与报警分别计数）</summary>
<table><thead><tr>{''.join(f'<th>{escape(label)}</th>' for label in headers)}</tr></thead>
<tbody>{''.join(rows)}</tbody></table></details>
<details><summary>查看实测与限值趋势图</summary><img src="data:image/png;base64,{chart}" alt="温度实测与设定曲线"></details></html>"""
    temporary = None
    try:
        with NamedTemporaryFile(dir=target.parent, delete=False, mode="w", encoding="utf-8") as stream:
            temporary = Path(stream.name)
            stream.write(document)
        temporary.replace(target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def inspect_limits(data_dir, args, output_dir=None, *, record_reader=read_records):
    requested = args.get("metrics", list(POINTS))
    if not isinstance(requested, list) or not requested or any(
        not isinstance(name, str) or not name.strip() for name in requested
    ):
        raise ValueError("metrics must contain one or more source field names")
    selected = list(dict.fromkeys(requested))
    supported = [name for name in selected if name in POINTS]
    missing = [{"point": name, "status": "missing_applicable_limit", "label": "缺少限值，待判定",
                "required_evidence": ("CREC188 厂家扭矩–转速曲线、工况模式、短时过载时限和保护设定"
                                      if name == "刀盘扭矩" else "设备适用限值或经核实的 PLC 设定点位")}
               for name in selected if name not in POINTS]
    day, anchor, start, end = resolve_window(data_dir, args)
    stem = f"{DEVICE}_{day:%Y%m%d}"
    archive, member = data_dir / f"{stem}.zip", f"{stem}.txt"
    fields = [field for name in supported for field, _ in POINTS[name][1:]]
    records, actual_fields = record_reader(archive, member, start, end, fields or ["桩号"])
    if fields and [column for _, _, column in actual_fields] != [
        column for name in supported for _, column in POINTS[name][1:]
    ]:
        raise StructureError(1, "Setpoint source column mismatch")
    samples = list(samples_by_second(records))
    result = {
        "schema_version": "1.0.0", "rule_version": VERSION, "device": DEVICE,
        "status": "ok" if records else "empty_window", "date": day.isoformat(),
        "latest_observed_date": anchor.isoformat() if anchor else None,
        "window": {"start": start.isoformat(), "end": end.isoformat(), "bounds": "[start,end)"},
        "actual_start": records[0].timestamp.isoformat() if records else None,
        "actual_end": records[-1].timestamp.isoformat() if records else None,
        "record_count": len(records),
        "coverage": {"observed_seconds": len(samples), "duplicate_records": len(records) - len(samples),
                     "missing_seconds": (end - start) // SECOND - len(samples)},
        "evidence": {"zip": archive.name, "txt": member,
                     "physical_line_start": min((record.line for record in records), default=None),
                     "physical_line_end": max((record.line for record in records), default=None)},
        "points": [], "missing_limits": missing, "priority_event": None, "highest_level": None,
        "equipment_impact": {"plc_alarm_triggered": None, "protection_triggered": None,
                             "damage_confirmed": None,
                             "evidence_needed": ["报警状态或报警及保护日志", "检查或维修记录"]},
        "chart": {"status": "not_requested", "path": None}, "report": {"status": "not_requested", "path": None},
    }
    if not records:
        return result
    for index, name in enumerate(supported):
        component, point, warning, alarm = POINTS[name]
        rules = [rule(DEVICE, component, point, setting, level)
                 for level, setting in (("warning", warning), ("alarm", alarm))]
        evaluated = evaluate_point(records, samples, index, rules)
        for event in evaluated["events"]:
            event["end_label"] = END_REASONS[event["end_reason"]]
            if event["ongoing_at_observed_cutoff"] and samples[-1][0] == end - SECOND:
                event["end_label"] = "截至查询结束仍在超限"
        result["points"].append(evaluated)
    result["priority_event"] = max(
        (event for point in result["points"] for event in point["events"]),
        key=lambda event: (event["level"] == "alarm", event["max_excess"], event["duration_seconds"]),
        default=None,
    )
    reached_levels = {point["highest_level"] for point in result["points"]}
    result["highest_level"] = next((level for level in ("alarm", "warning") if level in reached_levels), None)
    if output_dir is not None and supported:
        try:
            directory = output_dir.resolve()
            if directory.is_relative_to(data_dir.resolve()):
                raise ValueError("--output-dir must be outside the read-only data directory")
            tag = sha256("|".join(supported).encode("utf-8")).hexdigest()[:8]
            name = f"{stem}_{start:%H%M%S}-{end:%H%M%S}_{tag}_limits"
            target = directory / f"{name}.png"
            figure_metadata = draw_chart(samples, supported, result, target)
            result["chart"] = {"status": "generated", "path": str(target),
                               "sampling": "all_observed_seconds", "plotted_seconds": len(samples),
                               "figure_data": figure_metadata}
            report = directory / f"{name}.html"
            write_report(result, report)
            result["report"] = {"status": "generated", "path": str(report)}
        except Exception as error:
            artifact = "report" if result["chart"]["status"] == "generated" else "chart"
            result[artifact] = {"status": "failed", "path": None, "error": str(error)}
    return result


def run_limits(data_dir, args, output_dir=None, *, record_reader=read_records):
    try:
        if args.get("device", DEVICE) != DEVICE:
            raise ValueError(f"Supported device: {DEVICE}")
        result = inspect_limits(data_dir, args, output_dir, record_reader=record_reader)
        artifact_failed = any(result[key]["status"] == "failed" for key in ("chart", "report"))
        return result, 5 if artifact_failed else 0
    except (StructureError, UnicodeError) as error:
        status, code = "data_structure_error", 4
        message, line = str(error), getattr(error, "line", None)
    except (OSError, BadZipFile, EOFError, KeyError, RuntimeError, zlib.error) as error:
        status, code = "source_unreadable", 3
        message, line = str(error), None
    except (ValueError, OverflowError) as error:
        status, code = "invalid_arguments", 2
        message, line = str(error), None
    return {"schema_version": "1.0.0", "rule_version": VERSION, "device": DEVICE,
            "status": status, "error": {"code": status, "message": message, "physical_line": line}}, code


def main():
    parser = Parser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--device", default=DEVICE)
    parser.add_argument("--date")
    parser.add_argument("--relative-day", choices=("today", "yesterday"))
    parser.add_argument("--start-time")
    parser.add_argument("--end-time")
    parser.add_argument("--metric", action="append", dest="metrics")
    try:
        args = vars(parser.parse_args())
        data_dir, output_dir = args.pop("data_dir"), args.pop("output_dir")
        result, code = run_limits(data_dir, {key: value for key, value in args.items() if value is not None},
                                  output_dir)
    except ValueError as error:
        result, code = {"status": "invalid_arguments", "error": {"message": str(error)}}, 2
    if code:
        print(result.get("error", result.get("chart", {})).get("message")
              or result.get("chart", {}).get("error") or result.get("report", {}).get("error"), file=sys.stderr)
    print(json.dumps(result, ensure_ascii=True, allow_nan=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
