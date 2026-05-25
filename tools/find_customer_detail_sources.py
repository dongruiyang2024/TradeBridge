import json
import re
import sys
from pathlib import Path
from typing import Any


LOG_PATHS = [
    Path(r"D:\AlibabaSupplierData\app.log"),
    Path(r"C:\Users\wait9yan\AppData\Local\AliWorkbenchTemp\cef.log"),
]

KEYWORDS = [
    "companyName",
    "registerDate",
    "buyerContactInfo",
    "companyWebSite",
    "companyWebsite",
    "businessTypes",
    "salesTypes",
    "queryCustomerInfo",
    "getTargetTagList",
]

API_RE = re.compile(r'"api"\s*:\s*"([^"]+)"')
URL_RE = re.compile(r"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{8,260}")


def extract_balanced_json(text: str, start: int) -> str | None:
    open_char = text[start]
    close_char = "}" if open_char == "{" else "]"
    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == open_char:
            depth += 1
        elif char == close_char:
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def safe_json(value: str) -> Any:
    try:
        return json.loads(value)
    except Exception:
        return None


def path_keys(value: Any, prefix: str = "", limit: int = 180) -> list[str]:
    result: list[str] = []
    stack: list[tuple[Any, str]] = [(value, prefix)]
    while stack and len(result) < limit:
        current, base = stack.pop()
        if isinstance(current, dict):
            for key in sorted(current.keys(), reverse=True):
                path = f"{base}.{key}" if base else key
                result.append(path)
                item = current.get(key)
                if isinstance(item, (dict, list)):
                    stack.append((item, path))
        elif isinstance(current, list):
            result.append(f"{base}[]")
            for item in current[:2]:
                if isinstance(item, (dict, list)):
                    stack.append((item, f"{base}[]"))
    return result[:limit]


def context_label(snippet: str) -> dict[str, Any]:
    api = API_RE.search(snippet)
    urls = []
    for url_match in URL_RE.finditer(snippet):
        url = url_match.group(0)
        if any(word in url for word in ("customer", "message", "chat", "crm", "mtop")):
            urls.append(redact_url(url))
    return {
        "api": api.group(1) if api else None,
        "urls": sorted(set(urls))[:5],
    }


def redact_url(url: str) -> str:
    url = re.sub(r"([?&](?:chatToken|ctoken|_tb_token_|token|secReqToken|data|params)=)[^&\s]+", r"\1<redacted>", url, flags=re.I)
    url = re.sub(r"([?&][^=]*(?:AccountId|LoginId|AliId|IdEncrypt)[^=]*=)[^&\s]+", r"\1<redacted>", url, flags=re.I)
    return url


def summarize_hit(text: str, keyword: str, index: int) -> dict[str, Any]:
    start = max(0, index - 5000)
    end = min(len(text), index + 5000)
    snippet = text[start:end]
    labels = context_label(snippet)
    json_summary: dict[str, Any] = {}

    object_start = text.rfind("{", max(0, index - 2000), index + 1)
    if object_start >= 0:
        raw = extract_balanced_json(text, object_start)
        if raw:
            parsed = safe_json(raw)
            if isinstance(parsed, (dict, list)):
                json_summary = {
                    "json_root_type": type(parsed).__name__,
                    "key_paths": [path for path in path_keys(parsed) if any(k.lower() in path.lower() for k in KEYWORDS[:7])][:80],
                }

    return {
        "keyword": keyword,
        **labels,
        **json_summary,
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    output: dict[str, Any] = {"files": []}
    for path in LOG_PATHS:
        file_info: dict[str, Any] = {
            "path": str(path),
            "exists": path.exists(),
            "keyword_counts": {},
            "hits": [],
        }
        if not path.exists():
            output["files"].append(file_info)
            continue
        text = path.read_text("utf-8", "ignore")
        lower = text.lower()
        seen: set[tuple[str, str | None, tuple[str, ...]]] = set()
        for keyword in KEYWORDS:
            count = lower.count(keyword.lower())
            file_info["keyword_counts"][keyword] = count
            search_from = 0
            while len(file_info["hits"]) < 80:
                index = lower.find(keyword.lower(), search_from)
                if index < 0:
                    break
                hit = summarize_hit(text, keyword, index)
                key = (keyword, hit.get("api"), tuple(hit.get("urls") or []))
                if key not in seen:
                    seen.add(key)
                    file_info["hits"].append(hit)
                search_from = index + len(keyword)
        output["files"].append(file_info)

    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
