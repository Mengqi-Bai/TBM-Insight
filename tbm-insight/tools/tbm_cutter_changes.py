"""换刀统计与重点刀位复盘。Read Sheet1 from the CREC188 cutter ledger."""

import argparse
from base64 import b64encode
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from hashlib import sha256
from html import escape
from io import BytesIO
import json
import math
from pathlib import Path
import posixpath
import re
import sys
from tempfile import NamedTemporaryFile
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZipFile
import zlib

from tbm_figure import COLORS, STYLE, figure_data, legend, metric, new_figure, save_png, title


VERSION = "crec188-cutter-ledger-1"
from tbm_data_sources import HOME, source_path

DEFAULT_SOURCE = source_path("cutterSource", None) or HOME / "unset-cutter.xlsx"
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "outputs" / "cutter_changes"
SHEET = "Sheet1"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
COLUMNS = tuple("ABCDEFGHIJKLMN")
HEADERS = ("序号", "刀位", "原刀体编号", "换刀原因", "刀圈磨损量", "新装刀体号", "寿命状态",
           "寿命状态（新1，维修1,边刀替换0.4）", "新刀状态", "新装刀体刀圈磨损量",
           "换刀日期", "换刀日期", "换刀里程", "开累换刀次数")
REASON_MAP = {"正常": "正常磨损", "正常磨损": "正常磨损"}


class StructureError(Exception):
    pass


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError(message)


def read_sheet(content):
    """Read OOXML cached values without extracting or modifying the workbook."""
    with ZipFile(BytesIO(content), "r") as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheets = [sheet for sheet in workbook.findall("s:sheets/s:sheet", NS) if sheet.get("name") == SHEET]
        if len(sheets) != 1:
            raise StructureError("Expected exactly one Sheet1")
        relations = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        relationship = next((item for item in relations if item.get("Id") == sheets[0].get(f"{{{REL}}}id")), None)
        if relationship is None or relationship.get("TargetMode") == "External":
            raise StructureError("Sheet1 relationship is unavailable")
        target = relationship.get("Target", "")
        member = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target))
        if not member.startswith("xl/"):
            raise StructureError("Invalid worksheet member path")
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            for item in ET.fromstring(archive.read("xl/sharedStrings.xml")):
                strings.append("".join(node.text or "" for node in item.findall(".//s:t", NS)))
        properties = workbook.find("s:workbookPr", NS)
        date1904 = properties is not None and properties.get("date1904") in ("1", "true")
        rows = []
        previous_row = 0
        for row in ET.fromstring(archive.read(member)).findall("s:sheetData/s:row", NS):
            number = int(row.get("r", "0"))
            if number <= previous_row:
                raise StructureError("Worksheet physical row numbers are not increasing")
            previous_row = number
            cells = {column: {"value": None, "type": "blank", "formula": None} for column in COLUMNS}
            seen = set()
            for cell in row:
                address = cell.get("r", "")
                match = re.fullmatch(r"([A-Z]+)([1-9][0-9]*)", address)
                if not match or int(match[2]) != number or address in seen:
                    raise StructureError(f"Invalid or duplicate cell address at row {number}")
                seen.add(address)
                column = match[1]
                kind = cell.get("t", "n")
                stored = cell.findtext("s:v", None, NS)
                value = stored
                if kind == "s" and stored is not None:
                    value = strings[int(stored)]
                elif kind == "inlineStr":
                    value = "".join(node.text or "" for node in cell.findall(".//s:t", NS))
                elif kind == "n" and stored is not None:
                    try:
                        number_value = float(stored)
                    except ValueError as error:
                        raise StructureError(f"Invalid stored number at {address}") from error
                    if not math.isfinite(number_value):
                        raise StructureError(f"Non-finite stored number at {address}")
                    value = int(number_value) if number_value.is_integer() else number_value
                if column not in COLUMNS:
                    if value is not None:
                        raise StructureError(f"Unexpected populated column {column}")
                    continue
                cells[column] = {"value": value, "type": kind,
                                 "formula": cell.findtext("s:f", None, NS)}
            if any(cell["value"] is not None or cell["formula"] is not None for cell in cells.values()):
                rows.append((number, cells))
        if not rows or rows[0][0] != 1 or tuple(rows[0][1][c]["value"] for c in COLUMNS) != HEADERS:
            raise StructureError("Sheet1 header does not match the verified A:N layout")
        return rows[1:], date1904, member


