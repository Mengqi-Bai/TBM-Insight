"""Summarize CREC188 daily chainage change and observed PLC downtime."""

import argparse
from datetime import date, datetime, time, timedelta
from itertools import groupby
import json
from pathlib import Path
import re
from statistics import median
import sys
from zipfile import BadZipFile
import zlib

from tbm_insight import DEVICE, SECOND, StructureError, read_records
from tbm_figure import (COLORS, LABELS, STYLE, chart_arrays, clock_axis, figure_data, legend,
                        metric, new_figure, observed_seconds, save_png, title)


from tbm_data_sources import HOME, source_path

DEFAULT_DATA = source_path("dataDir", None) or HOME / "unset-plc"
CHAINAGE = "桩号"
STOP_FIELDS = ("刀盘转速", "刀盘功率", "总推进力", *(
    f"主驱动{index}#电机输出频率" for index in range(1, 11)
))
STOP_MIN_SECONDS = 5
ADVANCE_FIELDS = ("刀盘转速", "刀盘扭矩", "总推进力")
FRONTIER_CONFIRM_SECONDS = 3
ENDPOINT_SAMPLES = 5
# Diagnostic threshold in raw chainage values, not a calibrated speed limit.
JUMP_REVIEW_THRESHOLD = 1.0
RULE_VERSION = "crec188-daily-plc-3"
SCOPES = ("summary", "progress", "downtime")
STOP_LABEL = "PLC 估算停机时长"
PROGRESS_LABEL = "桩号变化量，单位待确认"


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError(message)


def load_day(data_dir, requested_day, scope):
    if requested_day is not None:
        candidates = [(requested_day, data_dir / f"{DEVICE}_{requested_day:%Y%m%d}.zip")]
    else:
        candidates = []
        for path in data_dir.iterdir():
            match = re.fullmatch(rf"{DEVICE}_([0-9]{{8}})\.zip", path.name)
            if match and path.is_file():
                try:
                    candidates.append((datetime.strptime(match[1], "%Y%m%d").date(), path))
                except ValueError:
                    continue
        candidates.sort(reverse=True)
    if not candidates:
        raise FileNotFoundError(f"No {DEVICE} daily archives in {data_dir}")
    latest_empty = None
    for day, archive in candidates:
        start = datetime.combine(day, time.min)
        member = f"{archive.stem}.txt"
        try:
            fields = {
                "chainage": [CHAINAGE],
                "progress": [CHAINAGE, *ADVANCE_FIELDS],
                "summary": [CHAINAGE, *STOP_FIELDS, "刀盘扭矩"],
                "downtime": [CHAINAGE, *STOP_FIELDS],
            }[scope]
            records, metrics = read_records(archive, member, start, start + timedelta(days=1), fields)
        except (StructureError, UnicodeError, OSError, BadZipFile, EOFError, KeyError,
                RuntimeError, zlib.error) as error:
            error.archive_name = archive.name
            raise
        loaded = (day, archive.name, member, records, metrics)
        if records or requested_day is not None:
            return loaded
        if latest_empty is None:
            latest_empty = loaded
    return latest_empty


def samples_by_second(records):
    return observed_seconds(records)


def point(sample):
    return {"time": sample[0].isoformat(), "line_start": sample[1], "line_end": sample[2]}


def frontier_updates(samples):
    best = None
    for left, middle, right in zip(samples, samples[1:], samples[2:]):
        window = (left, middle, right)
        if right[0] - left[0] != (FRONTIER_CONFIRM_SECONDS - 1) * SECOND:
            continue
        if any(sample[3][0] is None for sample in window):
            continue
        # Every sample in the window must have reached at least this chainage.
        reached = max(window, key=lambda sample: sample[3][0])
        chainage = reached[3][0]
        if best is None or chainage < best["chainage"]:
            best = {**point(reached), "chainage": chainage, "confirmed_through": point(right)}
            yield best


def stable_frontier(samples):
    return min(frontier_updates(samples), key=lambda item: item["chainage"], default=None)


