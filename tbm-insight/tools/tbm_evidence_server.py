"""Standalone MCP stdio adapter for the versioned evidence index."""
import argparse
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
from tbm_evidence import ROOT, config_at, search_and_save
from tbm_data_sources import HOME, source_path

TOOL = {
    "name": "search_tbm_evidence",
    "description": "规范与施工案例证据检索。查询具体工程要求、条款适用范围及相似案例，返回可回查原文。进尺问题使用日报工具。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "minLength": 1},
            "mode": {"type": "string", "enum": ["auto", "standard", "case", "both"], "default": "auto"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
            **{name: {"type": "string"} for name in
               ("standard", "clause", "region", "machine", "domain", "stage", "geology", "as_of")},
        },
        "required": ["query"], "additionalProperties": False,
    },
}


def call(arguments, root, settings):
    try:
        if not isinstance(arguments, dict) or arguments.keys() - TOOL["inputSchema"]["properties"].keys():
            raise ValueError("Unknown evidence search arguments")
        query = arguments.get("query")
        if not isinstance(query, str) or not query.strip():
            raise ValueError("query must be a nonempty string")
        count = arguments.get("limit", 5)
        mode = arguments.get("mode", "auto")
        if type(count) is not int or not 1 <= count <= 20 or mode not in ("auto", "standard", "case", "both"):
            raise ValueError("Invalid limit or mode")
        filters = {key: value for key, value in arguments.items() if key not in ("query", "mode", "limit")}
        if any(not isinstance(value, str) for value in filters.values()):
            raise ValueError("Filters must be strings")
        result = search_and_save(root, query, settings, count, mode, output_dir=HOME / "outputs" / "knowledge", **filters)
        lines = [result["status"], f"问题路由 {result['route']}"]
        if result.get("suggested_tool"):
            lines.append(f"建议调用工程工具 {result['suggested_tool']}")
        retrieval = result.get("retrieval")
        if retrieval:
            lines.append(f"检索后端 {retrieval['keyword']}；向量 {retrieval['vector']}；重排 {retrieval['reranker']}")
            if retrieval["model_errors"]:
                lines.append("模型请求失败，已回退至离线召回或规则重排：" + "；".join(retrieval["model_errors"]))
        for item in result["standards"]:
            metadata = item["metadata"]
            lines.extend([f"规范证据 · {item['support_status']}",
                          f"{metadata['number']} · {metadata['name']} · {item['citation']['locator']}",
                          item["text"], item["citation"].get("markdown_link", "未找到对应版本的 PDF 原件。"),
                          "适用范围 " + metadata["scope"],
                          "适用核对 " + "；".join(item["applicability_notes"] + item["differences"])])
            for warning in item["warnings"]:
                lines.append("OCR 原文警示 " + json.dumps(warning, ensure_ascii=False))
            for related in item["related"]:
                lines.extend([f"同版本相关条款 {related['locator']}", related["text"]])
            if item["unresolved_references"]:
                lines.append("尚未补齐的原文引用 " + "、".join(item["unresolved_references"]))
        for item in result["cases"]:
            data = item["metadata"]
            lines.extend([f"案例证据 · {item['support_status']}",
                          f"本地案例库记录 · {data['project'].get('project_name')} · 事件 {data['event_index'] + 1}",
                          item["text"], "机型与地质 " + json.dumps(data["project"], ensure_ascii=False),
                          item["citation"]["markdown_link"],
                          "适用核对 " + "；".join(item["applicability_notes"] + item["differences"])])
            lines.append("案例原始出处待补充。" if data["original_publication"] is None
                         else "案例原始出处 " + json.dumps(data["original_publication"], ensure_ascii=False))
            for warning in item["warnings"]:
                lines.append("案例原文警示 " + json.dumps(warning, ensure_ascii=False))
        lines.extend(gap for gap in result.get("evidence_gaps", []) if gap != "标准有效状态尚未外部核验")
        public = {key: value for key, value in result.items() if key != "result_file"}
        for kind in ("standards", "cases"):
            public[kind] = []
            for item in result[kind]:
                evidence = {key: value for key, value in item.items() if key != "evidence_id"}
                evidence["citation"] = {key: value for key, value in item["citation"].items()
                                        if key in ("source_url", "markdown_link") or (kind == "standards" and key == "locator")}
                public[kind].append(evidence)
        return {"content": [{"type": "text", "text": "\n\n".join(lines)}],
                "structuredContent": public, "isError": False}
    except Exception as error:
        result = {"status": "error", "message": str(error)}
        return {"content": [{"type": "text", "text": str(error)}],
                "structuredContent": result, "isError": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--config", type=Path)
    args = parser.parse_args()
    for line in sys.stdin.buffer:
        try:
            request = json.loads(line)
            if "id" not in request:
                continue
            method = request.get("method")
            if method == "initialize":
                result = {"protocolVersion": "2025-11-25", "capabilities": {"tools": {}},
                          "serverInfo": {"name": "tbm-evidence", "version": "1.0.0"}}
            elif method == "tools/list":
                result = {"tools": [TOOL]}
            elif method == "tools/call" and request.get("params", {}).get("name") == TOOL["name"]:
                root = source_path("knowledgeDir", args.root) or args.root
                if not (root / "index" / "evidence.sqlite").is_file():
                    result = {"isError": True, "content": [{"type": "text", "text": "请先在「设置 → 工程数据」配置已入库的规范与案例库。"}]}
                else:
                    settings = config_at(args.config or root / "models.json")
                    result = call(request["params"].get("arguments", {}), root, settings)
            elif method == "ping":
                result = {}
            else:
                print(json.dumps({"jsonrpc": "2.0", "id": request["id"],
                                  "error": {"code": -32601, "message": "Unknown method"}}), flush=True)
                continue
            print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}, ensure_ascii=True), flush=True)
        except (ValueError, TypeError, KeyError):
            print(json.dumps({"jsonrpc": "2.0", "id": None,
                              "error": {"code": -32700, "message": "Invalid JSON-RPC request"}}), flush=True)


if __name__ == "__main__":
    main()
