"""Expose the CREC188 query CLI through the local MCP stdio transport."""

import argparse
from datetime import datetime, timedelta
import json
from pathlib import Path
import re
import subprocess
import sys
from types import SimpleNamespace
from zipfile import BadZipFile
import zlib

sys.dont_write_bytecode = True
from tbm_insight import DEVICE, StructureError, TIME_FORMAT, read_records
from tbm_daily_summary import SCOPES, run_daily
from tbm_limits import LEVELS, run_limits
import tbm_cutter_changes as cutters
from tbm_data_sources import source_path


CLI = Path(__file__).with_name("tbm_insight.py")
ARCHIVE_NAME = re.compile(rf"{DEVICE}_([0-9]{{8}})\.zip")
PROTOCOL_VERSION = "2025-11-25"
DEFAULT_MINUTES = 60
TOOL = {
    "name": "query_tbm_conditions",
    "description": (
        "查询引松 CREC188 的 PLC 掘进工况，返回工程统计、来源证据和本地趋势图。"
        "默认指标为刀盘转速、刀盘扭矩、总推进力。指定起止时间时使用现场时钟，"
        "含起点、排除终点，限单日。两者均省略时按数据源最新实测时间查询，"
        "默认最近 60 分钟，最长 1440 分钟，范围截在同一归档日。"
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "device": {"type": "string", "enum": [DEVICE], "default": DEVICE},
            "start": {"type": "string", "description": "现场时间 YYYY-MM-DD HH:MM:SS，含起点"},
            "end": {"type": "string", "description": "现场时间 YYYY-MM-DD HH:MM:SS，排除终点"},
            "latest_minutes": {
                "type": "integer", "minimum": 1, "maximum": 1440, "default": DEFAULT_MINUTES,
                "description": "未提供 start/end 时，从最新实测记录往前查询的分钟数",
            },
            "metrics": {
                "type": "array", "items": {"type": "string", "minLength": 1}, "minItems": 1,
                "description": "可选，精确 PLC 表头名称。指定后替换默认三项，例如 主液压油箱温度",
            },
        },
        "additionalProperties": False,
    },
}
DAILY_TOOL = {
    "name": "query_tbm_daily_summary",
    "description": (
        "查询引松 CREC188 的今日净进尺和累计停机时长，返回实际统计日期、截止时间、"
        "停机明细及原始证据。用 relative_day 查询今天或昨天，由工具按最新实测现场日期换算。"
        "指定年月日用 date。只问进尺用 scope=progress，只问停机用 scope=downtime。"
        "掘进量使用稳定前缘估算，首末桩号差另列为净位置变化。"
        "米数未经核实，使用桩号变化量。停机时长为 PLC 联合信号估算。用 week_of 查询日期所在自然周。"
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "device": {"type": "string", "enum": [DEVICE], "default": DEVICE},
            "week_of": {"type": "string", "description": "可选，YYYY-MM-DD 所在自然周。与 date、relative_day、scope 互斥。"},
            "date": {"type": "string", "description": "可选，现场日期 YYYY-MM-DD"},
            "relative_day": {"type": "string", "enum": ["today", "yesterday"],
                             "description": "按现场数据日期查询今天或昨天。与 date 互斥。"},
            "scope": {"type": "string", "enum": list(SCOPES), "default": "summary",
                      "description": "只问进尺用 progress，只问停机用 downtime，两者都问用 summary。"},
            "include_chart": {"type": "boolean",
                              "description": "进尺查询默认带图。汇总需要进度图时传 true，明确只看数字时传 false。"},
        },
        "additionalProperties": False,
    },
}
LIMITS_TOOL = {
    "name": "check_tbm_parameter_limits",
    "description": (
        "掘进参数超限检查。默认检查引松 CREC188 的主液压油箱温度和齿轮油温度，"
        "按同一现场秒的 PLC 设定对照，返回等级、重点事件、事件表、趋势图和来源。"
        "达到设定与 PLC 报警触发分别记录。其他参数无适用规则时返回待判定。"
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "device": {"type": "string", "enum": [DEVICE], "default": DEVICE},
            "date": {"type": "string", "description": "明确指定的现场日期 YYYY-MM-DD"},
            "relative_day": {"type": "string", "enum": ["today", "yesterday"],
                             "description": "按最新现场记录解释今天或昨天。与 date 互斥。"},
            "start_time": {"type": "string", "description": "现场时刻 HH:MM 或 HH:MM:SS，包含"},
            "end_time": {"type": "string", "description": "现场时刻 HH:MM 或 HH:MM:SS，排除。允许 24:00"},
            "metrics": {"type": "array", "items": {"type": "string"}, "minItems": 1,
                        "description": "按原始测点名称选择，例如 主液压油箱温度"},
        },
        "additionalProperties": False,
    },
}
CUTTER_TOOL = {
    "name": "query_tbm_cutter_changes",
    "description": (
        "复盘 CREC188 换刀台账，返回原始记录数、刀位处理次数、涉及刀位数、"
        "反复处理排名、原因及 Excel 行号，生成两张图和 HTML 明细。"
        "省略日期取台账最新有效日及此前六天。date 查询单日，"
        "start_date/end_date 为含起点、不含终点的日期范围。"
        "relative_day 按台账最新有效日期解释今天或昨天，relative_period 按该日定位本周或上周，"
        "自然周为周一至周日。处理次数不能换算新刀采购量。"
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "device": {"type": "string", "enum": [DEVICE], "default": DEVICE},
            "date": {"type": "string", "description": "单日 YYYY-MM-DD，与日期范围互斥"},
            "start_date": {"type": "string", "description": "日期范围起点 YYYY-MM-DD，包含"},
            "end_date": {"type": "string", "description": "日期范围终点 YYYY-MM-DD，排除"},
            "relative_day": {"type": "string", "enum": ["today", "yesterday"],
                             "description": "按台账最新有效日期定位，与明确日期参数互斥"},
            "relative_period": {"type": "string", "enum": ["this_week", "last_week"],
                                "description": "按台账最新有效日期所在的周一至周日定位，其他日期参数均须省略"},
            "positions": {"type": "array", "items": {"type": "integer", "minimum": 1},
                          "minItems": 1, "description": "可选刀位号，例如 [49]"},
            "reasons": {"type": "array", "items": {"type": "string", "minLength": 1},
                        "minItems": 1, "description": "可选原因，未填写筛选空白原因"},
        },
        "additionalProperties": False,
    },
}