def excavation_observations(samples, metrics):
    indices = [index for index, (_, name, _) in enumerate(metrics) if name in ADVANCE_FIELDS]
    for sample in samples:
        signals = [sample[3][index] for index in indices]
        if all(value is not None and value > 0 for value in signals):
            yield sample


def excavation(samples, metrics, day, data_dir, observed_start, quality, previous_frontier=None):
    farthest = stable_frontier(samples)
    previous = previous_frontier if observed_start is not None else None
    # If the machine started the day behind yesterday's frontier, exclude that retrace.
    if previous is None and day > date.min and observed_start is not None:
        previous_day = day - timedelta(days=1)
        try:
            _, archive, member, rows, _ = load_day(data_dir, previous_day, "chainage")
            previous = stable_frontier(list(samples_by_second(rows)))
            if previous is not None:
                previous.update(zip=archive, txt=member)
        except (StructureError, UnicodeError, OSError, BadZipFile, EOFError, KeyError, RuntimeError, zlib.error):
            pass
    if previous is None and observed_start is not None:
        quality.append({"code": "previous_frontier_unavailable",
                        "message": "以前一日可复核前缘为优先基准，本次使用当天起始桩号。"})
    baseline = observed_start
    if previous is not None and previous["chainage"] < baseline["chainage"]:
        baseline = previous

    active = list(excavation_observations(samples, metrics))
    activity = {"records": len(active), "first": point(active[0]) if active else None,
                "last": point(active[-1]) if active else None,
                "fields": [{"field": name, "column": column} for _, name, column in metrics
                           if name in ADVANCE_FIELDS]}
    value = None
    movement = None
    if baseline is not None and farthest is not None:
        movement = max(0, baseline["chainage"] - farthest["chainage"])
        if movement == 0 or active:
            value = movement
        else:
            quality.append({"code": "frontier_advance_without_excavation_signals"})
    activity_after_frontier = bool(farthest and active and
                                   activity["last"]["time"] > farthest["confirmed_through"]["time"])
    if activity_after_frontier:
        quality.append({"code": "excavation_activity_after_frontier",
                        "last_activity": activity["last"], "frontier": farthest})
    return {"label": "新增掘进估算（桩号量，单位待确认）", "value": value, "unit": None,
            "advance_m": None, "method": "stable_decreasing_chainage_frontier",
            "baseline": baseline, "previous_day_frontier": previous, "farthest": farthest,
            "raw_frontier_extension": movement, "activity": activity,
            "activity_after_frontier": activity_after_frontier,
            "confirmation_samples": FRONTIER_CONFIRM_SECONDS}


def progress(samples, quality):
    valid = [sample for sample in samples if sample[3][0] is not None]
    result = {"label": PROGRESS_LABEL, "value": None, "unit": None, "net_advance_m": None,
              "raw_difference": None, "direction": "decreasing_observed_unverified",
              "start": None, "end": None, "raw_start": None, "raw_end": None,
              "suspect_jumps": []}
    if not valid:
        quality.append({"code": "chainage_unavailable"})
        return result
    result["raw_difference"] = valid[-1][3][0] - valid[0][3][0]
    for key, endpoint, neighbors in (("start", valid[0], valid[:ENDPOINT_SAMPLES]),
                                      ("end", valid[-1], valid[-ENDPOINT_SAMPLES:])):
        raw = endpoint[3][0]
        consecutive = (len(neighbors) == ENDPOINT_SAMPLES and
                       neighbors[-1][0] - neighbors[0][0] == (ENDPOINT_SAMPLES - 1) * SECOND)
        # A short, locally stable baseline can reject an isolated endpoint excursion.
        values = [sample[3][0] for sample in neighbors]
        baseline = median(values)
        stabilized = consecutive and values.count(baseline) >= 3 and baseline != raw
        result[f"raw_{key}"] = {**point(endpoint), "chainage": raw}
        result[key] = {**point(endpoint), "chainage": baseline if stabilized else raw}
        if stabilized:
            result[key]["support"] = [point(neighbors[0]), point(neighbors[-1])]
            quality.append({"code": "chainage_endpoint_stabilized", "endpoint": key})

    for index, (left, right) in enumerate(zip(valid, valid[1:])):
        change = right[3][0] - left[3][0]
        if abs(change) < JUMP_REVIEW_THRESHOLD:
            continue
        # Opposite large steps that return to the same value in two seconds are transient.
        transient = any(
            later[3][0] == left[3][0] and later[0] - right[0] <= 2 * SECOND
            for later in valid[index + 2:index + 4]
        ) or any(
            earlier[3][0] == right[3][0] and left[0] - earlier[0] <= 2 * SECOND
            for earlier in valid[max(0, index - 2):index]
        )
        endpoint_adjusted = (
            index == 0 and "support" in result["start"]
            or index == len(valid) - 2 and "support" in result["end"]
        )
        if not transient and not endpoint_adjusted:
            result["suspect_jumps"].append({"before": point(left), "after": point(right),
                                            "raw_change": change})
    if result["suspect_jumps"]:
        quality.append({"code": "chainage_discontinuity_review", "count": len(result["suspect_jumps"])})
    if len(valid) >= 2:
        result["value"] = result["end"]["chainage"] - result["start"]["chainage"]
    if len(valid) < 2 or valid[0] != samples[0] or valid[-1] != samples[-1]:
        quality.append({"code": "chainage_endpoint_coverage", "first": point(valid[0]),
                        "last": point(valid[-1])})
    return result