def parse_date(cell, date1904):
    value = cell["value"]
    if value is None or str(value).strip() == "":
        return None, "missing"
    if cell["type"] == "e":
        return None, "excel_error"
    text = str(value).strip()
    try:
        if re.fullmatch(r"[0-9]{8}", text):
            return datetime.strptime(text, "%Y%m%d").date(), "valid"
        if re.fullmatch(r"[0-9]{4}[./-][0-9]{1,2}[./-][0-9]{1,2}", text):
            year, month, day = map(int, re.split(r"[./-]", text))
            return date(year, month, day), "valid"
        if cell["type"] == "d":
            stamp = datetime.fromisoformat(text)
            return stamp.date(), "valid"
        if isinstance(value, (int, float)) and 1 <= value < 2958466:
            # Excel's 1900 system contains a fictitious 1900-02-29.
            if not date1904 and value == 60:
                return None, "invalid_excel_serial"
            origin = date(1904, 1, 1) if date1904 else date(1899, 12, 31)
            offset = int(value) if date1904 or value < 60 else int(value) - 1
            return origin + timedelta(days=offset), "valid_excel_serial"
    except (ValueError, OverflowError):
        pass
    return None, "invalid"


def positions(value):
    text = "" if value is None else str(value)
    parts = re.split(r"[,，]", text)
    if not parts or any(not re.fullmatch(r"\s*[0-9]+\s*", token) or int(token) <= 0 for token in parts):
        return [], False
    parsed = [int(part) for part in parts]
    return list(dict.fromkeys(parsed)), len(parsed) != len(set(parsed))


def reason(value):
    text = "" if value is None else str(value).strip()
    return REASON_MAP.get(text, text) if text else "未填写"


def wear(cell):
    value = cell["value"]
    if value is None or (isinstance(value, str) and not value.strip()):
        return {"raw": value, "value": None, "status": "missing"}
    if cell["type"] != "e":
        try:
            number = float(value)
            if math.isfinite(number):
                return {"raw": value, "value": number, "status": "numeric"}
        except (ValueError, TypeError):
            pass
    return {"raw": value, "value": None, "status": "non_numeric"}


def prepare(source):
    content = source.read_bytes()
    try:
        rows, date1904, member = read_sheet(content)
    except (ET.ParseError, KeyError, IndexError, ValueError) as error:
        raise StructureError(f"Invalid Sheet1 OOXML structure: {error}") from error
    records, unresolved, invalid_positions, date_notes, repeated_tokens = [], [], [], [], []
    for number, cells in rows:
        raw = {column: cell["value"] for column, cell in cells.items()}
        first, first_state = parse_date(cells["K"], date1904)
        second, second_state = parse_date(cells["L"], date1904)
        conflict = first is not None and second is not None and first != second
        effective = None if conflict else first or second
        knife_positions, duplicate_token = positions(raw["B"])
        entry = {
            "record_id": f"{source.as_posix()}#{SHEET}!{number}", "excel_row": number,
            "sequence_raw": raw["A"], "position_raw": raw["B"], "positions": knife_positions,
            "date": effective.isoformat() if effective else None,
            "date_evidence": {"K": cells["K"], "L": cells["L"],
                              "K_status": first_state, "L_status": second_state},
            "reason_raw": raw["D"], "reason": reason(raw["D"]),
            "old_body_id": raw["C"], "new_body_id": raw["F"],
            "original_wear": wear(cells["E"]), "installed_wear": wear(cells["J"]),
            "state_raw": {"G": raw["G"], "H": raw["H"], "I": raw["I"]},
            "chainage_raw": raw["M"], "cumulative_count_raw": raw["N"], "raw_cells": cells,
        }
        records.append(entry)
        if effective is None:
            unresolved.append({**entry, "issue": "date_conflict" if conflict else "date_unavailable"})
        elif first is None or second is None:
            date_notes.append({"record_id": entry["record_id"], "excel_row": number,
                               "issue": "single_valid_date", "date_evidence": entry["date_evidence"]})
        if not knife_positions:
            invalid_positions.append({"record_id": entry["record_id"], "excel_row": number,
                                      "raw": raw["B"], "date": entry["date"]})
        if duplicate_token:
            repeated_tokens.append({"excel_row": number, "raw": raw["B"]})
    return records, {"date_unassigned": unresolved, "single_valid_date": date_notes,
                     "unparsed_positions": invalid_positions, "repeated_position_tokens": repeated_tokens}, member, sha256(content).hexdigest()


