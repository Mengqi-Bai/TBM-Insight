"""Shared figure style, metadata, time-series handling and PNG export."""

from functools import lru_cache
from datetime import date, time, timedelta
from itertools import groupby
import json
from math import nan, sqrt
from pathlib import Path
from tempfile import NamedTemporaryFile


STYLE = json.loads(Path(__file__).with_name("tbm_figure_style.json").read_text(encoding="utf-8"))
COLORS = STYLE["colors"]
LABELS = STYLE["labels"]
LEGEND_CORNERS = ("upper right", "upper left", "lower left", "lower right")


@lru_cache(maxsize=1)
def font_families():
    from matplotlib.font_manager import fontManager

    installed = {font.name for font in fontManager.ttflist}
    return [family for family in STYLE["fonts"] if family in installed]


def chart_font(labels=()):
    from matplotlib.font_manager import FontProperties

    return FontProperties(family=font_families() or STYLE["fonts"])


def new_figure(height, *, width=None, align_time=False):
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure

    if align_time:
        width = STYLE["time_comparison"]["width_inches"]
    figure = Figure(figsize=(width if width is not None else 8, height), layout="constrained")
    figure._tbm_align_time = align_time
    FigureCanvasAgg(figure)
    return figure


def title(figure, label, device, window, sample_count=None):
    count = f"　样本 {sample_count:,}" if sample_count is not None else ""
    figure.suptitle(f"{label}\n{device}　{window}{count}",
                    fontproperties=chart_font(), fontsize=STYLE["title_size"])


def legend(axis, **kwargs):
    font = chart_font()
    font.set_size(STYLE["legend_size"])
    kwargs["loc"] = LEGEND_CORNERS[0]
    artist = axis.legend(prop=font, frameon=False, **kwargs)
    artist.set_in_layout(False)
    return artist


def legend_obstacles(axis, renderer):
    from matplotlib.collections import PathCollection
    from matplotlib.transforms import Bbox

    paths, boxes = [], []
    pixels = renderer.points_to_pixels
    for line in axis.lines:
        if line.get_visible():
            has_marker = line.get_marker() not in (None, "None", "", " ")
            width = max(line.get_linewidth(), line.get_markersize() if has_marker else 0)
            paths.append((line.get_transform().transform_path(line.get_path()), False, pixels(width / 2)))
    for patch in axis.patches:
        if patch.get_visible():
            paths.append((patch.get_transform().transform_path(patch.get_path()), patch.get_fill(),
                          pixels(patch.get_linewidth() / 2)))
    for collection in axis.collections:
        if not collection.get_visible():
            continue
        if isinstance(collection, PathCollection):
            sizes = collection.get_sizes()
            widths = collection.get_linewidths()
            for index, (x, y) in enumerate(collection.get_offset_transform().transform(collection.get_offsets())):
                radius = pixels((sqrt(sizes[index % len(sizes)]) + widths[index % len(widths)]) / 2)
                boxes.append(Bbox.from_extents(x - radius, y - radius, x + radius, y + radius))
        else:
            transform = collection.get_transform()
            paths.extend((transform.transform_path(path), True, 0) for path in collection.get_paths())
    boxes.extend(text.get_window_extent(renderer) for text in axis.texts if text.get_visible())
    return paths, boxes


def position_legends(figure, *, align_time=False):
    """Choose a clear corner after layout, with an outside margin as a fallback."""
    pending = [(axis, artist) for axis in figure.axes if (artist := axis.get_legend()) is not None]
    while pending:
        figure.draw_without_rendering()
        renderer = figure.canvas.get_renderer()
        inside = []
        layout_changed = False
        for axis, artist in pending:
            paths, boxes = legend_obstacles(axis, renderer)
            for corner in LEGEND_CORNERS:
                artist.set_loc(corner)
                bounds = artist.get_window_extent(renderer).padded(renderer.points_to_pixels(1.5))
                if not (axis.bbox.contains(bounds.x0, bounds.y0) and axis.bbox.contains(bounds.x1, bounds.y1)):
                    continue
                if any(box.overlaps(bounds) for box in boxes):
                    continue
                if any(path.intersects_bbox(bounds.padded(padding), filled=filled) for path, filled, padding in paths):
                    continue
                inside.append((axis, artist))
                break
            else:
                if align_time:
                    # Keep the common plotting width. Stack entries in the reserved gutter.
                    outside = axis.legend(artist.legend_handles, [label.get_text() for label in artist.get_texts()],
                                          prop=artist.prop, title=artist.get_title().get_text(),
                                          loc="upper left", bbox_to_anchor=(1, 1), frameon=artist.get_frame_on())
                    outside.set_in_layout(False)
                else:
                    artist.set_loc("upper left")
                    artist.set_bbox_to_anchor((1, 1))
                    artist.set_in_layout(True)
                    layout_changed = True
        if not layout_changed:
            break
        # A legend outside an axis may change the width of other axes.
        pending = inside


