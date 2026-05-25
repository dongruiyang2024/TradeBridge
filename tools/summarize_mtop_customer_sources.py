import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


LOG_PATHS = [
    Path(r"D:\AlibabaSupplierData\app.log"),
    Path(r"C:\Users\wait9yan\AppData\Local\AliWorkbenchTemp\cef.log"),
]

TARGET_APIS = {
    "mtop.alibaba.icbu.contact.extinfo.get",
    "mtop.alibaba.icbu.im.getuserinfobyparams",
    "mtop.alibaba.intl.mobile.interaction.getcontactuserdeviceinfo",
    "mtop.alibaba.intl.common.checkaccountsavailable",
}


def extract_balanced_json(text: str, start: int) -> str | None:
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
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def safe_json(text: str) -> Any:
    try:
        return json.loads(text)
    except Exception:
        return None


def records_from_object(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def type_map(value: dict[str, Any]) -> dict[str, str]:
    return {key: type(item).__name__ for key, item in sorted(value.items())}


def nested_keys(value: Any, prefix: str = "", limit: int = 180) -> list[str]:
    output: list[str] = []
    stack: list[tuple[Any, str]] = [(value, prefix)]
    while stack and len(output) < limit:
        item, base = stack.pop()
        if isinstance(item, dict):
            for key in sorted(item.keys(), reverse=True):
                path = f"{base}.{key}" if base else key
                output.append(path)
                child = item.get(key)
                if isinstance(child, (dict, list)):
                    stack.append((child, path))
        elif isinstance(item, list):
            output.append(f"{base}[]")
            for child in item[:2]:
                if isinstance(child, (dict, list)):
                    stack.append((child, f"{base}[]"))
    return output[:limit]


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    summary: dict[str, Any] = defaultdict(lambda: {"count": 0, "object_counts": [], "sample_records": []})
    marker = 'data={"api":"'
    for path in LOG_PATHS:
        if not path.exists():
            continue
        text = path.read_text("utf-8", "ignore")
        index = 0
        while index < len(text):
            marker_index = text.find(marker, index)
            if marker_index < 0:
                break
            object_start = text.find("{", marker_index)
            if object_start < 0:
                break
            raw = extract_balanced_json(text, object_start)
            index = object_start + max(len(raw or ""), 1)
            if not raw:
                continue
            parsed = safe_json(raw)
            if not isinstance(parsed, dict):
                continue
            api = str(parsed.get("api") or "").lower()
            if api not in TARGET_APIS:
                continue
            item = summary[api]
            item["count"] += 1
            data = parsed.get("data")
            if isinstance(data, dict):
                data_keys = sorted(data.keys())[:120]
                if data_keys not in item.setdefault("data_key_sets", []):
                    item["data_key_sets"].append(data_keys)
                data_type_map = type_map(data)
                if data_type_map not in item.setdefault("data_type_maps", []):
                    item["data_type_maps"].append(data_type_map)
                customer_data_paths = [
                    key
                    for key in nested_keys(data)
                    if any(
                        word.lower() in key.lower()
                        for word in [
                            "company",
                            "account",
                            "login",
                            "aliId",
                            "country",
                            "join",
                            "email",
                            "phone",
                            "register",
                            "business",
                            "sales",
                            "website",
                        ]
                    )
                ][:120]
                if customer_data_paths and customer_data_paths not in item.setdefault("data_customer_key_paths", []):
                    item["data_customer_key_paths"].append(customer_data_paths)
            obj = data.get("object") if isinstance(data, dict) else None
            records = records_from_object(obj)
            item["object_counts"].append(len(records))
            for record in records[:2]:
                sample = {
                    "keys": sorted(record.keys())[:160],
                    "types": type_map(record),
                    "customer_key_paths": [
                        key
                        for key in nested_keys(record)
                        if any(
                            word.lower() in key.lower()
                            for word in [
                                "company",
                                "account",
                                "login",
                                "aliId",
                                "country",
                                "join",
                                "email",
                                "phone",
                                "register",
                                "business",
                                "sales",
                                "website",
                            ]
                        )
                    ][:120],
                }
                if sample not in item["sample_records"]:
                    item["sample_records"].append(sample)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