def tool_result(result, *, is_error=False, display_text=None):
    return {
        "content": [{"type": "text", "text": display_text if display_text is not None
                     else json.dumps(result, ensure_ascii=False)}],
        "structuredContent": result,
        "isError": is_error,
    }


def tool_error(code, message):
    return tool_result({"status": code, "error": {"code": code, "message": message}}, is_error=True)


def cutter_query(arguments, source, output_dir):
    if not isinstance(arguments, dict) or arguments.keys() - CUTTER_TOOL["inputSchema"]["properties"].keys():
        return tool_error("invalid_arguments", "请传入已声明的换刀复盘参数。")
    if arguments.get("device", DEVICE) != DEVICE:
        return tool_error("invalid_arguments", f"仅支持设备 {DEVICE}。")
    for field in ("date", "start_date", "end_date"):
        if field in arguments and not isinstance(arguments[field], str):
            return tool_error("invalid_arguments", f"{field} 须为 YYYY-MM-DD 字符串。")
    positions, reasons = arguments.get("positions"), arguments.get("reasons")
    if "positions" in arguments and (not isinstance(positions, list) or not positions
                                    or any(type(value) is not int or value <= 0 for value in positions)):
        return tool_error("invalid_arguments", "positions 须为正整数刀位数组。")
    if "reasons" in arguments and (not isinstance(reasons, list) or not reasons
                                  or any(not isinstance(value, str) or not value.strip() for value in reasons)):
        return tool_error("invalid_arguments", "reasons 须为非空原因字符串数组。")
    context = None
    day = arguments.get("date")
    try:
        relative_fields = {"relative_day", "relative_period"} & arguments.keys()
        if relative_fields:
            if len(relative_fields) != 1 or any(field in arguments for field in ("date", "start_date", "end_date")):
                return tool_error("invalid_arguments", "相对日期参数只能选一项，且与明确日期互斥。")
            field = next(iter(relative_fields))
            relative = arguments[field]
            allowed = CUTTER_TOOL["inputSchema"]["properties"][field]["enum"]
            if relative not in allowed:
                return tool_error("invalid_arguments", f"{field} 须为 {' 或 '.join(allowed)}。")
            latest = cutters.query(source)
            anchor = datetime.fromisoformat(latest["ledger_cutoff"])
            if field == "relative_day":
                day = (anchor - timedelta(days=relative == "yesterday")).date().isoformat()
            else:
                monday = anchor - timedelta(days=anchor.weekday() + (7 if relative == "last_week" else 0))
                arguments = {**arguments, "start_date": monday.date().isoformat(),
                             "end_date": (monday + timedelta(days=7)).date().isoformat()}
            context = {field: relative, "anchor": "ledger_cutoff",
                       "ledger_cutoff": latest["ledger_cutoff"]}
        result = cutters.query(source, arguments.get("start_date"), arguments.get("end_date"),
                               day, positions, reasons, output_dir / "cutter_changes")
    except (ValueError, OverflowError) as error:
        return tool_error("invalid_arguments", str(error))
    except (OSError, BadZipFile, RuntimeError, EOFError, zlib.error) as error:
        return tool_error("source_unreadable", str(error))
    except (cutters.StructureError, cutters.ET.ParseError, KeyError, IndexError) as error:
        return tool_error("data_structure_error", str(error))
    if context is not None:
        result["query_context"] = context
    window, summary = result["window"], result["summary"]
    lines = [
        f"换刀复盘范围 {window['start']} 至 {window['end']}（不含终点），台账截止 {result['ledger_cutoff']}。",
        f"原始记录 {summary['raw_record_count']} 条，刀位处理 {summary['position_treatment_count']} 次，"
        f"涉及 {summary['distinct_position_count']} 个刀位。",
        result["review_note"],
    ]
    if result["reasons"]:
        lines.append("原因（按处理次数） " + "、".join(
            f"{item['reason']} {item['count']} 次" for item in result["reasons"]))
    if result["coverage"]["message"]:
        lines.append(result["coverage"]["message"])
    lines.append(f"全表日期无法归属 {len(result['quality']['date_unassigned'])} 条，详见待核对明细。")
    if result["status"] == "position_parse_error":
        lines.append("所选记录包含无法解析的刀位，统计仅包含可解析项，请核对原始行。")
    source_meta = result["source"]
    lines.append(f"来源 {source_meta['file']} / {source_meta['sheet']}，明细保留 Excel 行号和原始单元格。")
    for name, label in (("positions", "刀位处理次数"), ("events", "日期与刀位事件")):
        chart = result["charts"][name]
        if chart["status"] == "generated":
            chart["path"] = Path(chart["path"]).as_posix()
            lines.append(f"![{label}](<{chart['path']}>)")
        else:
            lines.append(f"{label}图生成失败，统计和证据已保留。")
    report = result["report"]
    if report["status"] == "generated":
        report["path"] = Path(report["path"]).as_posix()
        lines.append(f"[换刀明细与待核对记录](<{report['path']}>)")
    else:
        lines.append("HTML 明细未生成，原始明细保留在结构化结果中。")
    return tool_result(result, display_text="\n".join(lines))