def metric(key, field, unit=None, *, estimated=False):
    return {"key": key, "label": STYLE["metric_labels"].get(key, field), "unit": unit,
            "unit_status": "confirmed" if unit else "unverified",
            "value_kind": "estimated" if estimated else "observed"}


def figure_data(kind, device, metrics, window, actual, samples, missing, source):
    def stamps(fields):
        return {key: value.isoformat() if isinstance(value, date) else value
                for key, value in fields.items()}

    return {"kind": kind, "device": device, "metrics": metrics, "window": stamps(window),
            "observed_window": stamps(actual), "sample_count": samples, "missing": missing, "source": source}


def full_day(start, end):
    return start.time() == time.min and end - start == timedelta(days=1)


def clock_axis(axis, start, end, *, seconds=True):
    from matplotlib.dates import AutoDateLocator, DateFormatter, date2num
    from matplotlib.ticker import FixedLocator, FuncFormatter

    axis.set_xlim(start, end)
    if full_day(start, end):
        axis.xaxis.set_major_locator(FixedLocator([date2num(start + timedelta(hours=hour)) for hour in range(0, 25, 4)]))
        seconds = False
    else:
        axis.xaxis.set_major_locator(AutoDateLocator(minticks=4, maxticks=7))
    formatter = DateFormatter(STYLE["clock_format"] if seconds else "%H:%M")
    if start.date() != end.date() and not (end.hour or end.minute or end.second):
        midnight = date2num(end)
        axis.xaxis.set_major_formatter(FuncFormatter(
            lambda value, position: ("24:00:00" if seconds else "24:00")
            if abs(value - midnight) < 1e-8 else formatter(value, position)))
    else:
        axis.xaxis.set_major_formatter(formatter)
    axis.set_xlabel("现场时间")


def observed_seconds(records):
    """Collapse equal observations at the same second and leave conflicting fields missing."""
    for stamp, group in groupby(records, key=lambda record: record.timestamp):
        rows = list(group)
        values = tuple(value if all(row.values[index] == value for row in rows) else None
                       for index, value in enumerate(rows[0].values))
        yield stamp, rows[0].line, rows[-1].line, values


def gap_rows(rows, step):
    previous = None
    for stamp, values in rows:
        if previous is not None and stamp - previous > step:
            yield previous + step, (None,) * len(values)
        yield stamp, values
        previous = stamp


def chart_arrays(rows, step):
    rows_with_gaps = list(gap_rows(rows, step))
    return ([stamp for stamp, _ in rows_with_gaps],
            list(zip(*[tuple(nan if value is None else value for value in values)
                       for _, values in rows_with_gaps])))


