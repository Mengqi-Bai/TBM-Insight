"""Compressed, source-validated day index for the PLC conditions panel."""

import argparse
from array import array
from bisect import bisect_left
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
from errno import EACCES, EAGAIN
from hashlib import sha256
import json
from math import isnan, nan
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile
from time import monotonic, sleep
from zipfile import BadZipFile, ZIP_DEFLATED, ZipFile
import zlib

import tbm_daily_summary as daily
import tbm_insight as plc
import tbm_limits as limits


VERSION = "plc-conditions-day-v1"
ACTIVITY_FIELDS = (daily.CHAINAGE, *daily.STOP_FIELDS, "刀盘扭矩")
INDEX_FIELDS = tuple(dict.fromkeys([
    *(name for _, name, _ in plc.DEFAULT_METRICS),
    *(field for point in limits.POINTS.values() for field, _ in point[1:]),
    *ACTIVITY_FIELDS,
]))
SCHEMA = sha256(json.dumps([VERSION, plc.HEADER_SHA256, INDEX_FIELDS]).encode("utf-8")
                + Path(plc.__file__).read_bytes()).hexdigest()
DAY = timedelta(days=1)


def identity(source):
    stat = source.stat()
    return [stat.st_size, stat.st_mtime_ns, stat.st_ino]


def index_path(root, source, additional_fields=()):
    key = sha256(json.dumps([str(source.resolve()), additional_fields]).encode("utf-8")).hexdigest()[:20]
    return root / f"{source.stem}-{key}.zip"


@contextmanager
def day_lock(path):
    # OS locks release when an abandoned Python worker is terminated.
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        if sys.platform == "win32":
            from msvcrt import LK_NBLCK, LK_UNLCK, locking

            deadline = monotonic() + 120
            while True:
                try:
                    locking(handle.fileno(), LK_NBLCK, 1)
                    break
                except OSError as error:
                    if error.errno not in (EACCES, EAGAIN) or monotonic() >= deadline:
                        raise
                    sleep(0.05)
            try:
                yield
            finally:
                locking(handle.fileno(), LK_UNLCK, 1)
        else:
            from fcntl import LOCK_EX, flock

            flock(handle, LOCK_EX)
            yield


def column_bytes(values, kind):
    result = array(kind, values)
    if sys.byteorder != "little":
        result.byteswap()
    return result.tobytes()


def column(archive, member, kind):
    result = array(kind)
    result.frombytes(archive.read(member))
    if sys.byteorder != "little":
        result.byteswap()
    return result


