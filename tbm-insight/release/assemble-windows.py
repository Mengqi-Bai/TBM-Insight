"""Assemble an offline-startable Windows ZIP from a built production runtime."""

import argparse
import json
import os
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parents[2]
PRODUCT = ROOT / "tbm-insight"
OMIT_DIRECTORIES = {".git", ".local", ".tbm-dev", ".runtime", ".venv", ".cache", "__pycache__",
                    "projects", "outputs", "sources", "versions", "index", "results"}


def product_files():
    for directory, folders, files in os.walk(PRODUCT):
        folders[:] = [folder for folder in folders if folder not in OMIT_DIRECTORIES]
        for item in files:
            path = Path(directory, item)
            location = path.relative_to(PRODUCT)
            if item.startswith("config.local") or item in {"acceptance.json", ".gitignore"}:
                continue
            if "AutoResearchClaw" in location.parts and "researchclaw" not in location.parts and item != "LICENSE":
                continue
            yield path


def deployed_modules(deployed, archive):
    links = []
    modules = deployed / "node_modules"
    for directory, folders, files in os.walk(modules):
        parent = Path(directory)
        for folder in folders[:]:
            candidate = parent / folder
            if candidate.is_junction() or candidate.is_symlink():
                folders.remove(folder)
                destination = candidate.resolve(strict=True)
                if not destination.is_relative_to(modules):
                    raise ValueError(f"Runtime dependency points outside deployment: {candidate}")
                links.append([candidate.relative_to(deployed).as_posix(), destination.relative_to(deployed).as_posix()])
        for item in files:
            if item.endswith((".map", ".tsbuildinfo")):
                continue
            path = parent / item
            if path.is_symlink() and not path.resolve(strict=True).is_relative_to(modules):
                raise ValueError(f"Runtime file points outside deployment: {path}")
            archive.write(path, path.relative_to(deployed).as_posix())
    archive.writestr("runtime-links.json", json.dumps(links, separators=(",", ":")))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("deployment", type=Path, help="Installed production CLI dependency tree")
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    deployed = args.deployment.resolve()
    if not (deployed / "lib/bin.js").is_file() or not (deployed / "node_modules").is_dir():
        raise SystemExit("The runtime deployment is incomplete")
    if args.archive.exists():
        raise SystemExit(f"Archive already exists: {args.archive}")
    with zipfile.ZipFile(args.archive, "x", zipfile.ZIP_DEFLATED, compresslevel=3) as archive:
        archive.writestr("package.json", '{"name":"tbm-insight","private":true,"type":"module"}\n')
        for path in sorted((deployed / "lib").glob("*.js")):
            archive.write(path, path.relative_to(deployed).as_posix())
        for path in product_files():
            archive.write(path, path.relative_to(ROOT).as_posix())
        for name in ("node", "python"):
            runtime = PRODUCT / ".runtime" / name
            for directory, folders, files in os.walk(runtime):
                folders[:] = [folder for folder in folders if folder != "__pycache__"]
                for item in files:
                    path = Path(directory, item)
                    archive.write(path, path.relative_to(ROOT).as_posix())
        for name in ("LICENSE", "THIRD_PARTY_NOTICES.md", "启动 TBM Insight.cmd"):
            archive.write(ROOT / name, name)
        archive.write(PRODUCT / "README.md", "使用说明.md")
        deployed_modules(deployed, archive)


if __name__ == "__main__":
    main()
