"""Read the same local data-source settings as the TBM Insight Web service."""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOME = Path(os.environ.get("TBM_INSIGHT_HOME", ROOT / ".local"))


def source_path(key, default):
    try:
        settings = json.loads((HOME / "data-sources.json").read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return default
    value = settings.get(key) if isinstance(settings, dict) else None
    if not isinstance(value, str):
        return default
    return Path(value) if value else None
