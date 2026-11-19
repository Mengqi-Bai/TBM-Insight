"""Apply the platform figure style to Matplotlib exports inside research Python."""

from pathlib import Path
import re

from tbm_figure import STYLE, apply_figure_style, font_families


HAN = re.compile(r"[\u3400-\u9fff]")
DESCRIPTIVE_ENGLISH = re.compile(r"\b[A-Za-z][a-z]{2,}\b")


def check_language(figure, language):
    if language == "auto":
        return
    supertitle = getattr(figure, "_suptitle", None)
    titles = [supertitle.get_text()] if supertitle is not None else []
    axes = []
    for axis in figure.axes:
        titles.extend(axis.get_title(loc=location) for location in ("left", "center", "right"))
        axes.extend((axis.get_xlabel(), axis.get_ylabel()))
    if language == "zh":
        mismatches = [value for value in titles if value.strip() and not HAN.search(value)]
        mismatches.extend(value for value in axes
                          if not HAN.search(value) and DESCRIPTIVE_ENGLISH.search(value.split("(")[0]))
    else:
        from matplotlib.text import Text

        mismatches = [text.get_text() for text in figure.findobj(Text) if text.get_visible() and HAN.search(text.get_text())]
    if mismatches:
        required = "中文" if language == "zh" else "英文"
        raise ValueError(f"图中文字须符合{required}稿件要求，请改写这些标注后重绘：{', '.join(dict.fromkeys(mismatches))[:500]}")


def install(language):
    import matplotlib
    from matplotlib.figure import Figure
    from matplotlib.font_manager import fontManager

    for path in sorted(Path(__file__).parent.glob("font-*")):
        fontManager.addfont(path)
    families = font_families() or STYLE["fonts"]
    matplotlib.rcParams.update({
        "font.family": families,
        "axes.grid": False,
        "axes.titlesize": STYLE["label_size"],
        "axes.labelsize": STYLE["label_size"],
        "legend.fontsize": STYLE["legend_size"],
        "figure.titlesize": STYLE["title_size"],
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "savefig.facecolor": "white",
        "pdf.fonttype": 42,
        "svg.fonttype": "none",
    })
    original = Figure.savefig

    def savefig(figure, *args, **kwargs):
        check_language(figure, language)
        for axis in figure.axes:
            axis.set_facecolor("white")
        if figure.get_layout_engine() is None:
            figure.set_layout_engine("constrained")
        apply_figure_style(figure)
        kwargs.update(dpi=STYLE["dpi"], facecolor="white")
        if getattr(figure, "_tbm_align_time", False):
            kwargs["bbox_inches"] = None
            with matplotlib.rc_context({"savefig.bbox": None}):
                return original(figure, *args, **kwargs)
        return original(figure, *args, **kwargs)

    Figure.savefig = savefig