def limits_query(arguments, data_dir, output_dir):
    if not isinstance(arguments, dict) or arguments.keys() - LIMITS_TOOL["inputSchema"]["properties"].keys():
        return tool_error("invalid_arguments", "请传入已声明的超限检查参数。")
    result, code = run_limits(data_dir, arguments, output_dir)
    if code not in (0, 5):
        return tool_result(result, is_error=True)
    window = result["window"]
    lines = [f"请求时段 {window['start']} 至 {window['end']}（不含终点）"]
    if result["actual_start"] is None:
        lines.append("所查时段无记录。")
    else:
        lines.append(f"实际实测时段 {result['actual_start']} 至 {result['actual_end']}")
    for point in result["points"]:
        name = point["point"]["field"]
        warning, alarm = (point["checks"][level] for level in ("warning", "alarm"))
        counts = "，".join(
            f"{LEVELS[level]} {check['counts']['reached']} 条"
            if check["status"] == "evaluated" else f"{LEVELS[level]} 缺少限值或有效采样，待判定"
            for level, check in (("warning", warning), ("alarm", alarm))
        )
        lines.append(f"{name} · {counts}（单位待确认）")
    for missing in result["missing_limits"]:
        lines.append(f"{missing['point']} · {missing['label']} · 需 {missing['required_evidence']}")
    event = result["priority_event"]
    if event is not None:
        lines.append(f"优先复核 {event['component']} · {LEVELS[event['level']]} · "
                     f"{event['start']} 至 {event['end']}，{event['duration_seconds']} 秒，"
                     f"峰值 {event['peak']['value']:.6g}，最大超出 {event['max_excess']:.6g}（原始值），"
                     f"{event['end_label']}。")
    if result["points"]:
        lines.append("实际报警、保护触发和部件损伤状态待证据确认。")
    if result["report"]["status"] == "generated":
        report = Path(result["report"]["path"]).as_posix()
        result["report"]["path"] = report
        lines.append(f"[查看事件表和趋势图](<{report}>)")
    if result["chart"]["status"] == "generated":
        chart = Path(result["chart"]["path"]).as_posix()
        result["chart"]["path"] = chart
        lines.append(f"[实测与限值趋势图 PNG](<{chart}>)")
    if code == 5:
        lines.append("部分图表或明细文件生成失败。")
    return tool_result(result, display_text="\n".join(lines))