def iso_date(value):
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError("Dates must use YYYY-MM-DD")
    return date.fromisoformat(value)


def repeated_groups(details):
    groups = defaultdict(list)
    for item in details:
        groups[(item["date"], item["position"])].append(item)
    repeated = []
    suspected = []
    for (day, position), entries in sorted(groups.items()):
        if len(entries) > 1:
            repeated.append({"date": day, "position": position, "count": len(entries),
                             "reasons": dict(Counter(item["reason"] for item in entries)),
                             "entry_ids": [item["entry_id"] for item in entries]})
        identities = defaultdict(list)
        for item in entries:
            fingerprint = json.dumps([item["raw_cells"][col]["value"] for col in "CDEFGHIJM"],
                                     ensure_ascii=True)
            identities[fingerprint].append(item["entry_id"])
        for ids in identities.values():
            if len(ids) > 1:
                suspected.append({"date": day, "position": position, "entry_ids": ids})
    return repeated, suspected


def draw_figures(result, directory, stem):
    from matplotlib.dates import DateFormatter, date2num
    from matplotlib.ticker import FixedLocator, MaxNLocator
    from matplotlib import colormaps
    from textwrap import fill

    ranking = result["ranking"]
    categories = [item["reason"] for item in result["reasons"]]
    summary = result["summary"]
    window = result["window"]
    dates = [item["date"] for item in result["details"]]
    period = (f"{window['start']} 至 {window['end']}（终点不含）\n"
              f"原始记录 {summary['raw_record_count']} 条　处理 {summary['position_treatment_count']} 次")
    data = figure_data("cutter_positions", "CREC188", [metric("treatments", "刀位处理次数", "次")],
                       window, {"start": min(dates, default=None), "end": max(dates, default=None)},
                       summary["raw_record_count"], {"date_unassigned": len(result["quality"]["date_unassigned"]),
                       "position_unparsed": len(result["matched_unparsed_records"])},
                       {**result["source"], "physical_rows": sorted({
                           item["excel_row"] for item in [*result["details"], *result["matched_unparsed_records"]]})})
    fig = new_figure(max(4.3, .23 * len(ranking) + 1.7))
    axis = fig.subplots()
    if ranking:
        indices = list(range(len(ranking)))
        totals = [0] * len(ranking)
        colors = {reason: COLORS[tone] for reason, tone in STYLE["cutter_reason_tones"].items()}
        for category in categories:
            values = [item["reasons"].get(category, 0) for item in ranking]
            palette_index = int(sha256(category.encode("utf-8")).hexdigest()[:8], 16) % 20
            axis.barh(indices, values, left=totals, label=fill(category, width=12),
                      color=colors.get(category, colormaps["tab20"](palette_index)))
            totals = [left + value for left, value in zip(totals, values)]
        axis.set_yticks(indices, [str(item["position"]) for item in ranking])
        # Reserve a row for the legend inside the frame.
        axis.set_ylim(len(indices) - .4 + math.ceil(len(categories) / 4), -.7)
        for index, count in enumerate(totals):
            axis.annotate(str(count), (count, index), xytext=(5, 0), textcoords="offset points", va="center")
        axis.set_xlim(0, max(totals) * 1.2)
        legend(axis, loc="lower right", ncol=min(4, len(categories)))
    else:
        axis.text(.5, .5, "所查时段无可解析刀位记录", ha="center", transform=axis.transAxes)
    axis.set_xlabel("刀位处理次数")
    axis.set_ylabel("刀位")
    axis.xaxis.set_major_locator(MaxNLocator(integer=True))
    title(fig, "刀位处理次数", "CREC188", period)
    bar_path = directory / f"{stem}_positions.png"
    save_png(fig, bar_path, data)
    result["charts"]["positions"] = {"status": "generated", "path": str(bar_path), "figure_data": data}

    positions = sorted(item["position"] for item in ranking)
    first, end = date.fromisoformat(window["start"]), date.fromisoformat(window["end"])
    length = (end - first).days
    fig = new_figure(max(4.6, .22 * len(positions) + 1.7), width=9 if length > 7 else 8, align_time=length == 7)
    axis = fig.subplots()
    counts = Counter((item["date"], item["position"]) for item in result["details"])
    if counts:
        slots = {position: index for index, position in enumerate(positions)}
        for (day, position), count in counts.items():
            x, y = date2num(date.fromisoformat(day)), slots[position]
            color = COLORS["repeated"] if count > 1 else COLORS["measured"]
            axis.scatter(x, y, s=21 + 12 * min(count - 1, 5), color=color)
            if count > 1:
                axis.annotate(str(count), (x, y), xytext=(6, 3), textcoords="offset points", color=color)
        axis.set_yticks(range(len(positions)), [str(item) for item in positions])
        axis.set_ylim(-.8, len(positions) + .5)
        axis.scatter([], [], color=COLORS["measured"], label="处理一次")
        axis.scatter([], [], color=COLORS["repeated"], label="同日同刀位多次处理")
        legend(axis, loc="upper left", ncol=2)
    else:
        axis.text(.5, .5, "所查时段无可解析刀位记录", ha="center", transform=axis.transAxes)
    axis.set_xlim(date2num(first) - .5, date2num(end) - .5)
    step = max(1, math.ceil(length / 7))
    axis.xaxis.set_major_locator(FixedLocator([
        date2num(first + timedelta(days=offset)) for offset in range(0, length, step)]))
    axis.xaxis.set_major_formatter(DateFormatter(STYLE["date_format"] if length > 31 else "%m-%d"))
    axis.set_xlabel("记录日期")
    axis.set_ylabel("刀位")
    title(fig, "日期与刀位事件", "CREC188", period)
    event_path = directory / f"{stem}_events.png"
    event_data = {**data, "kind": "cutter_events"}
    save_png(fig, event_path, event_data)
    result["charts"]["events"] = {"status": "generated", "path": str(event_path), "figure_data": event_data}


