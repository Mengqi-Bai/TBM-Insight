"""Run ARC experiment code in the project-local, CPU-only WASI runtime."""

import hashlib
import json
import math
import os
import re
import shutil
import time
from contextlib import contextmanager
from pathlib import Path, PurePosixPath


CACHE = Path(__file__).resolve().parents[1] / ".runtime" / "wasi-cache"
PLOT_TOOLS = Path(__file__).resolve().parents[1] / "tools"
PROGRAM_LIMIT = 8 << 20
WORK_LIMIT = 32 << 20
OUTPUT_TYPES = {".json", ".csv", ".tsv", ".md", ".txt", ".png", ".jpg", ".jpeg", ".svg"}
RESERVED = re.compile(r"^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)", re.I)


def available():
    try:
        import wasi_python
        import wasmtime

        wasi_python.artifacts()
        return bool(wasmtime.Engine)
    except (ImportError, OSError, RuntimeError, ValueError):
        return False


class MemoryFiles:
    def __init__(self, limit):
        from wasi_python.mounts import Errno, Stat

        self.errno = Errno
        self.file_stat = Stat
        self.files = {}
        self.dirs = {"/"}
        self.limit = limit

    def stat(self, path):
        if path in self.dirs:
            return self.file_stat("dir")
        if path in self.files:
            return self.file_stat("file", len(self.files[path]))
        return self.errno.ENOENT

    def list(self, path):
        if path not in self.dirs:
            return self.errno.ENOTDIR if path in self.files else self.errno.ENOENT
        parent = PurePosixPath(path)
        entries = []
        for paths, kind in ((self.dirs, "dir"), (self.files, "file")):
            entries += [(entry.name, kind) for name in paths
                        if (entry := PurePosixPath(name)) != parent and entry.parent == parent]
        return sorted(entries)

    def read(self, path):
        if path in self.dirs:
            return self.errno.EISDIR
        return self.files.get(path, self.errno.ENOENT)

    def write(self, path, data):
        if path in self.dirs:
            return self.errno.EISDIR
        if str(PurePosixPath(path).parent) not in self.dirs:
            return self.errno.ENOENT
        if path not in self.files and len(self.files) >= 256:
            return self.errno.ENOSPC
        remaining = self.limit - sum(map(len, self.files.values())) + len(self.files.get(path, b""))
        if len(data) > remaining:
            return self.errno.ENOSPC
        self.files[path] = data
        return None

    def mkdir(self, path):
        if path in self.dirs or path in self.files:
            return self.errno.EEXIST
        if str(PurePosixPath(path).parent) not in self.dirs:
            return self.errno.ENOENT
        if len(self.dirs) >= 256:
            return self.errno.ENOSPC
        self.dirs.add(path)
        return None

    def remove(self, path):
        if path in self.dirs:
            return self.errno.EISDIR
        if self.files.pop(path, None) is None:
            return self.errno.ENOENT
        return None

    def rmdir(self, path):
        children = self.list(path)
        if isinstance(children, self.errno):
            return children
        if path == "/" or children:
            return self.errno.ENOTEMPTY
        self.dirs.remove(path)
        return None

    def rename(self, src, dst):
        if src in self.dirs:
            return self.errno.ENOTSUP
        if src not in self.files:
            return self.errno.ENOENT
        if src == dst:
            return None
        contents = self.files.pop(src)
        error = self.write(dst, contents)
        if error:
            self.files[src] = contents
        return error


def checked(path, root):
    if not path.is_relative_to(root) or path.resolve() != path:
        raise ValueError("实验目录含有无效路径。")
    return path


def program_files(project):
    program = MemoryFiles(PROGRAM_LIMIT)
    for parent, dirs, files in os.walk(project):
        folder = checked(Path(parent), project)
        dirs[:] = [name for name in dirs if not name.startswith((".", "__"))]
        for name in dirs:
            guest = "/" + checked(folder / name, project).relative_to(project).as_posix()
            if program.mkdir(guest):
                raise ValueError("实验代码目录超过大小限制。")
        for name in files:
            path = checked(folder / name, project)
            if path.suffix.lower() not in {".py", ".txt", ".yaml", ".yml", ".json", ".toml", ".csv"}:
                continue
            if path.stat().st_size > PROGRAM_LIMIT or program.write(
                    "/" + path.relative_to(project).as_posix(), path.read_bytes()):
                raise ValueError("实验代码目录超过大小限制。")
    return program