def weekly_query(arguments, data_dir, output_dir):
    from tbm_figure import export_week
    from tbm_panel_data import daily_for_panel, panel_date, week_progress

    if arguments.keys() & {"date", "relative_day", "scope"}:
        return tool_error("invalid_arguments", "week_of 与 date、relative_day、scope 互斥。")
    if arguments.get("device", DEVICE) != DEVICE:
        return tool_error("invalid_arguments", f"当前支持设备 {DEVICE}。")
    include_chart = arguments.get("include_chart", True)
    if type(include_chart) is not bool:
        return tool_error("invalid_arguments", "include_chart 须为布尔值。")
    if output_dir.is_relative_to(data_dir):
        return tool_error("invalid_arguments", "输出目录须位于原始资料目录之外。")
    try:
        day = panel_date(arguments["week_of"])
        day + timedelta(days=7 - day.weekday())
    except (ValueError, OverflowError):
        return tool_error("invalid_arguments", "week_of 须为有效的 YYYY-MM-DD 日期。")
    paths = SimpleNamespace(data_dir=data_dir, output_dir=output_dir / "panels")
    result = week_progress(day, lambda selected, previous: daily_for_panel(selected, paths, previous),
                           select_day=False)
    result.update(schema_version="1.0.0", device=DEVICE)
    if include_chart:
        export_week(result, DEVICE, output_dir)
    else:
        result["chart"] = {"status": "not_requested", "path": None}
    totals = result["totals"]
    observed = [item["date"] for item in result["days"] if item["cutoff"]]
    window = result["window"]["start"], result["days"][-1]["date"]
    lines = [f"{DEVICE} 周掘进进度 · {window[0]} 至 {window[1]}"]
    if observed:
        advance = totals["advance"]
        stops = totals["downtime_seconds"]
        if advance is not None:
            lines.append(f"新增掘进估算 {advance:.2f}（桩号量，单位待确认）")
        if stops is not None:
            lines.append(f"累计估算停机 {stops:,} 秒")
        lines.append(f"实测覆盖 {len(observed)} 天")
    else:
        lines.append("本周无可用实测记录。")
    chart = result["chart"]
    if chart["status"] == "generated":
        chart["path"] = Path(chart["path"]).as_posix()
        lines.append(f"\n![周掘进进度图](<{chart['path']}>)")
    elif chart["status"] == "failed":
        lines.append(f"周进度图生成失败 · {chart['error']}")
    return tool_result(result, display_text="\n".join(lines))