def write_report(result, target):
    columns = (("date", "日期"), ("position", "刀位"), ("reason", "原因"),
               ("old_body_id", "原刀体号"), ("new_body_id", "新装刀体号"),
               ("state_raw", "原始状态"), ("chainage_raw", "里程原值"), ("excel_row", "Excel 行号"))
    rows = []
    for item in result["details"]:
        values = [item[key] for key, _ in columns]
        values[5] = json.dumps(values[5], ensure_ascii=False)
        rows.append("<tr>" + "".join(f"<td>{escape('' if value is None else str(value))}</td>"
                                     for value in values) + "</tr>")
    images = "".join(f'<img src="data:image/png;base64,{b64encode(Path(chart["path"]).read_bytes()).decode("ascii")}" alt="{name}">'
                     for name, chart in result["charts"].items() if chart["status"] == "generated")
    summary = result["summary"]
    pending = []
    for item in result["quality"]["date_unassigned"]:
        raw = item["date_evidence"]
        pending.append(f"<tr><td>{item['excel_row']}</td><td>{escape(item['issue'])}</td>"
                       f"<td>{escape(str(raw['K']['value']))}</td><td>{escape(str(raw['L']['value']))}</td>"
                       f"<td>{escape(str(item['position_raw']))}</td></tr>")
    for item in result["quality"]["unparsed_positions"]:
        pending.append(f"<tr><td>{item['excel_row']}</td><td>刀位无法解析</td><td></td><td></td>"
                       f"<td>{escape(str(item['raw']))}</td></tr>")
    html = f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>换刀统计与重点刀位复盘</title>
