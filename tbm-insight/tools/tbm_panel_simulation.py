"""Generate a deterministic seven-day demonstration without reading PLC archives."""

from collections import Counter
from datetime import date, datetime, time, timedelta
from math import sin

import tbm_cutter_changes as cutters
import tbm_daily_summary as daily
import tbm_insight as plc
import tbm_limits as limits


WEEK_START = date(2026, 11, 9)
WEEK_END = WEEK_START + timedelta(days=7)
DEFAULT_DAY = WEEK_START + timedelta(days=1)
SCENARIO = "CREC188 演示模拟 v1"
DAILY_PLAN_METRES = (8.0, 8.6, 8.8, 9.0, 9.2, 9.5, 10.0)
BASE_FIELDS = {name: (key, name, column) for key, name, column in plc.DEFAULT_METRICS}
BASE_FIELDS.update({name: (name, name, column) for _, *fields in limits.POINTS.values() for name, column in fields})
BASE_FIELDS.update({daily.CHAINAGE: (daily.CHAINAGE, daily.CHAINAGE, 3),
                    "刀盘功率": ("刀盘功率", "刀盘功率", 129)})
BASE_FIELDS.update({name: (name, name, 93 + i) for i, name in enumerate(daily.STOP_FIELDS[3:])})
SIM_STOP_FIELDS = [daily.CHAINAGE, *daily.STOP_FIELDS, "刀盘扭矩"]


def pause_schedule(offset):
    return 1700 + offset * 90, 300 + offset * 30


def sample_records(day, start, end, names):
    metrics = tuple(BASE_FIELDS[name] for name in dict.fromkeys(names))
    if not WEEK_START <= day < WEEK_END:
        return [], metrics
    offset = (day - WEEK_START).days
    shift_start = datetime.combine(day, time(8))
    stop_start, stop_length = pause_schedule(offset)
    records = []
    for elapsed in range(7200):
        stamp = shift_start + timedelta(seconds=elapsed)
        if not start <= stamp < end or 2810 <= elapsed < 2820:
            continue
        active = 120 <= elapsed < 6900 and not stop_start <= elapsed < stop_start + stop_length
        active_elapsed = max(0, min(elapsed, 6900) - 120) - max(0, min(elapsed - stop_start, stop_length))
        rpm = 4.6 + .3 * sin(elapsed / 61) if active else 0.0
        torque = 820 + 90 * sin(elapsed / 52) if active else 0.0
        thrust = 7800 + 410 * sin(elapsed / 89) if active else 0.0
        row = {
            "桩号": round(4100 - 9 * offset - active_elapsed * (.0012 + .00008 * offset), 4),
            "刀盘转速": rpm, "刀盘扭矩": torque, "总推进力": thrust,
            "刀盘功率": torque * rpm * .10472,
            "主液压油箱温度": 48 + 31 * max(0, 1 - abs(elapsed - 3600) / 1500) + .2 * sin(elapsed / 85),
            "液压油箱温度预警设置": 60.0, "液压油箱温度报警设置": 75.0,
            "齿轮油温度": 46 + 11 * max(0, 1 - abs(elapsed - 4900) / 1700),
            "齿轮油温度预警设置": 55.0, "齿轮油温度报警设置": 65.0,
        }
        row.update({field: rpm * 6.5 for field in daily.STOP_FIELDS[3:]})
        records.append(plc.Record(stamp, elapsed + 1, tuple(row[name] for _, name, _ in metrics)))
    return records, metrics


def source_evidence(records):
    return {"source_kind": "synthetic", "name": SCENARIO, "index_kind": "scenario_sample",
            "physical_line_start": records[0].line if records else None,
            "physical_line_end": records[-1].line if records else None}