def daily_query(arguments, data_dir, output_dir):
    if not isinstance(arguments, dict) or arguments.keys() - DAILY_TOOL["inputSchema"]["properties"].keys():
        return tool_error("invalid_arguments", "请传入已声明的日报参数。")
    if "week_of" in arguments:
        return weekly_query(arguments, data_dir, output_dir)
    if "date" in arguments and not isinstance(arguments["date"], str):
        return tool_error("invalid_arguments", "date 须为 YYYY-MM-DD 格式的字符串。")
    if "relative_day" in arguments and not isinstance(arguments["relative_day"], str):
        return tool_error("invalid_arguments", "relative_day 须为 today 或 yesterday。")
    scope = arguments.get("scope", "summary")
    include_chart = arguments.get("include_chart", scope == "progress")
    if not isinstance(include_chart, bool):
        return tool_error("invalid_arguments", "include_chart 须为布尔值。")
    result, code = run_daily(data_dir, arguments.get("device", DEVICE), arguments.get("date"),
                             arguments.get("relative_day"), scope,
                             output_dir if include_chart else None)
    display = daily_details(result) if result["status"] == "ok" else None
    if code not in (0, 5):
        display = f"{result['status']} · {result['error']['message']}"
    chart = result.get("chart")
    if chart and chart["status"] == "generated":
        chart["path"] = Path(chart["path"]).as_posix()
        display = f"{display}\n\n![全天掘进进度图](<{chart['path']}>)"
    elif chart:
        display = f"{display or ''}\n进度图未生成。"
    return tool_result(result, is_error=code not in (0, 5), display_text=display)


def daily_details(result):
    progress, stop, source = result.get("progress"), result.get("downtime"), result["evidence"]
    lines = []
    if progress is not None:
        excavation = progress["excavation"]
        change = "无法判定" if excavation["value"] is None else str(excavation["value"])
        if excavation["value"] == 0 and excavation["activity"]["records"]:
            change += "（有掘进工况，桩号未显示新增前缘）"
        jumps = len(progress["suspect_jumps"])
        if jumps and excavation["value"] is not None:
            change += f"（含 {jumps} 处待核对的桩号阶跃）"
        if excavation["activity_after_frontier"]:
            change += "（最远桩号确认后仍观测到掘进工况）"
        lines.append(f"{excavation['label']} {change}")
    if stop is not None:
        seconds = stop["seconds"]
        duration = "无法判定" if seconds is None else f"{seconds // 3600} 小时 {seconds % 3600 // 60} 分 {seconds % 60} 秒"
        if stop["unobserved_intervals"] and seconds is not None:
            duration += "，仅覆盖可判定区间，缺测未计入"
        lines.append(f"累计停机时长（{stop['label']}） {duration}")
    lines.extend([
        f"统计截止时间 {result['cutoff'].replace('T', ' ')}",
        "",
        f"现场统计日期 {result['date']}" + ("（最新实测归档日）" if result["date_mode"] == "latest_observed" else ""),
        f"来源 {source['zip']} / {source['txt']}，第 {source['physical_line_start']}–{source['physical_line_end']} 行",
    ])
    if progress is not None:
        excavation = progress["excavation"]
        for key, label in (("baseline", "前缘计算基准"), ("farthest", "当天最远稳定桩号")):
            endpoint = excavation[key]
            if endpoint is not None:
                location = f"{endpoint['zip']} " if "zip" in endpoint else ""
                lines.append(f"{label} {endpoint['chainage']}（{location}第 {endpoint['line_start']} 行）")
        lines.append(f"刀盘转速、扭矩和总推进力同时为正的现场秒数 {excavation['activity']['records']}。")
        if progress["raw_difference"] is not None:
            lines.append(f"首末原始桩号差（净位置变化） {progress['raw_difference']}")
        for key, label in (("start", "起始桩号"), ("end", "结束桩号")):
            endpoint = progress[key]
            if endpoint is not None:
                lines.append(f"{label} {endpoint['chainage']}，第 {endpoint['line_start']} 行（桩号，第 3 列）")
    if stop is None:
        return "\n".join(lines)
    lines.extend(["", "停机区间",
                  f"判定依据为连续至少 {stop['minimum_stop_seconds']} 秒刀盘转速、刀盘功率、"
                  "总推进力及十路主驱动频率均为零。"])
    reasons = {"activity_resumed": "观察到信号恢复活动", "coverage_break": "缺测截断"}
    for item in stop["intervals"]:
        evidence = item["evidence"]
        reason = item["end_label"] or reasons[item["end_reason"]]
        lines.append(f"{item['start']} 至 {item['end']}，{item['seconds']} 秒，{reason}"
                     f"（第 {evidence['start']['line_start']}–{evidence['end']['line_end']} 行）")
    if stop["unobserved_intervals"]:
        lines.extend(["", "未计入停机的覆盖缺口"])
    for gap in stop["unobserved_intervals"]:
        if "missing_record_start" in gap:
            lines.append(f"{gap['missing_record_start']} 至 {gap['end']}（不含结束时刻）"
                         f"无记录，共 {gap['missing_record_seconds']} 秒。")
        else:
            lines.append(f"{gap['start']} 至 {gap['end']} 缺少可判定的 PLC 信号。")
    return "\n".join(lines)


