"""Query one CREC188 PLC day archive and write a local trend chart."""

import argparse
from datetime import datetime, timedelta
from hashlib import sha256
import io
import json
import math
from pathlib import Path
import re
from statistics import mean
import sys
from tbm_figure import (COLORS, LABELS, STYLE, chart_arrays, chart_font, clock_axis, figure_data,
                        full_day, legend, metric, new_figure, observed_seconds, save_png, title)
from typing import NamedTuple
from zipfile import BadZipFile, ZipFile
import zlib


DEVICE = "CREC188"
SCHEMA_VERSION = "1.0.0"
RULE_VERSION = "crec188-plc-1"
TIME_FORMAT = "%Y-%m-%d %H:%M:%S"
TIME_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}")
TIME_COLUMN = 2
CHAINAGE_COLUMN = 3
HEADER_COLUMNS = 198
RECORD_COLUMNS = 199
# SHA-256 of the verified UTF-8 header without BOM or line terminator.
HEADER_SHA256 = "cb44fb33ee073b7b437ddf01eedafb8a508fb80c396b9ab1fe5692ccd067a83b"
DEFAULT_METRICS = (
    ("cutterhead_speed", "刀盘转速", 123),
    ("cutterhead_torque", "刀盘扭矩", 126),
    ("total_thrust", "总推进力", 142),
)
SECOND = timedelta(seconds=1)


class Record(NamedTuple):
    timestamp: datetime
    line: int
    values: tuple[float | None, ...]


class StructureError(Exception):
    def __init__(self, line, message):
        super().__init__(message)
        self.line = line


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError(message)

    def print_help(self, file=None):
        emit({"status": "help", "usage": self.format_help()})


def emit(result):
    # ASCII escaping keeps JSON intact under legacy Windows console encodings.
    print(json.dumps(
        {"schema_version": SCHEMA_VERSION, "rule_version": RULE_VERSION, **result},
        ensure_ascii=True, allow_nan=False,
    ))


def fail(result, status, code, message, *, line=None):
    result["status"] = status
    result["error"] = {"code": status, "message": message}
    if line is not None:
        result["error"]["physical_line"] = line
    print(f"{status}: {message}", file=sys.stderr)
    emit(result)
    return code


def parse_time(value):
    if not TIME_PATTERN.fullmatch(value):
        raise ValueError("Expected local time in YYYY-MM-DD HH:MM:SS format")
    return datetime.fromisoformat(value)


def read_value(value):
    try:
        number = float(value)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def select_metrics(names, requested_names):
    if not requested_names:
        return DEFAULT_METRICS
    default_keys = {name: key for key, name, _ in DEFAULT_METRICS}
    metrics = []
    for name in dict.fromkeys(requested_names):
        if name in ("时间戳", "运行时间"):
            raise ValueError(f"Time field cannot be selected as a metric: {name}")
        columns = [column for column, field in enumerate(names, start=1) if field == name]
        if not columns:
            raise ValueError(f"Unknown metric: {name}")
        if len(columns) > 1:
            raise ValueError(f"Ambiguous metric {name}, found in columns {columns}")
        metrics.append((default_keys.get(name, name), name, columns[0]))
    return tuple(metrics)


def read_records(archive_path, member, start, end, requested_names):
    records = []
    with ZipFile(archive_path, mode="r") as archive:
        if archive.namelist().count(member) > 1:
            raise StructureError(None, "Duplicate TXT member in archive")
        with archive.open(member) as raw, io.TextIOWrapper(raw, encoding="utf-8-sig") as source:
            header = source.readline().rstrip("\n")
            names = header.split("\t")
            if len(names) != HEADER_COLUMNS:
                raise StructureError(1, f"Expected {HEADER_COLUMNS} header columns, got {len(names)}")
            required = [(TIME_COLUMN, "运行时间"), (CHAINAGE_COLUMN, "桩号")]
            required.extend((column, name) for _, name, column in DEFAULT_METRICS)
            for column, name in required:
                if names[column - 1] != name:
                    raise StructureError(1, f"Unexpected header name at column {column}, expected {name}")
            if sha256(header.encode("utf-8")).hexdigest() != HEADER_SHA256:
                raise StructureError(1, "Header differs from the verified CREC188 layout")
            metrics = select_metrics(names, requested_names)

            for line, raw_row in enumerate(source, start=2):
                fields = raw_row.rstrip("\n").split("\t")
                if len(fields) != RECORD_COLUMNS:
                    raise StructureError(line, f"Expected {RECORD_COLUMNS} record values, got {len(fields)}")
                chainage = fields[CHAINAGE_COLUMN - 1]
                if not chainage.strip() or fields[-1] != chainage:
                    raise StructureError(line, "Trailing value does not match chainage at column 3")
                try:
                    timestamp = parse_time(fields[TIME_COLUMN - 1])
                except ValueError as error:
                    raise StructureError(line, "Invalid local runtime at column 2") from error
                if start <= timestamp < end:
                    values = tuple(read_value(fields[column - 1]) for _, _, column in metrics)
                    records.append(Record(timestamp, line, values))

    # Keep duplicates. Use the physical line to order records with the same time.
    records.sort(key=lambda record: (record.timestamp, record.line))
    return records, metrics


def summarize(records, metrics, quality):
    stats = {}
    for index, (key, name, column) in enumerate(metrics):
        # Tuple ordering breaks extrema ties by the earliest physical line.
        valid = [(record.values[index], record.line) for record in records
                 if record.values[index] is not None]
        missing = len(records) - len(valid)
        if missing:
            quality.append({"code": "missing_metric_values", "metric": key, "count": missing})
        low, low_line = min(valid, default=(None, None))
        high, high_line = max(valid, key=lambda item: (item[0], -item[1]), default=(None, None))
        stats[key] = {
            "unit": None,
            "min": low,
            "max": high,
            "mean": mean(value for value, _ in valid) if valid else None,
            "valid_count": len(valid),
            "missing_count": missing,
            "evidence": {
                "field": name,
                "column": column,
                "min_line": low_line,
                "max_line": high_line,
            },
        }
    return stats



