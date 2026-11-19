"""Produce a reproducible comparison of two weeks of CREC188 construction data."""

import argparse
import csv
from datetime import date, timedelta
import json
from pathlib import Path
from types import SimpleNamespace
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from tbm_daily_summary import DEFAULT_DATA, RULE_VERSION
from tbm_figure import COLORS, legend, new_figure, save_png, title
from tbm_insight import DEVICE
from tbm_panel_data import indexed_week


TIME_CATEGORIES = (
    ("excavating", "掘进"),
    ("stopped", "估算停机"),
    ("other", "其他已判定"),
    ("undetermined", "未判定"),
)
DAY_FIELDS = ("date", "status", "advance", "downtime_seconds", "running_seconds", "cutoff")


def monday(day):
    return day - timedelta(days=day.weekday())


def week_label(result):
    return f"{result['window']['start']} 至 {result['days'][-1]['date']}"


def plot_comparison(result, target):
    import matplotlib.ticker

    figure = new_figure(4.7, width=7.2)
    axis = figure.subplots()
    bottom = [0.0, 0.0]
    for key, label in TIME_CATEGORIES:
        fractions = [week["totals"]["distribution"]["fractions"][key] for week in result["weeks"]]
        axis.bar((0, 1), fractions, bottom=bottom, color=COLORS[key], label=label, width=0.48)
        bottom = [total + fraction for total, fraction in zip(bottom, fractions)]
    axis.set_ylim(0, 1.26)
    axis.set_xticks((0, 1), [week_label(week) for week in result["weeks"]])
    axis.set_ylabel("工况时间占比")
    axis.yaxis.set_major_locator(matplotlib.ticker.FixedLocator([0, .25, .5, .75, 1]))
    axis.yaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1))
    legend(axis, ncol=2)
    title(figure, "掘进与停机时间构成对比", DEVICE, "按自然周汇总")
    save_png(figure, target, {"kind": "tbm_week_comparison", "device": DEVICE, "rule_version": RULE_VERSION})


def write_report(result, target):
    lines = [
        "# 引松 CREC188 掘进与停机周际对比", "",
        "| 自然周 | 有记录日 | 新增掘进估算（原始桩号量） | 估算停机（小时） | 掘进用时占比 | 未判定占比 |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for week in result["weeks"]:
        totals = week["totals"]
        fractions = totals["distribution"]["fractions"]
        advance = f"{totals['advance']:.2f}" if totals["advance"] is not None else "缺数据"
        uncovered = [item["date"] for item in week["days"] if item["status"] != "ok"]
        lines.append(
            f"| {week_label(week)} | {totals['observed_days']}/7 | {advance} | "
            f"{totals['downtime_seconds'] / 3600:.2f} | {fractions['excavating']:.2%} | {fractions['undetermined']:.2%} |"
        )
        week["uncovered_dates"] = uncovered
    lines += [
        "", "![两个自然周的工况时间构成](week-comparison.png)", "",
        "## 分析口径", "",
        f"- 使用 TBM Insight 日报规则 `{RULE_VERSION}`，以现场日期按周一至周日分组。",
        "- 时间占比分母为有归档日期从零点至最后一次实测的时间之和，缺测和无法判定的时间单列。",
        "- 新增掘进沿用稳定前缘估算。桩号单位待确认，停机由 PLC 信号估算。",
        "- 两周对比属于描述性分析。地质、排班和设备维护等因素需要额外资料才能归因。",
        "- 日指标见 `day-metrics.csv`。归档、原始行号和未覆盖日期见 `week-comparison.json`。",
    ]
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")


def compare(week_a, week_b, data_dir, output_dir, cache_dir):
    if monday(week_a) == monday(week_b):
        raise ValueError("请选择两个不同的自然周。")
    if output_dir.is_relative_to(data_dir) or cache_dir.is_relative_to(data_dir):
        raise ValueError("研究成果和缓存目录需与原始 PLC 资料目录分开。")
    paths = SimpleNamespace(data_dir=data_dir, output_dir=cache_dir)
    weeks = [indexed_week(day, paths, prepare=True) for day in (week_a, week_b)]
    if any(not week["totals"]["distribution"] or not week["totals"]["distribution"]["denominator_seconds"]
           for week in weeks):
        raise ValueError("两个自然周都需要有可计算的 PLC 工况记录。")
    result = {"kind": "tbm_week_comparison", "device": DEVICE, "rule_version": RULE_VERSION, "weeks": weeks}
    output_dir.mkdir(parents=True, exist_ok=True)
    plot_comparison(result, output_dir / "week-comparison.png")
    write_report(result, output_dir / "week-comparison.md")
    with (output_dir / "day-metrics.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=("week", *DAY_FIELDS))
        writer.writeheader()
        for week in weeks:
            for day in week["days"]:
                writer.writerow({"week": week["window"]["start"], **{key: day.get(key) for key in DAY_FIELDS}})
    (output_dir / "week-comparison.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--week-a", required=True, type=date.fromisoformat)
    parser.add_argument("--week-b", required=True, type=date.fromisoformat)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--cache-dir", type=Path, default=ROOT / "outputs" / "panels")
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    result = compare(args.week_a, args.week_b, args.data_dir.resolve(),
                     args.output_dir.resolve(), args.cache_dir.resolve())
    print(json.dumps({"status": "ok", "device": result["device"],
                      "artifacts": ["week-comparison.md", "week-comparison.json", "day-metrics.csv", "week-comparison.png"]}))


if __name__ == "__main__":
    main()