def archive_day(path):
    match = ARCHIVE_NAME.fullmatch(path.name)
    if match is not None and path.is_file():
        try:
            return datetime.strptime(match[1], "%Y%m%d")
        except ValueError:
            pass
    return None


def latest_window(data_dir, minutes):
    archives = []
    for path in data_dir.iterdir():
        day = archive_day(path)
        if day is not None:
            archives.append((day, path))
    for day, path in sorted(archives, reverse=True):
        records, _ = read_records(path, f"{path.stem}.txt", day, day + timedelta(days=1), None)
        if records:
            latest = records[-1].timestamp
            end = latest + timedelta(seconds=1)
            start = max(day, end - timedelta(minutes=minutes))
            context = {
                "mode": "latest",
                "requested_minutes": minutes,
                "latest_observed": latest.isoformat(),
                "latest_source": path.name,
                "latest_physical_line": records[-1].line,
                "clipped_to_archive_day": start == day and end - start < timedelta(minutes=minutes),
            }
            return start.strftime(TIME_FORMAT), end.strftime(TIME_FORMAT), context
    raise FileNotFoundError(f"No archive contains CREC188 runtime records in {data_dir}")


def query(arguments, data_dir, output_dir):
    if not isinstance(arguments, dict) or arguments.keys() - TOOL["inputSchema"]["properties"].keys():
        return tool_error("invalid_arguments", "请传入已声明的查询参数。")
    device = arguments.get("device", DEVICE)
    if device != DEVICE:
        return tool_error("invalid_arguments", f"仅支持设备 {DEVICE}。")
    metrics = arguments.get("metrics", [])
    if not isinstance(metrics, list) or any(not isinstance(metric, str) or not metric for metric in metrics):
        return tool_error("invalid_arguments", "metrics 必须是 PLC 表头名称数组。")

    window_fields = {"start", "end"} & arguments.keys()
    if window_fields and (
        window_fields != {"start", "end"}
        or not all(isinstance(arguments[field], str) and arguments[field] for field in window_fields)
        or "latest_minutes" in arguments
    ):
        return tool_error("invalid_arguments", "请同时提供 start 和 end，或只提供 latest_minutes。")

    if window_fields:
        start, end = arguments["start"], arguments["end"]
        context = {"mode": "explicit"}
    else:
        minutes = arguments.get("latest_minutes", DEFAULT_MINUTES)
        if type(minutes) is not int or not 1 <= minutes <= 1440:
            return tool_error("invalid_arguments", "latest_minutes 必须是 1 至 1440 的整数。")
        try:
            start, end, context = latest_window(data_dir, minutes)
        except (StructureError, UnicodeError) as error:
            return tool_error("data_structure_error", f"读取最新归档失败：{error}")
        except (OSError, BadZipFile, EOFError, KeyError, RuntimeError, zlib.error) as error:
            return tool_error("source_unreadable", f"读取最新归档失败：{error}")

    command = [
        sys.executable, "-X", "utf8", str(CLI), f"--data-dir={data_dir}", f"--output-dir={output_dir}",
        f"--device={device}", f"--start={start}", f"--end={end}",
    ]
    command.extend(f"--metric={metric}" for metric in metrics)
    try:
        completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", timeout=90)
    except subprocess.TimeoutExpired:
        return tool_error("query_timeout", "工程查询超过 90 秒。")
    except OSError as error:
        return tool_error("query_failed", str(error))
    try:
        result = json.loads(completed.stdout)
    except ValueError:
        return tool_error("query_failed", "工程工具未返回有效 JSON。")
    if not isinstance(result, dict) or not isinstance(result.get("status"), str):
        return tool_error("query_failed", "工程工具未返回有效结果对象。")
    result["query_context"] = context
    chart = result.get("chart")
    if isinstance(chart, dict) and isinstance(chart.get("path"), str):
        chart["path"] = Path(chart["path"]).as_posix()
    failed = completed.returncode != 0 and result["status"] != "chart_generation_failed"
    return tool_result(result, is_error=failed)


