"""Prebuild historical dashboard data outside Web startup."""

import argparse
from collections import Counter
from datetime import date, timedelta
import json
from pathlib import Path
import sys
from time import perf_counter
from zipfile import BadZipFile
import zlib

sys.dont_write_bytecode = True

from tbm_daily_summary import DEFAULT_DATA
from tbm_insight import StructureError
from tbm_panel_data import history_conditions, panel_date, prepared_progress_day


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", required=True, help="First calendar date, YYYY-MM-DD")
    parser.add_argument("--through", required=True, help="Last included calendar date, YYYY-MM-DD")
    parser.add_argument("--include-conditions", action="store_true",
                        help="Also prepare the PLC day index and default trend window")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent.parent / "outputs" / "panels")
    args = parser.parse_args()
    try:
        start, end = panel_date(args.start), panel_date(args.through)
        if start <= date.min or start > end:
            raise ValueError("预建起止日期无效")
        args.data_dir, args.output_dir = args.data_dir.resolve(), args.output_dir.resolve()
        if args.output_dir.is_relative_to(args.data_dir):
            raise ValueError("索引输出目录须在原始归档目录之外")
    except ValueError as error:
        parser.error(str(error))

    previous = None
    counts = Counter()
    conditions = Counter()
    started = perf_counter()
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        previous = prepared_progress_day(day, args, previous, prepare=True)
        status = previous["status"]
        counts[status] += 1
        condition_status = None
        if args.include_conditions and status in ("ok", "empty_day"):
            try:
                condition_status = history_conditions(day, {}, args)["status"]
            except (OSError, BadZipFile, StructureError, UnicodeError, ValueError, KeyError, RuntimeError, zlib.error) as error:
                condition_status = "source_unreadable"
                print(f"{day.isoformat()} 工况索引失败 {error}", file=sys.stderr, flush=True)
            conditions[condition_status] += 1
        print(f"{day.isoformat()} {status}" + (f" 工况 {condition_status}" if condition_status else ""),
              file=sys.stderr, flush=True)
    report = {"start": start.isoformat(), "through": end.isoformat(), "day_status_counts": counts,
              "condition_status_counts": conditions,
              "elapsed_seconds": round(perf_counter() - started, 2)}
    print(json.dumps(report, ensure_ascii=True))
    return int(any(state not in ("ok", "empty_day", "archive_missing") for state in counts)
               or any(state not in ("ok", "empty_window") for state in conditions))


if __name__ == "__main__":
    sys.exit(main())