def simulated_day(day):
    midnight = datetime.combine(day, time.min)
    records, metrics = sample_records(day, midnight, midnight + timedelta(days=1), SIM_STOP_FIELDS)
    samples = list(daily.samples_by_second(records))
    quality = []
    movement = daily.progress(samples, quality)
    farthest = daily.stable_frontier(samples)
    baseline = movement["start"]
    advance = round(max(0, baseline["chainage"] - farthest["chainage"]), 4) if baseline and farthest else None
    active = list(daily.excavation_observations(samples, metrics))
    movement["excavation"] = {
        "label": "模拟新增掘进（m）", "value": advance, "unit": "m", "advance_m": advance,
        "method": "synthetic_stable_chainage_frontier", "baseline": baseline, "farthest": farthest,
        "activity": {"records": len(active), "first": daily.point(active[0]) if active else None,
                     "last": daily.point(active[-1]) if active else None},
    }
    downtime = daily.downtime(samples, midnight, quality) if samples else {
        "seconds": None, "classified_seconds": 0, "intervals": [], "unobserved_intervals": []}
    downtime["label"] = "模拟停机估算"
    if records:
        shift_start = midnight.replace(hour=8)
        pause_start, _ = pause_schedule((day - WEEK_START).days)
        scenario_reasons = {shift_start.isoformat(): "模拟班前准备",
                            (shift_start + timedelta(seconds=pause_start)).isoformat(): "模拟运输带巡检",
                            (shift_start + timedelta(seconds=6900)).isoformat(): "模拟班末停机"}
        for interval in downtime["intervals"]:
            if interval["start"] in scenario_reasons:
                interval.update(reason=scenario_reasons[interval["start"]], reason_status="simulation_scenario")
    planned = DAILY_PLAN_METRES[(day - WEEK_START).days] if records else None
    ratio = advance / planned if advance is not None and planned else None
    shifts = [{"name": "模拟早班", "start": midnight.replace(hour=8).isoformat(),
               "end": midnight.replace(hour=10).isoformat(), "planned_advance": planned, "advance": advance,
               "completion_ratio": ratio, "downtime_seconds": downtime["seconds"],
               "classified_seconds": downtime["classified_seconds"]}] if records else []
    return {"status": "ok" if records else "empty_day", "date": day.isoformat(), "device": plc.DEVICE,
            "day_start": midnight.isoformat(), "cutoff": records[-1].timestamp.isoformat() if records else None,
            "record_count": len(records), "progress": movement, "downtime": downtime,
            "planned_advance": planned, "completion_ratio": ratio, "shifts": shifts,
            "distribution": daily.observed_time_distribution(samples, metrics, midnight, downtime),
            "evidence": source_evidence(records), "data_quality": quality}