def draw_chart(records, metrics, start, end, target, result=None):
    samples = list(observed_seconds(records))
    timestamps, series = chart_arrays(((stamp, values) for stamp, _, _, values in samples), SECOND)
    figure = new_figure(1.4 + 1.65 * len(metrics), align_time=full_day(start, end))
    axes = figure.subplots(len(metrics), 1, sharex=True, squeeze=False)[:, 0]
    fields = [metric(key, name) for key, name, _ in metrics]
    for axis, values, field in zip(axes, series, fields):
        axis.plot(timestamps, values, color=COLORS["measured"], linewidth=STYLE["line_width"],
                  marker=".", markersize=2.4, label=LABELS["measured"])
        axis.set_title(field["label"], loc="left", wrap=True)
        axis.set_ylabel(STYLE["unknown_unit"])
        axis.margins(y=.17)
        legend(axis, loc="best")
    clock_axis(axes[-1], start, end)
    end_label = end.strftime("%H:%M:%S") if end.date() == start.date() else "24:00:00"
    title(figure, "掘进工况趋势", DEVICE, f"{start:%Y-%m-%d} {start:%H:%M:%S} 至 {end_label}", len(records))
    facts = result or {}
    data = figure_data("conditions", DEVICE, fields, {"start": start, "end": end, "bounds": "[start,end)"},
                       {"start": samples[0][0], "end": samples[-1][0]}, len(records),
                       facts.get("data_quality", []), facts.get("evidence"))
    save_png(figure, target, data)
    return data


def main(argv=None):
    parser = Parser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--device", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--metric", action="append", metavar="FIELD",
                        help="Exact source header name. Repeat to select multiple metrics.")
    result = {"chart": {"status": "not_generated", "path": None}}
    try:
        args = parser.parse_args(argv)
        result["device"] = args.device
        result["request"] = {"start": args.start, "end": args.end, "bounds": "[start,end)"}
        if args.device != DEVICE:
            raise ValueError(f"Supported device: {DEVICE}")
        start, end = parse_time(args.start), parse_time(args.end)
        if start >= end:
            raise ValueError("--start must be before --end")
        if start.date() != (end - SECOND).date():
            raise ValueError("The window must fit in one local calendar day")
        result["request"].update(start=start.isoformat(), end=end.isoformat())
        if args.metric:
            result["request"]["metrics"] = args.metric
    except ValueError as error:
        return fail(result, "invalid_arguments", 2, str(error))

    stem = f"{DEVICE}_{start:%Y%m%d}"
    archive_path = args.data_dir / f"{stem}.zip"
    member = f"{stem}.txt"
    source = {
        "zip": archive_path.name,
        "txt": member,
        "physical_line_start": None,
        "physical_line_end": None,
    }
    result["evidence"] = source
    try:
        records, metrics = read_records(archive_path, member, start, end, args.metric)
    except StructureError as error:
        return fail(result, "data_structure_error", 4, str(error), line=error.line)
    except UnicodeError:
        return fail(result, "data_structure_error", 4, "TXT is not valid UTF-8")
    except ValueError as error:
        return fail(result, "invalid_arguments", 2, str(error))
    except (OSError, BadZipFile, EOFError, KeyError, RuntimeError, zlib.error) as error:
        return fail(result, "source_unreadable", 3, str(error))

    quality = [{"code": "units_unverified"}]
    unique_times = len({record.timestamp for record in records})
    missing_seconds = int((end - start).total_seconds()) - unique_times
    if missing_seconds:
        quality.append({"code": "missing_seconds", "count": missing_seconds})
    if unique_times < len(records):
        quality.append({"code": "duplicate_timestamps", "count": len(records) - unique_times})
    result.update(
        status="ok" if records else "empty_window",
        actual_start=records[0].timestamp.isoformat() if records else None,
        actual_end=records[-1].timestamp.isoformat() if records else None,
        record_count=len(records),
        data_quality=quality,
        metrics=summarize(records, metrics, quality),
    )
    if not records:
        result["chart"]["status"] = "skipped_empty_window"
        emit(result)
        return 0

    source["physical_line_start"] = min(record.line for record in records)
    source["physical_line_end"] = max(record.line for record in records)
    try:
        output_dir = args.output_dir.resolve()
        if output_dir.is_relative_to(args.data_dir.resolve()):
            raise ValueError("--output-dir must be outside the read-only data directory")
        suffix = ""
        if metrics != DEFAULT_METRICS:
            columns = ",".join(str(column) for _, _, column in metrics)
            suffix = "_" + sha256(columns.encode("ascii")).hexdigest()[:12]
        target = output_dir / f"{stem}_{start:%H%M%S}-{end:%H%M%S}{suffix}.png"
        figure_metadata = draw_chart(records, metrics, start, end, target, result)
    except Exception as error:
        # Rendering failures must preserve the completed query and its provenance.
        result["chart"]["status"] = "failed"
        return fail(result, "chart_generation_failed", 5, str(error))

    result["chart"] = {
        "status": "generated",
        "path": str(target),
        "sampling": "all_records",
        "plotted_record_count": len(records),
        "plotted_seconds": len({row.timestamp for row in records}),
        "duplicate_policy": "same_second_consensus",
        "figure_data": figure_metadata,
    }
    emit(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