def output_path(path):
    relative = PurePosixPath(path).relative_to("/")
    return relative if relative.suffix.lower() in OUTPUT_TYPES and all(
        part and not part.startswith(".") and not part.endswith((" ", "."))
        and not RESERVED.match(part) and not re.search(r'[<>:"\\|?*\x00-\x1f]', part)
        for part in relative.parts
    ) else None


class ResearchInputs:
    """Read-only snapshots of the selected files, with host-observed dataset reads."""

    def __init__(self, output):
        from wasi_python.mounts import Errno, Stat

        self.errno, self.file_stat = Errno, Stat
        self.files = {}
        self.read_datasets = {}
        root = checked(output.parent / "inputs", output.parent)
        inventory = json.loads((output / "research-materials.json").read_text(encoding="utf-8"))["materials"]
        for record in inventory:
            alias = record.get("experiment_path", "")
            name = PurePosixPath(alias).name
            if alias != f"/data/{name}" or not name:
                continue
            path = checked(root / name, root)
            if not path.is_file() or path.stat().st_size != record["size"]:
                raise ValueError("实验输入已发生变化，请重新提供数据文件。")
            self.files["/" + name] = (path, record)

    def stat(self, path):
        if path == "/":
            return self.file_stat("dir")
        item = self.files.get(path)
        return self.file_stat("file", item[1]["size"]) if item else self.errno.ENOENT

    def list(self, path):
        if path != "/":
            return self.errno.ENOTDIR if path in self.files else self.errno.ENOENT
        return [(name[1:], "file") for name in self.files]

    def read(self, path):
        if path == "/":
            return self.errno.EISDIR
        item = self.files.get(path)
        if item is None:
            return self.errno.ENOENT
        file, record = item
        with file.open("rb") as stream:
            data = stream.read(record["size"] + 1)
        if len(data) != record["size"] or hashlib.sha256(data).hexdigest() != record["sha256"]:
            return self.errno.ESTALE
        if record.get("dataset_profile") and data:
            self.read_datasets[path] = {key: record[key] for key in ("name", "sha256", "experiment_path")}
        return data


def figure_resources():
    from matplotlib.font_manager import FontProperties, findfont

    resources = MemoryFiles(64 << 20)
    for source in (PLOT_TOOLS / "tbm_figure.py", PLOT_TOOLS / "tbm_figure_style.json",
                   Path(__file__).with_name("tbm_research_figure.py")):
        if resources.write("/" + source.name, source.read_bytes()):
            raise ValueError("无法加载科研绘图样式。")
    for index, families in enumerate((
            ("Times New Roman", "Liberation Serif", "DejaVu Serif"),
            ("SimSun", "Noto Serif CJK SC", "Source Han Serif SC"))):
        for family in families:
            try:
                font = Path(findfont(FontProperties(family=[family]), fallback_to_default=False))
            except ValueError:
                continue
            if resources.write(f"/font-{index}{font.suffix.lower()}", font.read_bytes()):
                raise ValueError("无法加载科研绘图字体。")
            break
    return resources


