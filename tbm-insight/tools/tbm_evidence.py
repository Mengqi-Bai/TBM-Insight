"""Versioned local standards and construction-case evidence retrieval."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from hashlib import sha256
from functools import lru_cache
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import unicodedata
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent / "knowledge"
DEFAULT_CONFIG = ROOT / "models.json"
VERSION = "tbm-evidence-1"
CONCEPTS = {
    "bolt": ["螺栓", "紧固件", "螺丝", "bolt", "bolts", "fastener"],
    "loose": ["防松", "松脱", "松动", "loosening", "loose"],
    "cutter": ["刀具", "滚刀", "刀盘", "cutter", "cutterhead"],
    "install": ["安装", "装配", "assembly", "installation", "install"],
    "geological_anomaly": ["地质异常", "地质异常区", "不良地质", "异常地层", "geological anomaly", "adverse geology"],
    "fault": ["断层", "破碎带", "fault", "fractured", "fracture", "crushed", "shear zone"],
    "jamming": ["卡机", "被困", "卡住", "受困", "抱死", "jamming", "jammed", "stuck", "entrapment", "trapped"],
    "water": ["突水", "涌水", "富水", "water inrush", "water inflow", "groundwater"],
    "probe": ["探查", "探测", "超前地质", "probing", "probe", "investigation", "detection"],
    "grout": ["注浆", "灌浆", "grouting", "grout"],
    "support": ["支护", "加固", "support", "reinforcement", "stabilization"],
    "coal": ["煤矿", "coal mine", "coal mining"],
    "rock": ["岩石", "硬岩", "hard rock", "hard-rock", "rock tbm"],
    "open": ["敞开式", "敞开", "open tbm", "open-type", "open gripper", "main beam"],
    "shield": ["盾构", "shield"],
    "epb": ["土压平衡", "epb", "earth pressure balance"],
    "slurry": ["泥水", "slurry"],
    "double_shield": ["双护盾", "double shield", "double-shield"],
    "pipe": ["顶管", "pipe jacking", "microtunnel"],
    "water_project": ["水工", "水利", "引水", "供水", "water conveyance", "hydropower", "water diversion"],
    "subway": ["地铁", "城市轨道", "轨道交通", "metro", "subway", "urban rail"],
    "highway": ["公路", "highway", "road tunnel"],
    "hoisting": ["吊装", "吊运", "起吊", "hoisting", "lifting", "crane"],
    "excavate": ["掘进", "开挖", "excavation", "boring", "tunneling"],
    "settlement": ["沉降", "settlement", "subsidence"],
    "wear": ["磨损", "磨耗", "wear", "abrasion"],
    "gas": ["瓦斯", "有害气体", "gas", "methane"],
    "torque": ["扭矩", "torque"],
    "overload": ["过载", "超载", "overload"],
    "granite": ["花岗岩", "granite"],
    "limestone": ["石灰岩", "灰岩", "limestone"],
    "sandstone": ["砂岩", "sandstone"],
    "clay": ["黏土", "粘土", "clay"],
}
MACHINES = ("open", "epb", "slurry", "double_shield", "pipe")
DOMAINS = ("coal", "water_project", "subway", "highway")
REGIONS = {"11": "北京", "12": "天津", "13": "河北", "14": "山西", "15": "内蒙古",
           "21": "辽宁", "22": "吉林", "23": "黑龙江", "31": "上海", "32": "江苏",
           "33": "浙江", "34": "安徽", "35": "福建", "36": "江西", "37": "山东",
           "41": "河南", "42": "湖北", "43": "湖南", "44": "广东", "45": "广西",
           "46": "海南", "50": "重庆", "51": "四川", "52": "贵州", "53": "云南",
           "54": "西藏", "61": "陕西", "62": "甘肃", "63": "青海", "64": "宁夏", "65": "新疆"}
CLAUSE = re.compile(r"^\s*(?:#{1,6}\s*)?(\d{1,2}(?:\.\d{1,3}){0,5})(?:\s+|$)(.*)")
CODE = re.compile(r"(GB|DB\d{2,4}|NB|JGJ|JTG|SL|MT|DL|JB|TB|CJ|AQ|JT)\s*[/_]?\s*(T)?\s*([0-9]+(?:\.[0-9]+)?)\s*[-—–]\s*(\d{4})", re.I)
CONCEPT_PATTERNS = {
    key: re.compile("|".join(
        r"(?<![a-z])" + re.escape(alias) + r"(?![a-z])" if re.fullmatch(r"[a-z -]+", alias)
        else re.escape(alias) for alias in aliases))
    for key, aliases in CONCEPTS.items()
}


def norm(text):
    return unicodedata.normalize("NFKC", text).lower()


@lru_cache(maxsize=256)
def concepts(text):
    value = norm(text)
    return frozenset(key for key, pattern in CONCEPT_PATTERNS.items() if pattern.search(value))


@lru_cache(maxsize=256)
def tokens(text):
    value = norm(text)
    terms = re.findall(r"[a-z]+|\d+(?:\.\d+)*", value)
    for run in re.findall(r"[\u4e00-\u9fff]+", value):
        terms.extend(run[index:index + 2] for index in range(len(run) - 1))
    terms.extend("concept_" + key for key in concepts(value))
    return terms


def canonical_code(text):
    match = CODE.search(text)
    return f"{match[1].upper()}{'/T' if match[2] else ''} {match[3]}-{match[4]}" if match else None


def config_at(path):
    settings = json.loads(path.read_text(encoding="utf-8"))
    if settings["embedding"]["provider"] not in ("concept_tfidf", "openai"):
        raise ValueError("Unsupported embedding provider")
    if settings["reranker"]["provider"] not in ("rules", "http"):
        raise ValueError("Unsupported reranker provider")
    return settings


def model_id(settings):
    specification = {"embedding": settings["embedding"], "concepts": CONCEPTS, "engine": VERSION, "parser": 3}
    return sha256(json.dumps(specification, sort_keys=True).encode()).hexdigest()


def request_json(settings, payload):
    headers = {"Content-Type": "application/json"}
    secret = os.environ.get(settings.get("api_key_env", ""), "")
    if secret:
        headers["Authorization"] = "Bearer " + secret
    request = Request(settings["url"], json.dumps(payload).encode(), headers)
    with urlopen(request, timeout=settings.get("timeout_seconds", 60)) as response:
        return json.load(response)


def embed(texts, settings):
    response = request_json(settings, {"model": settings["model"], "input": texts})
    rows = sorted(response["data"], key=lambda item: item["index"])
    if [row["index"] for row in rows] != list(range(len(texts))):
        raise ValueError("Embedding response indices are incomplete")
    vectors = [row["embedding"] for row in rows]
    dimensions = {len(vector) for vector in vectors}
    if len(dimensions) != 1 or not all(vector and all(math.isfinite(x) for x in vector) for vector in vectors):
        raise ValueError("Invalid embedding vectors")
    return vectors


def connection(root):
    (root / "index").mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(root / "index" / "evidence.sqlite", timeout=60)
    db.row_factory = sqlite3.Row
    db.executescript("""
    CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, relative_path TEXT, hash TEXT, active INTEGER, snapshot TEXT, metadata TEXT);
    CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY, doc_id TEXT, kind TEXT, locator TEXT, start_line INTEGER, end_line INTEGER,
        text TEXT, context TEXT, data TEXT, concepts TEXT, embedding TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(chunk_id UNINDEXED, terms, tokenize='unicode61');
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
    """)
    return db


def standard_metadata(path, lines):
    code = canonical_code(path.name) or canonical_code("\n".join(lines[:80]))
    if code is None:
        raise ValueError(f"Unrecognized standard number: {path.name}")
    title = re.sub(r"-识别结果$", "", path.stem)
    body_start = next((i for i, line in enumerate(lines) if re.match(r"^#{1,6}\s*1\s+(范\s*围|总\s*则)", line)), None)
    start = body_start if body_start is not None else 0
    finish = next((i for i in range(start + 1, len(lines)) if re.match(r"^#{1,6}\s*2\s", lines[i])), min(start + 60, len(lines)))
    scope = "\n".join(lines[start:finish])
    region_match = re.match(r"DB(\d{2})", code)
    def stamped(label):
        match = re.search(r"(\d{4})\s*[-年]\s*(\d{1,2})\s*[-月]\s*(\d{1,2})\s*日?\s*" + label, "\n".join(lines[:100]))
        return "-".join((match[1], match[2].zfill(2), match[3].zfill(2))) if match else None
    publishers = [line.strip(" #") for line in lines[:80] if re.search(r"市场监督|标准化管理|能源局|住房和城乡建设|交通运输|水利部|人民政府", line) and len(line) < 75]
    tags = concepts(title + "\n" + scope)
    return {
        "number": code, "name": title, "year": int(code[-4:]),
        "standard_type": "地方标准" if code.startswith("DB") else "国家标准" if code.startswith("GB") else "行业标准",
        "publishers_raw": publishers, "region": REGIONS.get(region_match[1]) if region_match else None,
        "machine_tags": sorted(tags & set((*MACHINES, "rock", "shield"))),
        "engineering_domains": sorted(tags & set(DOMAINS)), "stage_tags": sorted(tags & {"install", "hoisting", "excavate"}),
        "scope": scope, "scope_lines": [start + 1, finish], "body_start": start,
        "published_date": stamped("发布"), "implementation_date": stamped("实施"),
        "validity_verification": "unverified", "supersedes": None, "pdf_page_mapping": None,
    }


def standard_chunks(path, text):
    lines = text.splitlines()
    metadata = standard_metadata(path, lines)
    starts = []
    for index in range(metadata["body_start"], len(lines)):
        line = lines[index]
        if re.search(r"…|\.{4,}", line):
            continue
        match = CLAUSE.match(line)
        table = re.match(r"^\s*(?:#+\s*)?(表\s*[A-Z]?\.?\d+(?:[.-]\d+)*)\s+(.+)", line)
        heading = re.match(r"^(#{1,6})\s+(.+)", line)
        if match:
            starts.append((index, match[1], match[2]))
        elif table:
            starts.append((index, re.sub(r"\s+", "", table[1]), table[2]))
        elif heading and re.match(r"附录|参考文献|条文说明", heading[2]):
            starts.append((index, heading[2], heading[2]))
    if not starts:
        starts = [(0, "全文", metadata["name"])]
    chunks = []
    parents = {}
    for offset, (start, locator, title) in enumerate(starts):
        end = starts[offset + 1][0] if offset + 1 < len(starts) else len(lines)
        if re.fullmatch(r"\d+(?:\.\d+)*", locator):
            depth = locator.count(".")
            parents = {key: value for key, value in parents.items() if key < depth}
            parents[depth] = lines[start].strip("# ")
        parent_text = list(parents.values())
        content = "\n".join(lines[start:end]).rstrip()
        warnings = []
        image_refs = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", content)
        for ref in image_refs:
            if not (path.parent / ref.strip("<>")).is_file():
                warnings.append({"code": "missing_original_image", "reference": ref})
        if re.search(r"\d", re.sub(r"^\s*[#\d. ]+", "", content)):
            warnings.append({"code": "ocr_numbers_unverified", "message": "关键数值、尺寸和表格需原文件复核"})
        data = {"parent_headings": parent_text, "warnings": warnings,
                "is_definition": any("术语" in title for title in parent_text),
                "is_scope": locator == "1" or locator.startswith("1."),
                "table_atomic": "|" in content or "<table" in content.lower(),
                "cross_references": sorted(set(re.findall(
                    r"(?:见|符合|按|参照|依照|满足|条款)\s*(\d+\.\d+(?:\.\d+)*)", content))),
                "table_references": sorted(set(re.findall(r"表\s*[A-Z]?\.?\d+(?:[.-]\d+)*", content)))}
        chunks.append({"kind": "standard", "locator": locator, "start_line": start + 1, "end_line": end,
                       "text": content, "context": metadata["name"] + "\n" + metadata["scope"], "data": data})
    return metadata, chunks


def case_chunks(text):
    projects = json.loads(text)
    if not isinstance(projects, list):
        raise ValueError("Case library must be a project array")
    chunks = []
    empty = 0
    for index, project in enumerate(projects):
        events = project.get("construction_events") or []
        if not events:
            empty += 1
        for event_index, event in enumerate(events or [None]):
            context = {key: value for key, value in project.items() if key != "construction_events"}
            data = {"project_index": index, "event_index": event_index if event is not None else None,
                    "project": context, "event": event, "source_type": "本地案例库记录",
                    "original_publication": None}
            chunks.append({"kind": "case", "locator": f"/{index}/construction_events/{event_index}" if event is not None else f"/{index}",
                           "start_line": None, "end_line": None,
                           "text": json.dumps(event, ensure_ascii=False), "context": json.dumps(context, ensure_ascii=False),
                           "data": data})
    return {"project_count": len(projects), "event_count": len(chunks) - empty, "empty_projects": empty}, chunks


def build(root, config):
    sources = root / "sources"
    manifest = json.loads((sources / "source_manifest.json").read_text(encoding="utf-8-sig"))
    expected = {item["path"]: item["sha256"] for item in manifest["files"]}
    files = sorted((sources / "standards_ocr").glob("*.md")) + sorted((sources / "cases").glob("*.json"))
    if not files:
        raise ValueError("No source documents found")
    db = connection(root)
    stats = Counter()
    try:
        with db:
            db.execute("UPDATE documents SET active=0")
            for path in files:
                content = path.read_bytes()
                digest = sha256(content).hexdigest()
                relative = path.relative_to(sources).as_posix()
                doc_id = sha256((relative + digest + model_id(config)).encode()).hexdigest()
                existing = db.execute("SELECT id,snapshot FROM documents WHERE id=?", (doc_id,)).fetchone()
                if existing:
                    if sha256((root / "versions" / digest / path.name).read_bytes()).hexdigest() != digest:
                        raise ValueError("Immutable indexed snapshot hash mismatch")
                    db.execute("UPDATE documents SET active=1 WHERE id=?", (doc_id,))
                    stats["unchanged"] += 1
                    continue
                known = db.execute("SELECT 1 FROM documents WHERE relative_path=?", (relative,)).fetchone()
                if relative in expected and expected[relative] != digest and not known:
                    raise ValueError(f"Initial source manifest mismatch: {relative}")
                snapshot = root / "versions" / digest / path.name
                snapshot.parent.mkdir(parents=True, exist_ok=True)
                if snapshot.exists() and sha256(snapshot.read_bytes()).hexdigest() != digest:
                    raise ValueError("Immutable source snapshot was modified")
                snapshot.write_bytes(content) if not snapshot.exists() else None
                text = content.decode("utf-8-sig")
                metadata, chunks = standard_chunks(path, text) if path.suffix == ".md" else case_chunks(text)
                metadata["manifest_hash_match"] = expected.get(relative) == digest
                db.execute("INSERT INTO documents VALUES(?,?,?,?,?,?)",
                           (doc_id, relative, digest, 1, str(snapshot.resolve()), json.dumps(metadata, ensure_ascii=False)))
                embeddings = [None] * len(chunks)
                if config["embedding"]["provider"] == "openai":
                    for begin in range(0, len(chunks), 32):
                        texts = [chunk["context"] + "\n" + chunk["text"] for chunk in chunks[begin:begin + 32]]
                        embeddings[begin:begin + 32] = embed(texts, config["embedding"])
                for index, (chunk, vector) in enumerate(zip(chunks, embeddings)):
                    chunk_id = f"{doc_id}:{index}"
                    tags = sorted(concepts(chunk["text"]))
                    db.execute("INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                               (chunk_id, doc_id, chunk["kind"], chunk["locator"], chunk["start_line"],
                                chunk["end_line"], chunk["text"], chunk["context"],
                                json.dumps(chunk["data"], ensure_ascii=False), json.dumps(tags), json.dumps(vector)))
                    db.execute("INSERT INTO search VALUES(?,?)",
                               (chunk_id, " ".join(tokens(chunk["text"]) + tokens(chunk["context"]))))
                stats["indexed"] += 1
                stats["chunks"] += len(chunks)
            db.execute("INSERT OR REPLACE INTO settings VALUES('embedding',?)", (model_id(config),))
            # Replaced parser/model indexes of the same immutable source version
            # can be rebuilt. Preserve older source hashes and their snapshots.
            obsolete = """SELECT old.id FROM documents old WHERE old.active=0 AND EXISTS (
                SELECT 1 FROM documents current WHERE current.active=1
                AND current.relative_path=old.relative_path AND current.hash=old.hash)"""
            db.execute(f"""DELETE FROM search WHERE rowid IN (
                SELECT search.rowid FROM search JOIN chunks ON chunks.id=search.chunk_id
                WHERE chunks.doc_id IN ({obsolete}))""")
            db.execute(f"DELETE FROM chunks WHERE doc_id IN ({obsolete})")
            db.execute(f"DELETE FROM documents WHERE id IN ({obsolete})")
        catalog = [dict(row) for row in db.execute("SELECT * FROM documents WHERE active=1 ORDER BY relative_path")]
        for row in catalog:
            row["metadata"] = json.loads(row["metadata"])
        temporary = root / "index" / "catalog.pending.json"
        temporary.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(root / "index" / "catalog.json")
        return {"status": "ok", "documents": len(catalog), **stats}
    finally:
        db.close()


def intent(query):
    if re.search(r"(今天|昨天|本日|今日).*?(掘进|进尺).*?(多少|几米)", query):
        return "daily_progress"
    if re.search(r"案例|相似|经验|怎么处置|如何处置", query):
        return "case"
    if CODE.search(query) or re.search(r"规范|标准|条款|要求|防松|地质异常|定义|依据|允许|限值|应不应|能.*套用", query):
        return "standard"
    return "not_needed"


def filter_tags(value, allowed, fallback):
    if not value:
        return fallback
    if value in allowed:
        return {value}
    matches = concepts(value) & set(allowed)
    if not matches:
        raise ValueError(f"Unrecognized applicability filter: {value}. Use {allowed}")
    return matches


def applicability(metadata, query, filters):
    issues, differences = [], []
    tags = concepts(query)
    regions = sorted((query.index(value), value) for value in REGIONS.values() if value in query)
    region = filters.get("region") or (regions[0][1] if regions else None)
    machines = filter_tags(filters.get("machine"), (*MACHINES, "rock", "shield"), tags & set(MACHINES))
    if not machines and "rock" in tags:
        machines = {"rock"}
    domains = filter_tags(filters.get("domain"), DOMAINS, tags & set(DOMAINS))
    available_machines = set(metadata.get("machine_tags", []))
    available_domains = set(metadata.get("engineering_domains", []))
    if metadata.get("region"):
        if not region:
            issues.append("项目地域未知，地方标准适用性待确认")
        elif region != metadata["region"]:
            differences.append(f"地域不同：项目{region}，标准{metadata['region']}")
    if machines and available_machines and not machines & available_machines:
        # Rock standards apply to the open and double-shield rock families.
        if not (machines & {"open", "double_shield"} and "rock" in available_machines):
            differences.append(f"机型不同：查询{sorted(machines)}，标准{sorted(available_machines)}")
    if domains and available_domains and not domains & available_domains:
        differences.append(f"工程领域不同：查询{sorted(domains)}，标准{sorted(available_domains)}")
    when = filters.get("as_of")
    if when and metadata.get("implementation_date") and when < metadata["implementation_date"]:
        differences.append("查询日期早于文本所载实施日期")
    issues.append("标准现行、废止及替代关系待核验")
    if filters.get("stage") and filters["stage"] not in metadata.get("stage_tags", []):
        issues.append("施工阶段适用性需结合条款复核")
    return issues, differences


def cosine(a, b):
    if len(a) != len(b):
        raise ValueError("Embedding dimensions differ")
    denominator = math.sqrt(sum(x*x for x in a) * sum(x*x for x in b))
    return sum(x*y for x, y in zip(a, b)) / denominator if denominator else 0


def vector_ranking(rows, query, config):
    tags = concepts(query)
    frequencies = Counter(tag for row in rows for tag in row["concepts"])
    weights = {tag: math.log((len(rows) + 1)/(count + 1)) + 1 for tag, count in frequencies.items()}
    errors, vector_query = [], None
    if config["embedding"]["provider"] == "openai":
        try:
            vector_query = embed([query], config["embedding"])[0]
        except Exception as error:
            errors.append(f"embedding: {type(error).__name__}")
    scored = []
    for row in rows:
        if vector_query is not None:
            score = cosine(vector_query, json.loads(row["embedding"]))
        else:
            numerator = sum(weights.get(tag, 1)**2 for tag in tags & row["concepts"])
            denominator = math.sqrt(sum(weights.get(tag, 1)**2 for tag in tags) *
                                    sum(weights.get(tag, 1)**2 for tag in row["concepts"]))
            score = numerator / denominator if denominator else 0
        if score > 0:
            scored.append((score, row["id"]))
    return {item[1]: 1/(60+rank) for rank, item in enumerate(sorted(scored, reverse=True)[:300], 1)}, errors


def pdf_catalog(root):
    catalog = root / "sources" / "pdf_catalog.json"
    return json.loads(catalog.read_text(encoding="utf-8")) if catalog.is_file() else []


def retrieve(root, query, config, limit=5, mode="auto", **filters):
    route = intent(query) if mode == "auto" else mode
    if route in ("not_needed", "daily_progress"):
        return {"status": "not_needed", "route": route, "standards": [], "cases": [],
                "suggested_tool": "query_tbm_daily_summary" if route == "daily_progress" else None}
    code = canonical_code(filters.get("standard", "") or query)
    index = root / "index" / "evidence.sqlite"
    if not index.is_file():
        raise ValueError("Index missing. Run build first")
    db = sqlite3.connect(index.resolve().as_uri() + "?mode=ro", uri=True, timeout=60)
    db.row_factory = sqlite3.Row
    try:
        if db.execute("SELECT value FROM settings WHERE key='embedding'").fetchone() is None:
            raise ValueError("Index missing. Run build first")
        if db.execute("SELECT value FROM settings WHERE key='embedding'").fetchone()[0] != model_id(config):
            raise ValueError("Query embedding configuration does not match the index")
        rows = [dict(row) for row in db.execute("""
            SELECT chunks.*, documents.metadata, documents.hash, documents.relative_path
            FROM chunks JOIN documents ON documents.id=chunks.doc_id WHERE documents.active=1""")]
        for row in rows:
            row["data"] = json.loads(row["data"])
            row["metadata"] = json.loads(row["metadata"])
            row["concepts"] = set(json.loads(row["concepts"]))
        terms = set(tokens(query))
        generic = {"tbm", "掘进", "要求", "什么", "怎么", "隧道", "规定", "concept_excavate"}
        meaningful = terms - generic
        expression = " OR ".join('"' + term.replace('"', '""') + '"' for term in meaningful)
        lexical = {}
        with ThreadPoolExecutor(max_workers=1) as executor:
            vector_future = executor.submit(vector_ranking, rows, query, config)
            if expression:
                for rank, row in enumerate(db.execute("""
                    SELECT search.chunk_id,bm25(search) FROM search
                    JOIN chunks ON chunks.id=search.chunk_id
                    JOIN documents ON documents.id=chunks.doc_id
                    WHERE documents.active=1 AND search MATCH ? ORDER BY bm25(search) LIMIT 300
                    """, (expression,)), 1):
                    lexical[row[0]] = 1 / (60 + rank)
            vector_ranks, model_errors = vector_future.result()
        query_concepts = concepts(query)
        candidates = []
        for row in rows:
            if row["id"] not in lexical and row["id"] not in vector_ranks:
                continue
            if mode != "both" and ((route == "case" and row["kind"] != "case") or (route == "standard" and row["kind"] != "standard")):
                continue
            if code and row["kind"] == "standard" and row["metadata"].get("number") != code:
                continue
            if filters.get("clause") and row["locator"] != filters["clause"]:
                continue
            score = lexical.get(row["id"], 0) + vector_ranks.get(row["id"], 0)
            matched = query_concepts & row["concepts"]
            technical = query_concepts - {"rock", "shield", "excavate", "install", "coal"}
            if technical and not technical & row["concepts"]:
                continue
            row["applicability_notes"], row["differences"] = [], []
            if row["kind"] == "standard":
                notes, differences = applicability(row["metadata"], query, filters)
                row["applicability_notes"], row["differences"] = notes, differences
                if differences and not code and not re.search(r"套用|适用|比较|能直接", query):
                    continue
                if row["data"]["is_definition"] and not re.search(r"定义|术语|解释.*TBM", query):
                    score -= .2
                if row["data"]["is_definition"] and re.search(r"定义|术语|解释.*TBM", query):
                    score += .15
                if row["data"]["is_scope"] and not re.search(r"适用|套用|范围", query):
                    score -= .025
                if row["data"]["is_scope"] and re.search(r"适用|套用|范围", query):
                    score += .07
                    if "适用于" in row["text"]:
                        score += .025
                if re.search(r"应|宜|不得|严禁", row["text"]):
                    score += .015
                    if len(row["text"]) < 400:
                        score += .025
                if row["data"]["table_atomic"] and not re.search(r"表|数值|尺寸|多少", query):
                    score -= .025
                if "套用" in query:
                    target = query.split("套用", 1)[1]
                    if row["metadata"].get("region") and row["metadata"]["region"] in target:
                        score += .15
                score += .03 * len(technical & row["concepts"])
                if code:
                    score += .03
            else:
                if row["data"]["event"] is None:
                    continue
                project = row["data"]["project"]
                context_tags = concepts(row["context"])
                machine_text = filters.get("machine")
                machine = filter_tags(machine_text, (*MACHINES, "rock", "shield"), query_concepts & set(MACHINES))
                if machine and not machine & context_tags:
                    continue
                if filters.get("geology"):
                    geology = concepts(filters["geology"])
                    if not (geology & context_tags if geology else norm(filters["geology"]) in norm(row["context"])):
                        continue
                score += .04 * len(technical & row["concepts"])
                if not project.get("project_name"):
                    score -= .025
                if not (project.get("tbm_info") or {}).get("type"):
                    score -= .015
                row["applicability_notes"] = ["原始论文、报告及网址缺失，引用为本地案例库记录"]
                row["differences"] = [f"记录机型 {project.get('tbm_info')}；当前机型与地质仍需逐项核对"]
            if not meaningful & set(tokens(row["text"])) and not matched:
                continue
            row["score"] = score
            row["matched_concepts"] = sorted(matched)
            candidates.append(row)
        candidates.sort(key=lambda row: (-row["score"], row["id"]))
        rerank = config["reranker"]
        if rerank["provider"] == "http" and candidates:
            try:
                chosen = [row for kind in ("standard", "case")
                          for row in [item for item in candidates if item["kind"] == kind][:20]]
                response = request_json(rerank, {"model": rerank["model"], "query": query,
                    "documents": [row["text"] for row in chosen], "top_n": len(chosen)})
                scores = {item["index"]: item["relevance_score"] for item in response["results"]}
                if set(scores) != set(range(len(chosen))) or not all(math.isfinite(score) for score in scores.values()):
                    raise ValueError("Incomplete reranker result")
                candidates = sorted(chosen, key=lambda row: -scores[chosen.index(row)])
            except Exception as error:
                model_errors.append(f"reranker: {type(error).__name__}")
        pdfs = {doc["ocrHash"]: doc for doc in pdf_catalog(root) if doc["ocrHash"]}
        selected = {"standard": [], "case": []}
        for row in candidates:
            if row["score"] < .018 or len(selected[row["kind"]]) >= limit:
                continue
            snapshot = root / "versions" / row["hash"] / Path(row["relative_path"]).name
            citation = {"version_hash": row["hash"], "path": str(snapshot.resolve()), "locator": row["locator"],
                        "start_line": row["start_line"], "end_line": row["end_line"]}
            endpoint = "/api/tbm/evidence-source"
            if row["kind"] == "standard" and row["hash"] in pdfs:
                citation["source_url"] = f"{endpoint}?pdf={pdfs[row['hash']]['id']}"
                citation["markdown_link"] = f"[打开规范 PDF]({citation['source_url']})"
            elif row["kind"] == "case":
                case = row["data"]
                citation["source_url"] = (f"{endpoint}?case={row['hash']}&project={case['project_index']}"
                                          f"&event={case['event_index']}")
                citation["markdown_link"] = f"[查看案例详情]({citation['source_url']})"
            item = {"evidence_id": row["id"], "score": row["score"], "citation": citation,
                    "text": row["text"], "metadata": row["metadata"] if row["kind"] == "standard" else row["data"],
                    "matched_concepts": row["matched_concepts"], "applicability_notes": row["applicability_notes"],
                    "differences": row["differences"], "warnings": row["data"].get("warnings", [])}
            item["similarities"] = [{"concept": tag, "topic": CONCEPTS[tag][0]} for tag in row["matched_concepts"]]
            item["support_status"] = "scope_mismatch_reference_only" if row["differences"] and row["kind"] == "standard" else "candidate_evidence"
            if sha256(snapshot.read_bytes()).hexdigest() != row["hash"]:
                raise ValueError("Citation source snapshot hash mismatch")
            if row["kind"] == "standard":
                refs = set(row["data"]["cross_references"] + [re.sub(r"\s+", "", ref) for ref in row["data"]["table_references"]])
                contained_tables = {re.sub(r"\s+", "", table) for table in re.findall(
                    r"(?:>\s*|^\s*)(表\s*[A-Z]?\.?\d+(?:[.-]\d+)*)", row["text"], re.M)}
                item["related"] = [{"locator": other["locator"], "text": other["text"],
                    "start_line": other["start_line"], "end_line": other["end_line"]}
                    for other in rows if other["doc_id"] == row["doc_id"] and other["locator"] in refs and other["id"] != row["id"]]
                item["unresolved_references"] = sorted(refs - {row["locator"]} - contained_tables -
                                                      {x["locator"] for x in item["related"]})
            selected[row["kind"]].append(item)
        sufficient = bool(selected["standard"] or selected["case"])
        missing_manufacturer = bool(re.search(r"厂家|CREC188", query, re.I) and
                                    re.search(r"曲线|过载|连续扭矩|短时", query))
        if missing_manufacturer:
            sufficient = False
        return {"status": "evidence_found" if sufficient else "insufficient_evidence", "rule_version": VERSION,
                "query": query, "route": route, "standards": selected["standard"], "cases": selected["case"],
                "retrieval": {"keyword": "SQLite FTS5", "vector": config["embedding"]["provider"],
                              "reranker": rerank["provider"], "model_errors": model_errors},
                "evidence_gaps": (["标准有效状态尚未外部核验"] if selected["standard"] else []) +
                                 (["案例原始出处待补充"] if selected["case"] else []) +
                                 (["缺少 CREC188 厂家曲线、适用工况和允许时限，规范摘录不足以确定该限值"] if missing_manufacturer else []) +
                                 (["当前资料未找到直接支撑，需补充对象、机型、地质或原始资料"] if not sufficient else [])}
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--config", type=Path)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("build")
    search = sub.add_parser("search")
    search.add_argument("query")
    search.add_argument("--mode", choices=("auto", "standard", "case", "both"), default="auto")
    search.add_argument("--limit", type=int, default=5)
    for field in ("standard", "clause", "region", "machine", "domain", "stage", "geology", "as-of"):
        search.add_argument("--" + field)
    args = parser.parse_args()
    try:
        settings = config_at(args.config or args.root / "models.json")
        if args.command == "build":
            result = build(args.root, settings)
        else:
            if not 1 <= args.limit <= 20:
                raise ValueError("limit must be between 1 and 20")
            if args.as_of:
                date.fromisoformat(args.as_of)
            filters = {key: value for key, value in vars(args).items() if key in
                       ("standard", "clause", "region", "machine", "domain", "stage", "geology", "as_of") and value}
            result = search_and_save(args.root, args.query, settings, args.limit, args.mode, **filters)
        print(json.dumps(result, ensure_ascii=True, allow_nan=False))
        return 0
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        print(json.dumps({"status": "error", "error": str(error)}, ensure_ascii=True))
        return 1


def search_and_save(root, query, config, limit=5, mode="auto", *, output_dir=None, **filters):
    result = retrieve(root, query, config, limit, mode, **filters)
    if result["status"] == "not_needed":
        return result
    payload = json.dumps(result, ensure_ascii=False, sort_keys=True)
    directory = output_dir if output_dir is not None else root / "results"
    target = directory / f"{sha256(payload.encode()).hexdigest()}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    result["result_file"] = str(target.resolve())
    if not target.exists():
        from tempfile import NamedTemporaryFile
        with NamedTemporaryFile(dir=target.parent, delete=False, mode="w", encoding="utf-8") as stream:
            temporary = Path(stream.name)
            json.dump(result, stream, ensure_ascii=False, indent=2)
        try:
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    return result


if __name__ == "__main__":
    sys.exit(main())