<style>body{{font:15px system-ui;margin:2rem;color:#172333}}table{{border-collapse:collapse}}
td,th{{padding:.4rem;border:1px solid #dce2e9}}img{{max-width:100%}}summary{{cursor:pointer}}</style>
<h1>换刀统计与重点刀位复盘</h1><p>{result['window']['start']} 至 {result['window']['end']}（终点不含）</p>
<p>原始记录 {summary['raw_record_count']} 条，刀位处理 {summary['position_treatment_count']} 次，
涉及 {summary['distinct_position_count']} 个刀位。台账截止 {result['ledger_cutoff']}。</p>
<p>{escape(result['review_note'])}</p><p>日期无法归属的记录 {len(result['quality']['date_unassigned'])} 条。</p>
<p>来源 {escape(result['source']['file'])} / {SHEET}，第一行为表头。规则 {VERSION}。</p>
<details><summary>查看待核对记录</summary><table><tr><th>Excel 行号</th><th>问题</th>
<th>K 列原值</th><th>L 列原值</th><th>刀位原值</th></tr>{''.join(pending)}</table></details>
<details><summary>查看处理明细</summary><table><thead><tr>
{''.join(f'<th>{label}</th>' for _, label in columns)}</tr></thead><tbody>{''.join(rows)}</tbody></table></details>
{images}</html>"""
    with NamedTemporaryFile(dir=target.parent, mode="w", encoding="utf-8", delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(html)
    try:
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def query(source, start=None, end=None, day=None, position_filter=None, reason_filter=None, output_dir=None):
    source = source.resolve()
    if day is not None:
        if start is not None or end is not None:
            raise ValueError("Use --date or --start-date/--end-date")
        start, end = iso_date(day), iso_date(day) + timedelta(days=1)
    elif start is not None or end is not None:
        if start is None or end is None:
            raise ValueError("Both --start-date and --end-date are required")
        start, end = iso_date(start), iso_date(end)
    if start is not None and start >= end:
        raise ValueError("Start date must precede the exclusive end date")
    selected_positions = set(position_filter or [])
    if any(position <= 0 for position in selected_positions):
        raise ValueError("Positions must be positive integers")
    selected_reasons = {reason(value) for value in reason_filter or []}
    records, quality, member, source_hash = prepare(source)
    dates = [date.fromisoformat(item["date"]) for item in records if item["date"] is not None]
    if not dates:
        raise StructureError("Sheet1 contains no unambiguous valid dates")
    cutoff = max(dates)
    if start is None:
        start, end = cutoff - timedelta(days=6), cutoff + timedelta(days=1)
    beyond = end > cutoff + timedelta(days=1)
    matched, details = [], []
    for item in records:
        if item["date"] is None or not start.isoformat() <= item["date"] < end.isoformat():
            continue
        if selected_reasons and item["reason"] not in selected_reasons:
            continue
        chosen = [position for position in item["positions"] if not selected_positions or position in selected_positions]
        if selected_positions and not chosen:
            continue
        matched.append(item)
        for position in chosen:
            details.append({**item, "position": position,
                            "entry_id": f'{item["record_id"]}/position/{position}'})
    details.sort(key=lambda item: (item["date"], item["position"], item["excel_row"]))
    ranking = []
    for position, count in sorted(Counter(item["position"] for item in details).items(),
                                   key=lambda item: (-item[1], item[0])):
        entries = [item for item in details if item["position"] == position]
        ranking.append({"position": position, "count": count,
                        "reasons": dict(Counter(item["reason"] for item in entries)),
                        "entry_ids": [item["entry_id"] for item in entries]})
    repeats, suspected = repeated_groups(details)
    quality["same_day_repeated_positions"] = repeats
    quality["possible_duplicates"] = suspected
    invalid_selected = [item for item in matched if not item["positions"]]
    coverage = "none" if start > cutoff else "partial" if beyond else "within_ledger"
    status = ("not_covered" if coverage == "none" else "position_parse_error" if invalid_selected
              else "ok" if matched else "no_matches")
    note = "所查时段没有匹配记录。"
    if ranking:
        top = ranking[0]
        note = f'{top["position"]}号刀位记录最多，处理 {top["count"]} 次。'
        repeat = next((item for item in repeats if item["position"] == top["position"]), None)
        if repeat:
            why = "、".join(f"{key} {count} 次" for key, count in repeat["reasons"].items())
            note += f' {repeat["date"]} 有 {repeat["count"]} 次记录（{why}），建议优先核对这些处理记录。'
    reason_counts = Counter(item["reason"] for item in details)
    result = {
        "schema_version": "1.0.0", "rule_version": VERSION, "device": "CREC188", "status": status,
        "window": {"start": start.isoformat(), "end": end.isoformat(), "bounds": "[start,end)"},
        "ledger_cutoff": cutoff.isoformat(), "coverage": {"status": coverage,
            "message": "台账尚未覆盖该时段。" if beyond else None},
        "filters": {"positions": sorted(selected_positions), "reasons": sorted(selected_reasons)},
        "summary": {"raw_record_count": len(matched), "position_treatment_count": len(details),
                    "distinct_position_count": len(ranking)},
        "ranking": ranking, "reasons": [{"reason": key, "count": value}
                                       for key, value in sorted(reason_counts.items(), key=lambda item: (-item[1], item[0]))],
        "reason_mapping": REASON_MAP, "review_note": note, "details": details,
        "matched_unparsed_records": invalid_selected, "quality": quality,
        "source": {"path": str(source), "file": source.name, "sheet": SHEET, "worksheet_member": member,
                   "sha256": source_hash, "data_record_count": len(records),
                   "reason_missing_count": sum(item["reason"] == "未填写" for item in records),
                   "original_wear_missing_count": sum(item["original_wear"]["status"] == "missing" for item in records)},
        "charts": {name: {"status": "not_requested", "path": None} for name in ("positions", "events")},
        "report": {"status": "not_requested", "path": None},
    }
    if output_dir is not None:
        directory = output_dir.resolve()
        signature = json.dumps(result["filters"], sort_keys=True).encode("utf-8")
        stem = f"CREC188_cutters_{start:%Y%m%d}-{end:%Y%m%d}_{sha256(signature).hexdigest()[:8]}"
        try:
            if directory.is_relative_to(source.parent):
                raise ValueError("Output directory must be outside the read-only source directory")
            draw_figures(result, directory, stem)
        except Exception as error:
            for chart in result["charts"].values():
                if chart["status"] != "generated":
                    chart.update(status="failed", error=str(error))
        try:
            if all(chart["status"] == "generated" for chart in result["charts"].values()):
                report = directory / f"{stem}.html"
                write_report(result, report)
                result["report"] = {"status": "generated", "path": str(report)}
        except Exception as error:
            result["report"].update(status="failed", error=str(error))
    return result


def main():
    parser = Parser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--device", default="CREC188")
    parser.add_argument("--start-date")
    parser.add_argument("--end-date")
    parser.add_argument("--date")
    parser.add_argument("--position", type=int, action="append")
    parser.add_argument("--reason", action="append")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    code = 0
    try:
        args = parser.parse_args()
        if args.device != "CREC188":
            raise ValueError("Only CREC188 is supported")
        result = query(args.source, args.start_date, args.end_date, args.date,
                       args.position, args.reason, args.output_dir)
        if any(chart["status"] == "failed" for chart in result["charts"].values()):
            code = 5
        elif result["report"]["status"] == "failed":
            code = 5
        elif result["status"] == "position_parse_error":
            code = 4
    except (ValueError, OverflowError) as error:
        result, code = {"status": "invalid_arguments", "error": {"message": str(error)}}, 2
    except (OSError, BadZipFile, RuntimeError, EOFError, zlib.error) as error:
        result, code = {"status": "source_unreadable", "error": {"message": str(error)}}, 3
    except (StructureError, ET.ParseError, KeyError, IndexError) as error:
        result, code = {"status": "data_structure_error", "error": {"message": str(error)}}, 4
    if code:
        print(result.get("error", {}).get("message", f"Inspection completed with exit code {code}"), file=sys.stderr)
    print(json.dumps({"schema_version": "1.0.0", "rule_version": VERSION, **result},
                     ensure_ascii=True, allow_nan=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