def plc_state(sample):
    values = sample[3][1:1 + len(STOP_FIELDS)]
    if any(value is not None and value != 0 for value in values):
        return "activity"
    return "unknown" if None in values else "zero"


def downtime(samples, midnight, quality):
    intervals = []
    unknowns = []
    confirmed_seconds = 0
    start = None
    previous = samples[0]
    previous_state = plc_state(previous)
    if previous[0] > midnight:
        unknowns.append({"code": "no_records_since_midnight", "start": midnight.isoformat(),
                         "end": previous[0].isoformat(), "after": point(previous),
                         "missing_record_start": midnight.isoformat(),
                         "missing_record_seconds": (previous[0] - midnight) // SECOND})
    if previous_state == "zero":
        start = previous

    def finish(end, last_zero, reason):
        seconds = (end[0] - start[0]) // SECOND
        if seconds >= STOP_MIN_SECONDS:
            intervals.append({"start": start[0].isoformat(), "end": end[0].isoformat(),
                              "seconds": seconds, "end_reason": reason,
                              "still_stopped": reason == "cutoff",
                              "end_label": "截至统计时仍未恢复" if reason == "cutoff" else None,
                              "basis": "all_stop_signals_zero",
                              "evidence": {"start": point(start), "last_zero": point(last_zero),
                                           "end": point(end)}})

    for current in samples[1:]:
        state = plc_state(current)
        contiguous = current[0] - previous[0] == SECOND
        known = contiguous and previous_state != "unknown" and state != "unknown"
        if known:
            confirmed_seconds += 1
        else:
            code = "missing_records" if not contiguous else "missing_stop_signals"
            if contiguous and unknowns and unknowns[-1]["code"] == code and unknowns[-1]["end"] == previous[0].isoformat():
                unknowns[-1].update(end=current[0].isoformat(), after=point(current))
            else:
                unknown = {"code": code, "start": previous[0].isoformat(),
                           "end": current[0].isoformat(), "before": point(previous),
                           "after": point(current)}
                if not contiguous:
                    unknown["missing_record_start"] = (previous[0] + SECOND).isoformat()
                    unknown["missing_record_seconds"] = (current[0] - previous[0]) // SECOND - 1
                unknowns.append(unknown)
        if start is not None and (not known or state != "zero"):
            finish(current if known else previous, previous,
                   "activity_resumed" if known else "coverage_break")
            start = None
        if start is None and state == "zero":
            start = current
        previous, previous_state = current, state
    if start is not None:
        finish(previous, previous, "cutoff")
    if unknowns:
        quality.append({"code": "downtime_partial_coverage", "count": len(unknowns),
                        "message": "累计停机时长仅覆盖可判定区间。"})
    return {"label": STOP_LABEL, "seconds": sum(item["seconds"] for item in intervals)
            if confirmed_seconds else None, "classified_seconds": confirmed_seconds,
            "minimum_stop_seconds": STOP_MIN_SECONDS, "intervals": intervals,
            "unobserved_intervals": unknowns}


def distribution_summary(denominator, excavating, stopped, other, undetermined, running):
    categories = {"excavating": excavating, "stopped": stopped, "other": other, "undetermined": undetermined}
    return {"denominator_seconds": denominator, "denominator_basis": "各日现场零点至最后一条实测，截止后不外推",
            **{f"{name}_seconds": seconds for name, seconds in categories.items()}, "running_seconds": running,
            "fractions": {name: seconds / denominator if denominator else None for name, seconds in categories.items()}}


def observed_time_distribution(samples, metrics, midnight, stop):
    if not samples:
        return None
    indices = [index for index, (_, name, _) in enumerate(metrics) if name in ADVANCE_FIELDS]
    if len(indices) != len(ADVANCE_FIELDS):
        raise ValueError("Time distribution requires the excavation and downtime PLC fields")
    excavating = running = ambiguous = 0
    previous = samples[0]
    previous_state = plc_state(previous)
    for current in samples[1:]:
        state = plc_state(current)
        if current[0] - previous[0] == SECOND and previous_state == "activity" and state != "unknown":
            running += 1
            signals = [previous[3][index] for index in indices]
            if all(value is not None and value > 0 for value in signals):
                excavating += 1
            elif all(value is None or value > 0 for value in signals):
                ambiguous += 1
        previous, previous_state = current, state
    denominator = (samples[-1][0] - midnight) // SECOND
    stopped = stop["seconds"] or 0
    classified = stop["classified_seconds"]
    return distribution_summary(denominator, excavating, stopped, classified - stopped - excavating - ambiguous,
                                denominator - classified + ambiguous, running)



def draw_progress_chart(samples, metrics, result, target, stop=None):
    baseline = result["progress"]["excavation"]["baseline"]["chainage"]
    active = {sample[0] for sample in excavation_observations(samples, metrics)}
    times, (positions, activity) = chart_arrays(
        ((stamp, (baseline - values[0] if values[0] is not None else None, int(stamp in active)))
         for stamp, _, _, values in samples), SECOND)
    frontier_times, frontier_values = [], []
    for reached in frontier_updates(samples):
        delta = max(0, baseline - reached["chainage"])
        if not frontier_times or delta > frontier_values[-1]:
            frontier_times.append(datetime.fromisoformat(reached["confirmed_through"]["time"]))
            frontier_values.append(delta)
    figure = new_figure(5.2, align_time=True)
    axis, strip = figure.subplots(2, 1, sharex=True, height_ratios=(5, 1.5))
    axis.plot(times, positions, color=COLORS["measured"], linewidth=STYLE["line_width"], label="相对桩号实测")
    if frontier_times:
        updates = dict(zip(frontier_times, frontier_values))
        frontier_rows = []
        confirmed = None
        for stamp, _, _, values in samples:
            confirmed = updates.get(stamp, confirmed)
            frontier_rows.append((stamp, (confirmed if values[0] is not None else None,)))
        x, (y,) = chart_arrays(frontier_rows, SECOND)
        axis.step(x, y, where="post", color=COLORS["estimated"], linestyle=STYLE["line_styles"]["estimated"],
                  linewidth=STYLE["line_width"], label="新增掘进估算")
        if frontier_values[-1] > 0:
            axis.annotate(f"{frontier_values[-1]:.2f}", (frontier_times[-1], frontier_values[-1]),
                          xytext=(-5, 8), textcoords="offset points", ha="right", color=COLORS["estimated"])
    axis.set_ylabel("桩号量\n单位待确认")
    axis.margins(y=.22)
    legend(axis, loc="upper left")
    strip.fill_between(times, activity, step="post", color=COLORS["excavating"], linewidth=0,
                       label="掘进信号")
    for index, interval in enumerate((stop or {}).get("intervals", [])):
        strip.axvspan(datetime.fromisoformat(interval["start"]), datetime.fromisoformat(interval["end"]),
                     ymax=1 / 1.95, color=COLORS["stopped"], alpha=.48, linewidth=0,
                     label=LABELS["stopped"] if index == 0 else None)
    strip.set_ylim(0, 1.95)
    strip.set_yticks([])
    strip.set_ylabel("作业状态")
    legend(strip, loc="upper left", ncol=2)
    start = datetime.fromisoformat(result["day_start"])
    clock_axis(strip, start, start + timedelta(days=1), seconds=False)
    title(figure, "日掘进进度", DEVICE, f"{result['date']}　截止 {times[-1]:%H:%M:%S}", result["record_count"])
    data = figure_data("daily_progress", DEVICE,
                       [metric("position", "相对桩号实测"), metric("advance", "新增掘进估算", estimated=True),
                        metric("downtime", LABELS["stopped"], "s", estimated=True)],
                       {"start": start, "end": start + timedelta(days=1), "bounds": "[start,end)"},
                       {"start": times[0], "end": times[-1]}, result["record_count"],
                       (stop or {}).get("unobserved_intervals", []),
                       {**result["evidence"], "stop_signals": [{"field": name, "column": column}
                        for _, name, column in metrics[1:] if name in STOP_FIELDS]})
    save_png(figure, target, data)
    return data


def query_daily(data_dir, requested_day=None, relative_day=None, scope="summary", output_dir=None, *,
                previous_frontier=None, include_distribution=False):
    latest_day = None
    if relative_day == "yesterday":
        latest_day, _, _, latest_records, _ = load_day(data_dir, None, "chainage")
        if not latest_records:
            raise FileNotFoundError(f"No {DEVICE} runtime records in {data_dir}")
        requested_day = latest_day - timedelta(days=1)
    try:
        day, archive, member, records, metrics = load_day(
            data_dir, requested_day, "summary" if output_dir is not None and scope == "progress" else scope)
    except FileNotFoundError as error:
        error.requested_day = requested_day
        error.latest_observed_date = latest_day
        raise
    midnight = datetime.combine(day, time.min)
    mode = "yesterday" if latest_day is not None else "explicit" if requested_day else "latest_observed"
    result = {
        "schema_version": "1.0.0", "rule_version": RULE_VERSION, "device": DEVICE,
        "status": "ok" if records else "empty_day",
        "date_mode": mode,
        "date": day.isoformat(), "day_start": midnight.isoformat(),
        "cutoff": records[-1].timestamp.isoformat() if records else None,
        "record_count": len(records), "data_quality": [],
        "evidence": {"zip": archive, "txt": member,
                     "physical_line_start": min((record.line for record in records), default=None),
                     "physical_line_end": max((record.line for record in records), default=None),
                     "runtime": {"field": "运行时间", "column": 2},
                     "chainage": {"field": CHAINAGE, "column": metrics[0][2]},
                     "stop_signals": [{"field": name, "column": column} for _, name, column in metrics[1:]
                                      if scope != "progress" and name in STOP_FIELDS]},
    }
    if latest_day is not None:
        result["latest_observed_date"] = latest_day.isoformat()
    samples = list(samples_by_second(records))
    if scope != "downtime":
        movement = progress(samples, result["data_quality"])
        result["progress"] = movement
        movement["excavation"] = excavation(samples, metrics, day, data_dir, movement["start"],
                                            result["data_quality"], previous_frontier)
    if scope != "progress":
        result["downtime"] = downtime(samples, midnight, result["data_quality"]) if samples else {
            "label": STOP_LABEL, "seconds": None, "intervals": [], "unobserved_intervals": [],
            "classified_seconds": 0, "minimum_stop_seconds": STOP_MIN_SECONDS,
        }
    if include_distribution:
        result["distribution"] = observed_time_distribution(samples, metrics, midnight, result["downtime"])
    if output_dir is not None:
        result["chart"] = {"status": "unavailable", "path": None}
        if samples and result["progress"]["excavation"]["baseline"] is not None:
            try:
                directory = output_dir.resolve()
                if directory.is_relative_to(data_dir.resolve()):
                    raise ValueError("--output-dir must be outside the read-only data directory")
                target = directory / f"{DEVICE}_{day:%Y%m%d}_daily_progress.png"
                stop = result.get("downtime") or downtime(samples, midnight, [])
                figure_metadata = draw_progress_chart(samples, metrics, result, target, stop)
                result["chart"] = {"status": "generated", "path": str(target),
                                   "sampling": "all_observed_seconds", "plotted_seconds": len(samples),
                                   "figure_data": figure_metadata}
            except Exception as error:
                result["chart"].update(status="failed", error=str(error))
    return result


def run_daily(data_dir, device, day_text=None, relative_day=None, scope="summary", output_dir=None, *,
              previous_frontier=None, include_distribution=False):
    try:
        if device != DEVICE:
            raise ValueError(f"Supported device: {DEVICE}")
        if relative_day not in (None, "today", "yesterday"):
            raise ValueError("Expected relative day today or yesterday")
        if day_text is not None and relative_day is not None:
            raise ValueError("Specify either date or relative day")
        if scope not in SCOPES:
            raise ValueError("Expected scope summary, progress or downtime")
        if include_distribution and scope != "summary":
            raise ValueError("Time distribution requires scope summary")
        if output_dir is not None and scope == "downtime":
            raise ValueError("The progress chart requires scope summary or progress")
        day = None
        if day_text is not None:
            if not isinstance(day_text, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", day_text):
                raise ValueError("Expected date YYYY-MM-DD")
            day = date.fromisoformat(day_text)
            if day == date.max:
                raise ValueError("Date is outside the supported range")
        result = query_daily(data_dir, day, relative_day, scope, output_dir, previous_frontier=previous_frontier,
                             include_distribution=include_distribution)
        return result, 5 if result.get("chart", {}).get("status") == "failed" else 0
    except (StructureError, UnicodeError) as error:
        return error_result("data_structure_error", error), 4
    except FileNotFoundError as error:
        missing_day = getattr(error, "requested_day", None)
        if missing_day is not None and getattr(error, "archive_name", None) and data_dir.is_dir():
            result = error_result("archive_missing", error)
            result["date"] = missing_day.isoformat()
            result["error"]["message"] = f"{missing_day.isoformat()} 无归档（{error.archive_name}）。"
            if error.latest_observed_date is not None:
                result["latest_observed_date"] = error.latest_observed_date.isoformat()
            return result, 3
        return error_result("source_unreadable", error), 3
    except (OSError, BadZipFile, EOFError, KeyError, RuntimeError, zlib.error) as error:
        return error_result("source_unreadable", error), 3
    except ValueError as error:
        return error_result("invalid_arguments", error), 2


def error_result(status, error):
    return {"schema_version": "1.0.0", "rule_version": RULE_VERSION, "device": DEVICE,
            "status": status, "error": {"code": status, "message": str(error),
                                        "zip": getattr(error, "archive_name", None),
                                        "physical_line": getattr(error, "line", None)}}


def main():
    parser = Parser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--device", default=DEVICE)
    parser.add_argument("--date", help="Local date YYYY-MM-DD. Defaults to the latest archive with records.")
    parser.add_argument("--relative-day", choices=("today", "yesterday"),
                        help="Relative to the latest onsite record, not the calendar clock.")
    parser.add_argument("--scope", choices=SCOPES, default="summary")
    parser.add_argument("--output-dir", type=Path, help="Write a daily progress PNG to this directory.")
    try:
        args = parser.parse_args()
        result, code = run_daily(args.data_dir, args.device, args.date, args.relative_day, args.scope,
                                 args.output_dir)
    except ValueError as error:
        result, code = error_result("invalid_arguments", error), 2
    if code == 5:
        print(result["chart"]["error"], file=sys.stderr)
    elif code:
        print(result["error"]["message"], file=sys.stderr)
    print(json.dumps(result, ensure_ascii=True, allow_nan=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