class WasiExperimentSandbox:
    def __init__(self, output, workdir, require_evidence=True, *, figure_language=None):
        self.output = output
        self.workdir = checked(workdir, output)
        self.require_evidence = require_evidence
        self.figure_language = figure_language

    def run(self, code, *, timeout_sec=300):
        program = MemoryFiles(PROGRAM_LIMIT)
        if program.write("/main.py", code.encode("utf-8")):
            raise ValueError("实验代码超过大小限制。")
        return self._run(program, "main.py", timeout_sec, [])

    def run_project(self, project_dir, *, entry_point="main.py", timeout_sec=300, args=None, env_overrides=None):
        # Upstream passes environment overrides for subprocesses. The guest has a fixed environment.
        return self._run(program_files(checked(project_dir, self.output)), entry_point, timeout_sec, args or [])

    def _run(self, program, entry_point, timeout_sec, args):
        import wasi_python
        from researchclaw.experiment.sandbox import SandboxResult

        if "/" + entry_point not in program.files or PurePosixPath(entry_point).suffix != ".py":
            return SandboxResult(-1, "", "实验项目缺少 Python 入口文件。", 0.0, {})
        inputs = ResearchInputs(self.output)
        work = MemoryFiles(WORK_LIMIT)
        mounts = [wasi_python.Mount(program, "/program"), wasi_python.Mount(inputs, "/data"),
                  wasi_python.Mount(work, "/work", writable=True)]
        figure_setup = ""
        if self.figure_language is not None:
            mounts.append(wasi_python.Mount(figure_resources(), "/tbm_plot"))
            figure_setup = (
                "sys.path.insert(0, '/tbm_plot')\n"
                "from tbm_research_figure import install as install_figure_style\n"
                f"install_figure_style({self.figure_language!r})\n"
            )
        guest_args = repr(["/program/" + entry_point, *args])
        entry = (
            "import os, runpy, sys\n"
            "os.chdir('/work')\n"
            + figure_setup +
            "sys.path.insert(0, '/program')\n"
            f"sys.argv = {guest_args}\n"
            "runpy.run_path(sys.argv[0], run_name='__main__')\n"
        )
        start = time.monotonic()
        result = wasi_python.run(
            ["-c", entry], cache_dir=CACHE,
            mounts=mounts,
            env={"HOME": "/work", "TMPDIR": "/work", "MPLBACKEND": "Agg",
                 "MPLCONFIGDIR": "/work/.mpl", "TBM_RESEARCH_DATA_DIR": "/data"},
            deadline_s=timeout_sec, memory_bytes=1 << 30, output_bytes=256 << 10,
            max_file_calls=10_000, max_open_files=64,
        )
        destination = checked(self.workdir / "_project", self.output)
        if destination.exists():
            shutil.rmtree(destination)
        destination.mkdir(parents=True)
        stdout = result.stdout.decode("utf-8", errors="replace")
        stderr = result.stderr.decode("utf-8", errors="replace")
        if result.trapped:
            stderr += "\n隔离实验运行中止（" + result.trapped + "）。"
        try:
            payload = json.loads(work.files.get("/results.json", b""))
            valid = (isinstance(payload, dict) and payload.get("source") == "real"
                     and payload.get("status") == "completed" and isinstance(payload.get("metrics"), dict)
                     and bool(payload["metrics"]))
        except (ValueError, RecursionError):
            valid = False
        if self.require_evidence and (result.exit_code != 0 or result.trapped or not inputs.read_datasets or not valid):
            message = ("试验没有读取本项目的已登记数据文件。" if not inputs.read_datasets
                       else "试验执行未完成，或 results.json 缺少已完成的真实数据指标。")
            return SandboxResult(1, "", message + "\n" + stderr, time.monotonic() - start, {},
                                 timed_out=result.trapped == "deadline")

        metrics = {}
        for path, data in work.files.items():
            relative = output_path(path)
            if relative is None or relative.as_posix() == "data-provenance.json":
                continue
            if path == "/results.json":
                try:
                    payload = json.loads(data)
                    if not isinstance(payload, dict):
                        raise ValueError("Invalid results.json")
                    fields = payload.get("metrics") or payload.get("key_metrics")
                    if isinstance(fields, dict):
                        metrics = {key: value for key, value in fields.items()
                                   if type(value) in (float, int) and math.isfinite(value)}
                    data = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
                except (ValueError, OverflowError, RecursionError):
                    continue
            target = checked(destination.joinpath(*relative.parts), destination)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        if self.require_evidence and not (destination / "results.json").is_file():
            return SandboxResult(1, "", "试验结果含无效数据，请检查 results.json 格式。", time.monotonic() - start, {})
        if inputs.read_datasets:
            (destination / "data-provenance.json").write_text(
                json.dumps({"files_read": list(inputs.read_datasets.values())}, ensure_ascii=False, indent=2), encoding="utf-8")
        return SandboxResult(result.exit_code if result.exit_code is not None else -1,
                             stdout, stderr, time.monotonic() - start, metrics,
                             timed_out=result.trapped == "deadline")


@contextmanager
def arc_executor(output):
    from researchclaw.experiment import factory

    original = factory.create_sandbox
    factory.create_sandbox = lambda _config, workdir: WasiExperimentSandbox(output, workdir)
    try:
        yield
    finally:
        factory.create_sandbox = original