def rpc_response(request_id, *, result=None, code=None, message=None):
    reply = {"jsonrpc": "2.0", "id": request_id}
    if code is None:
        reply["result"] = result
    else:
        reply["error"] = {"code": code, "message": message}
    return reply


def dispatch(request, data_dir, output_dir, cutter_source=cutters.DEFAULT_SOURCE):
    if not isinstance(request, dict) or request.get("jsonrpc") != "2.0" or not isinstance(request.get("method"), str):
        return rpc_response(None, code=-32600, message="Invalid request")
    if "id" not in request:
        return None
    request_id = request["id"]
    method = request["method"]
    if method == "initialize":
        return rpc_response(request_id, result={
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "tbm-insight", "version": "1.0.0"},
        })
    if method == "ping":
        return rpc_response(request_id, result={})
    if method == "tools/list":
        return rpc_response(request_id, result={"tools": [TOOL, DAILY_TOOL, LIMITS_TOOL, CUTTER_TOOL]})
    if method == "tools/call":
        params = request.get("params")
        if isinstance(params, dict):
            arguments = params.get("arguments", {})
            selected = params.get("name")
            if (selected == CUTTER_TOOL["name"] and cutter_source is None
                    or selected in (TOOL["name"], DAILY_TOOL["name"], LIMITS_TOOL["name"]) and data_dir is None):
                return rpc_response(request_id, result={"isError": True, "content": [
                    {"type": "text", "text": "请先在「设置 → 工程数据」配置对应数据源。"}]})
            if params.get("name") == CUTTER_TOOL["name"]:
                return rpc_response(request_id, result=cutter_query(arguments, cutter_source, output_dir))
            if params.get("name") == LIMITS_TOOL["name"]:
                return rpc_response(request_id, result=limits_query(arguments, data_dir, output_dir))
            if params.get("name") == DAILY_TOOL["name"]:
                return rpc_response(request_id, result=daily_query(arguments, data_dir, output_dir))
            if params.get("name") == TOOL["name"]:
                return rpc_response(request_id, result=query(arguments, data_dir, output_dir))
        return rpc_response(request_id, code=-32602, message="Unknown tool")
    return rpc_response(request_id, code=-32601, message="Method not found")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--cutter-source", type=Path)
    args = parser.parse_args()
    output_dir = args.output_dir.resolve()
    for line in sys.stdin.buffer:
        try:
            request = json.loads(line)
        except (UnicodeError, ValueError):
            reply = rpc_response(None, code=-32700, message="Parse error")
        else:
            data = source_path("dataDir", args.data_dir)
            ledger = source_path("cutterSource", args.cutter_source)
            reply = dispatch(request, data, output_dir, ledger)
        if reply is not None:
            print(json.dumps(reply, ensure_ascii=True, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