def bucket_extrema(samples, width, start, step):
    """Keep first, last, minimum and maximum per bucket and per contiguous valid run."""
    result = []
    for _, bucket in groupby(samples, key=lambda item: (item[0] - start) // step // width):
        for missing, run in groupby(bucket, key=lambda item: item[1] is None):
            points = list(run)
            if missing:
                result.extend(points[:1])
            else:
                picked = {points[0], points[-1], min(points, key=lambda item: item[1]),
                          max(points, key=lambda item: item[1])}
                result.extend(sorted(picked))
    return result


def step_changes(samples):
    """Preserve PLC setting changes and both ends of each unchanged run."""
    for _, run in groupby(samples, key=lambda item: item[1]):
        first = next(run)
        yield first
        last = first
        for sample in run:
            last = sample
        if last != first:
            yield last


def apply_figure_style(figure, data=None):
    """Apply the shared axes, typography and legend rules before rendering."""
    from matplotlib.text import Text

    for axis in figure.axes:
        axis.grid(False, which="both", axis="both")
        for spine in axis.spines.values():
            spine.set_visible(True)
            spine.set_color(STYLE["frame_color"])
            spine.set_linewidth(STYLE["frame_width"])
        axis.tick_params(direction="in", color=STYLE["frame_color"], labelsize=STYLE["tick_size"])
        axis.xaxis.label.set_size(STYLE["label_size"])
        axis.yaxis.label.set_size(STYLE["label_size"])
        axis.title.set_size(STYLE["label_size"])
        if data and data.get("kind") == "conditions":
            lower, upper = axis.get_ylim()
            axis.set_ylim(top=upper + STYLE["trend_legend_headroom"] * (upper - lower))
    for artist in figure.findobj(Text):
        artist.set_fontfamily(font_families() or STYLE["fonts"])
    for artist in [*figure.legends, *(axis.get_legend() for axis in figure.axes)]:
        if artist is not None:
            for label in artist.get_texts():
                label.set_size(STYLE["legend_size"])
    figure.set_dpi(STYLE["dpi"])
    align_time = getattr(figure, "_tbm_align_time", False)
    if align_time and figure.get_layout_engine() is not None:
        # Let Matplotlib fit labels vertically first, then share horizontal bounds across figures.
        figure.draw_without_rendering()
        left = STYLE["time_comparison"]["left"]
        right = STYLE["time_comparison"]["right"]
        figure.set_layout_engine("none")
        for axis in figure.axes:
            if axis.get_label() == "<colorbar>":
                continue
            position = axis.get_position()
            axis.set_position((left, position.y0, right - left, position.height))
    position_legends(figure, align_time=align_time)


def save_png(figure, target, data=None):
    apply_figure_style(figure, data)
    target.parent.mkdir(parents=True, exist_ok=True)
    metadata = {"Description": json.dumps(data, ensure_ascii=True, default=str)} if data else None
    temporary = None
    try:
        with NamedTemporaryFile(dir=target.parent, delete=False) as stream:
            temporary = Path(stream.name)
            figure.savefig(stream, format="png", dpi=STYLE["dpi"], metadata=metadata)
        temporary.replace(target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def draw_week(result, device, target, data_origin):
    from matplotlib.ticker import PercentFormatter

    days = result["days"]
    totals = result["totals"]
    window = result["window"]
    indices = list(range(len(days)))
    daily_values = [item["advance"] for item in days]
    cumulative = [item["cumulative_advance"] if item["advance"] is not None else None for item in days]
    fractions = [(item.get("distribution") or {}).get("fractions", {}).get("excavating") for item in days]
    figure = new_figure(6.9, align_time=True)
    advance, running_total, ratio = figure.subplots(3, 1, sharex=True)
    valid = [(index, value) for index, value in zip(indices, daily_values) if value is not None]
    advance.bar([index for index, _ in valid], [value for _, value in valid],
                color=COLORS["estimated"], label="每日新增掘进")
    for index, value in valid:
        if value == 0:
            advance.plot(index, 0, "o", color=COLORS["estimated"], markersize=4)
    running_total.plot(indices, [nan if value is None else value for value in cumulative],
                       color=COLORS["estimated"], linestyle=STYLE["line_styles"]["estimated"],
                       marker="o", markersize=3, label="累计新增掘进")
    ratio.plot(indices, [nan if value is None else value for value in fractions],
               color=COLORS["excavating"], marker="o", markersize=3, label="掘进用时占比")
    highest_ratio = max((value for value in fractions if value is not None), default=0)
    ratio.set_ylim(0, max(1.05, highest_ratio * 1.51))
    ratio.set_yticks([0, .2, .4, .6, .8, 1])
    ratio.yaxis.set_major_formatter(PercentFormatter(1))
    unit = totals.get("unit") or "桩号量（单位待确认）"
    advance.set_ylabel(unit)
    running_total.set_ylabel(unit)
    ratio.set_ylabel("占比")
    series = ((advance, daily_values, ",.2f", COLORS["estimated"]),
              (running_total, cumulative, ",.2f", COLORS["estimated"]),
              (ratio, fractions, ".1%", COLORS["excavating"]))
    for axis, values, number_format, color in series:
        legend(axis)
        axis.margins(y=.51)
        for index, value in zip(indices, values):
            if value is not None:
                axis.annotate(format(value, number_format), (index, value),
                              xytext=(0, 5), textcoords="offset points",
                              ha="center", va="bottom", fontsize=STYLE["label_size"], color=color)
    advance.set_ylim(bottom=0)
    running_total.set_ylim(bottom=max(0, running_total.get_ylim()[0]))
    ratio.set_xticks(indices, [item["date"][5:] for item in days])
    ratio.set_xlim(-.5, len(days) - .5)
    caption = "现场日期\n分母为各日零点至最后实测的时长，缺测计入未判定"
    if any(value is None for values in (daily_values, cumulative, fractions) for value in values):
        caption += "\n空缺处表示该项无可用读数"
    ratio.set_xlabel(caption)
    title(figure, "周掘进进度", device, f"{window['start']} 至 {days[-1]['date']}")
    data = figure_data("weekly_progress", device,
                       [metric("daily_advance", "每日新增掘进", totals.get("unit"), estimated=True),
                        metric("cumulative_advance", "累计新增掘进", totals.get("unit"), estimated=True),
                        metric("excavating_fraction", "掘进用时占比", "比例", estimated=True)],
                       window, {"first_date": next((d["date"] for d in days if d["cutoff"]), None),
                                "last_cutoff": next((d["cutoff"] for d in reversed(days) if d["cutoff"]), None)},
                       totals["observed_days"], [d["date"] for d in days if d["advance"] is None],
                       [{"date": d["date"], **d["evidence"]} for d in days if d.get("evidence")])
    data["data_origin"] = data_origin
    save_png(figure, target, data)
    return data



def export_week(result, device, output_dir, *, data_origin="historical"):
    if not any(result["totals"][key] is not None for key in ("advance", "distribution")):
        result["chart"] = {"status": "no_records", "path": None}
        return
    week = result["window"]["start"].replace("-", "")
    suffix = "" if data_origin == "historical" else "_simulation"
    target = (output_dir / f"{device}_{week}_weekly_progress{suffix}.png").resolve()
    try:
        metadata = draw_week(result, device, target, data_origin)
    except (ImportError, OSError, RuntimeError, ValueError) as error:
        result["chart"] = {"status": "failed", "path": None, "error": str(error)}
    else:
        result["chart"] = {"status": "generated", "path": str(target), "figure_data": metadata}