def simulated_limits(day, start, end, names):
    supported = [name for name in names if name in limits.POINTS]
    fields = [name for measure in supported for name, _ in limits.POINTS[measure][1:]]
    records, _ = sample_records(day, start, end, fields)
    samples = list(daily.samples_by_second(records))
    points = []
    for index, name in enumerate(supported):
        component, point, warning, alarm = limits.POINTS[name]
        rules = [limits.rule(plc.DEVICE, component, point, setting, level)
                 for setting, level in ((warning, "warning"), (alarm, "alarm"))]
        for rule in rules:
            rule["applicability"] = "演示模拟数据设定，不对应实际 PLC 报警"
            rule["source"]["kind"] = "synthetic_setpoint"
        result = limits.evaluate_point(records, samples, index, rules)
        for event in result["events"]:
            event["end_label"] = limits.END_REASONS[event["end_reason"]]
        points.append(result)
    events = [event for point in points for event in point["events"]]
    priority = max(events, key=lambda item: (item["level"] == "alarm", item["max_excess"], item["duration_seconds"]), default=None)
    return {"status": "ok" if records else "empty_window", "date": day.isoformat(),
            "window": {"start": start.isoformat(), "end": end.isoformat(), "bounds": "[start,end)"},
            "actual_start": records[0].timestamp.isoformat() if records else None,
            "actual_end": records[-1].timestamp.isoformat() if records else None, "record_count": len(records),
            "coverage": {"observed_seconds": len(samples), "duplicate_records": 0,
                         "missing_seconds": (end - start) // plc.SECOND - len(samples)},
            "points": points, "priority_event": priority, "highest_level": priority["level"] if priority else None,
            "missing_limits": [{"point": name, "status": "missing_applicable_limit", "label": "缺少模拟限值",
                                "required_evidence": "独立模拟设定"} for name in names if name not in supported],
            "equipment_impact": {"plc_alarm_triggered": None, "protection_triggered": None, "damage_confirmed": None},
            "evidence": source_evidence(records), "chart": {"status": "not_requested", "path": None},
            "report": {"status": "not_requested", "path": None}}


# Each tuple represents an independently authored fictional ledger row.
SIMULATED_LEDGER = (
    (0, (49, 50), "正常磨损"), (0, (54,), "正常磨损"), (1, (49,), "弦磨"),
    (1, (49,), "正常磨损"), (1, (48, 51), "正常磨损"), (2, (46,), "刀圈断裂"),
    (3, (50, 51), "正常磨损"), (3, (49,), "弦磨"), (4, (52,), "正常磨损"),
    (5, (6, 8), "弦磨"), (6, (53, 54), "正常磨损"), (6, (49,), "正常磨损"),
)


def simulated_cutters(start, end, positions, reasons):
    details = []
    position_filter = set(positions or [])
    reason_filter = {cutters.reason(reason) for reason in reasons or []}
    for index, (day, knives, reason) in enumerate(SIMULATED_LEDGER, start=1):
        stamp = WEEK_START + timedelta(days=day)
        if not start <= stamp < end or (reason_filter and reason not in reason_filter):
            continue
        for knife in knives:
            if position_filter and knife not in position_filter:
                continue
            details.append({"date": stamp.isoformat(), "position": knife, "reason": reason, "reason_raw": reason,
                            "excel_row": index, "record_id": f"simulation:{index}", "entry_id": f"simulation:{index}/{knife}",
                            "old_body_id": None, "new_body_id": None, "state_raw": {"scenario": SCENARIO},
                            "chainage_raw": None, "original_wear": {"status": "missing", "raw": None, "value": None},
                            "raw_cells": {column: {"value": reason if column == "D" else None} for column in "CDEFGHIJM"}})
    counts = Counter(item["position"] for item in details)
    ranking = []
    for position, count in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
        selected = [item for item in details if item["position"] == position]
        ranking.append({"position": position, "count": count,
                        "reasons": dict(Counter(item["reason"] for item in selected)),
                        "entry_ids": [item["entry_id"] for item in selected]})
    outside = end <= WEEK_START or start >= WEEK_END
    coverage = "none" if outside else "partial" if start < WEEK_START or end > WEEK_END else "within_ledger"
    note = f"模拟 {ranking[0]['position']} 号刀位记录最多，处理 {ranking[0]['count']} 次。" if ranking else "所查模拟时段没有匹配记录。"
    repeated, suspected = cutters.repeated_groups(details)
    return {
        "status": "not_covered" if outside else "ok" if details else "no_matches", "device": plc.DEVICE,
        "scenario": SCENARIO, "window": {"start": start.isoformat(), "end": end.isoformat(), "bounds": "[start,end)"},
        "ledger_cutoff": (WEEK_END - timedelta(days=1)).isoformat(),
        "coverage": {"status": coverage, "message": "模拟台账仅覆盖演示周。" if coverage != "within_ledger" else None},
        "summary": {"raw_record_count": len({item["record_id"] for item in details}),
                    "position_treatment_count": len(details), "distinct_position_count": len(ranking)},
        "details": details, "ranking": ranking, "review_note": note,
        "reasons": [{"reason": reason, "count": count} for reason, count in Counter(item["reason"] for item in details).most_common()],
        "quality": {"date_unassigned": [], "unparsed_positions": [], "possible_duplicates": suspected,
                    "same_day_repeated_positions": repeated},
        "source": {"source_kind": "synthetic", "file": SCENARIO, "sheet": "模拟台账", "index_kind": "scenario_row"},
        "charts": {name: {"status": "not_requested", "path": None} for name in ("positions", "events")},
        "report": {"status": "not_requested", "path": None},
    }