def read_index(target, source_identity, start, end, names):
    with ZipFile(target) as archive:
        header = json.loads(archive.read("index.json"))
        if header["schema"] != SCHEMA or header["source_identity"] != source_identity:
            return None
        metrics = {entry[1]: tuple(entry) for entry in header["metrics"]}
        selected = tuple(metrics[name] for name in dict.fromkeys(names))
        midnight = datetime.combine(start.date(), time.min)
        seconds = column(archive, "seconds.u32", "I")
        first = bisect_left(seconds, (start - midnight) // plc.SECOND)
        last = bisect_left(seconds, (end - midnight) // plc.SECOND)
        if first == last:
            return [], selected
        lines = column(archive, "lines.u32", "I")
        values = [[None if isnan(value) else value for value in column(archive, f"{number}.f64", "d")[first:last]]
                  for _, _, number in selected]
        timestamps = (midnight + timedelta(seconds=second) for second in seconds[first:last])
        return [plc.Record(stamp, line, row) for stamp, line, row in zip(timestamps, lines[first:last], zip(*values), strict=True)], selected


def load_index(target, source_identity, start, end, names):
    try:
        return read_index(target, source_identity, start, end, names)
    except (OSError, BadZipFile, EOFError, ValueError, TypeError, IndexError, KeyError, zlib.error):
        # Source parsing remains the authority when a derived index is missing or unreadable.
        return None


def write_index(target, source_identity, midnight, records, metrics):
    temporary = None
    try:
        with NamedTemporaryFile(dir=target.parent, delete=False) as stream:
            temporary = Path(stream.name)
            with ZipFile(stream, "w", compression=ZIP_DEFLATED, compresslevel=1) as archive:
                archive.writestr("index.json", json.dumps({"schema": SCHEMA, "source_identity": source_identity,
                                                           "metrics": metrics}, ensure_ascii=False))
                archive.writestr("seconds.u32", column_bytes(((row.timestamp - midnight) // plc.SECOND for row in records), "I"))
                archive.writestr("lines.u32", column_bytes((row.line for row in records), "I"))
                for index, (_, _, number) in enumerate(metrics):
                    values = (nan if row.values[index] is None else row.values[index] for row in records)
                    archive.writestr(f"{number}.f64", column_bytes(values, "d"))
        temporary.replace(target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def read_records(source, member, start, end, names, root):
    """Read an indexed local day window, building once for the covered PLC fields."""
    midnight = datetime.combine(start.date(), time.min)
    if end > midnight + DAY:
        return plc.read_records(source, member, start, end, names)
    additional = tuple(sorted(set(names).difference(INDEX_FIELDS)))
    target = index_path(root, source, additional)
    source_identity = identity(source)
    indexed = load_index(target, source_identity, start, end, names)
    if indexed is not None and identity(source) == source_identity:
        return indexed
    with day_lock(target.with_suffix(".lock")):
        source_identity = identity(source)
        indexed = load_index(target, source_identity, start, end, names)
        if indexed is not None and identity(source) == source_identity:
            return indexed
        records, metrics = plc.read_records(source, member, midnight, midnight + DAY, [*INDEX_FIELDS, *additional])
        if identity(source) != source_identity:
            raise OSError("PLC 日包在读取期间发生变化，请重试。")
        try:
            write_index(target, source_identity, midnight, records, metrics)
        except OSError:
            # Retain usable source data if the derived cache cannot be published.
            pass
        indices = {name: index for index, (_, name, _) in enumerate(metrics)}
        selected = [indices[name] for name in dict.fromkeys(names)]
        return ([plc.Record(row.timestamp, row.line, tuple(row.values[index] for index in selected))
                 for row in records if start <= row.timestamp < end], tuple(metrics[index] for index in selected))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", type=date.fromisoformat, action="append", required=True)
    parser.add_argument("--data-dir", type=Path, default=daily.DEFAULT_DATA)
    parser.add_argument("--output-dir", type=Path,
                        default=Path(__file__).resolve().parent.parent / "outputs" / "panels")
    args = parser.parse_args()
    source_root = args.data_dir.resolve()
    output_root = args.output_dir.resolve()
    if output_root.is_relative_to(source_root):
        parser.error("索引目录须位于只读 PLC 资料目录之外")
    root = output_root / ".cache" / "conditions-index"
    results = []
    for day in dict.fromkeys(args.date):
        stem = f"{plc.DEVICE}_{day:%Y%m%d}"
        source = source_root / f"{stem}.zip"
        started = monotonic()
        midnight = datetime.combine(day, time.min)
        try:
            read_records(source, f"{stem}.txt", midnight, midnight + plc.SECOND, INDEX_FIELDS, root)
            target = index_path(root, source)
            result = {"date": day.isoformat(), "status": "ready", "bytes": target.stat().st_size}
        except (OSError, BadZipFile, plc.StructureError, UnicodeError, ValueError, KeyError, RuntimeError, zlib.error) as error:
            result = {"date": day.isoformat(), "status": "unavailable", "message": str(error)}
        result["seconds"] = round(monotonic() - started, 3)
        results.append(result)
    print(json.dumps(results, ensure_ascii=True))
    return int(any(result["status"] != "ready" for result in results))


if __name__ == "__main__":
    sys.exit(main())
