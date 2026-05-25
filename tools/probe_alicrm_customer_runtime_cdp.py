import json
import shutil
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any

from probe_alicrm_with_log_cookies import extract_cookies, extract_latest_alicrm_context
from probe_weblite_runtime_cdp import CDPWebSocket, evaluate, http_json, wait_for_debugger


LOG_PATHS = [
    Path(r"D:\AlibabaSupplierData\app.log"),
    Path(r"C:\Users\wait9yan\AppData\Local\AliWorkbenchTemp\cef.log"),
]

CHROME_PATH = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PROFILE_DIR = Path(r"E:\projects\app\VSCode\xiezi\wangwang\.tmp-alicrm-cdp-profile")
PORT = 9342


def launch_chrome() -> subprocess.Popen:
    if not CHROME_PATH.exists():
        raise FileNotFoundError(str(CHROME_PATH))
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    args = [
        str(CHROME_PATH),
        "--headless=new",
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={PROFILE_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--disable-background-networking",
        "--disable-sync",
        "about:blank",
    ]
    return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def summarize_customer_response(value: Any) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "json": isinstance(value, dict),
        "top_keys": [],
        "success": None,
        "code": None,
        "data_keys": [],
        "inner_data_keys": [],
        "buyer_info_keys": [],
        "alicrm_customer_info_keys": [],
        "customer_type": None,
        "status": None,
        "inner_value_types": {},
        "field_presence": {},
    }
    if not isinstance(value, dict):
        return summary
    summary["top_keys"] = sorted(value.keys())[:80]
    summary["success"] = value.get("success")
    summary["code"] = value.get("code") or value.get("retCode")
    data = value.get("data")
    if isinstance(data, dict):
        summary["data_keys"] = sorted(data.keys())[:100]
        inner = data.get("data")
        if isinstance(inner, dict):
            summary["inner_data_keys"] = sorted(inner.keys())[:120]
            buyer_info = inner.get("buyerInfo")
            customer_info = inner.get("alicrmCustomerInfo")
            summary["customer_type"] = inner.get("customerType")
            summary["status"] = inner.get("status")
            summary["inner_value_types"] = {key: type(inner.get(key)).__name__ for key in sorted(inner.keys())[:80]}
            if isinstance(buyer_info, dict):
                summary["buyer_info_keys"] = sorted(buyer_info.keys())[:160]
            if isinstance(customer_info, dict):
                summary["alicrm_customer_info_keys"] = sorted(customer_info.keys())[:160]
            summary["field_presence"] = {
                "buyerInfo.companyName": has_value(buyer_info, "companyName"),
                "buyerInfo.country": has_value(buyer_info, "country"),
                "buyerInfo.companyWebSite": has_value(buyer_info, "companyWebSite"),
                "buyerInfo.buyerContactInfo": isinstance(buyer_info, dict) and isinstance(buyer_info.get("buyerContactInfo"), dict),
                "alicrmCustomerInfo.companyName": has_value(customer_info, "companyName"),
                "alicrmCustomerInfo.registerDate": has_value(customer_info, "registerDate"),
                "alicrmCustomerInfo.customerId": has_value(customer_info, "customerId"),
                "alicrmCustomerInfo.buyerContactInfo": isinstance(customer_info, dict)
                and isinstance(customer_info.get("buyerContactInfo"), dict),
            }
    return summary


def has_value(obj: Any, key: str) -> bool:
    return isinstance(obj, dict) and obj.get(key) not in (None, "")


def build_customer_query(params: dict[str, str]) -> dict[str, str]:
    query = {
        "buyerAccountId": params.get("contactAccountIdEncrypt") or params.get("activeAccountIdEncrypt") or "",
        "buyerLoginId": params.get("buyerLoginId") or params.get("chatLoginId") or params.get("contactLoginId") or "",
        "secTradeId": params.get("secTradeId") or params.get("tradeIdEncrypt") or params.get("inquiryIdEncrypt") or "",
        "secReqToken": params.get("secReqToken") or "",
        "clientType": params.get("fromPage") or "nativepc",
        "lang": "zh_CN",
    }
    return {key: value for key, value in query.items() if value}


def build_exact_customer_query(params: dict[str, str], runtime_state: dict[str, Any]) -> dict[str, str]:
    kht_token = runtime_state.get("khtAccessToken") if isinstance(runtime_state, dict) else ""
    query = {
        "buyerAccountId": params.get("contactAccountIdEncrypt") or params.get("activeAccountIdEncrypt") or "",
        "secTradeId": params.get("secTradeId") or params.get("tradeIdEncrypt") or params.get("inquiryIdEncrypt") or "",
        "buyerLoginId": params.get("buyerLoginId") or params.get("chatLoginId") or params.get("contactLoginId") or "",
        "secReqToken": kht_token or params.get("secReqToken") or "",
        "clientType": params.get("clientType") or params.get("formPage") or "",
        "lang": "zh_CN",
    }
    return {key: value for key, value in query.items() if value}


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    cookies = extract_cookies(LOG_PATHS)
    context = extract_latest_alicrm_context(LOG_PATHS)
    output: dict[str, Any] = {
        "ok": False,
        "chrome_found": CHROME_PATH.exists(),
        "cookie_count": len(cookies),
        "alicrm_context": {
            "found_url": bool(context.get("found_url")),
            "param_keys": sorted((context.get("params") or {}).keys()),
        },
    }
    if not context.get("url"):
        print(json.dumps({**output, "error": "no_alicrm_url"}, ensure_ascii=False, indent=2))
        return 2

    proc = None
    ws = None
    try:
        proc = launch_chrome()
        ws_url = wait_for_debugger(PORT)
        ws = CDPWebSocket(ws_url)
        ws.call("Page.enable")
        ws.call("Runtime.enable")
        ws.call("Network.enable")
        ws.call(
            "Network.setUserAgentOverride",
            {
                "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/108 Safari/537.36 AlibabaSupplier/11.39.80E",
                "acceptLanguage": "zh-CN,zh;q=0.9,en;q=0.8",
                "platform": "Windows",
            },
        )
        cookie_params = []
        for name, value in cookies.items():
            for url in ("https://onetalk.alibaba.com/", "https://alicrm.alibaba.com/"):
                cookie_params.append(
                    {
                        "url": url,
                        "name": name,
                        "value": value,
                        "domain": ".alibaba.com",
                        "path": "/",
                        "secure": True,
                        "expires": int(time.time()) + 3600,
                    }
                )
        set_cookie_response = ws.call("Network.setCookies", {"cookies": cookie_params})
        all_cookies_response = ws.call("Network.getAllCookies")
        accepted_cookie_names = {
            item.get("name")
            for item in all_cookies_response.get("result", {}).get("cookies", [])
            if "alibaba.com" in (item.get("domain") or "")
        }

        ws.call("Page.navigate", {"url": context["url"]})
        deadline = time.time() + 35
        page_state = {}
        while time.time() < deadline:
            page_state = evaluate(
                ws,
                """(() => ({
                  readyState: document.readyState,
                  title: document.title,
                  host: location.host,
                  path: location.pathname,
                  looksLikeLogin: /login|newlogin/i.test(location.href + document.body.innerText.slice(0, 500)),
                  hasIcbuIM: !!window.IcbuIM,
                  hasRequestHelper: !!(window.IcbuIM && window.IcbuIM.lib && window.IcbuIM.lib.requestHelper),
                  hasRequestHelperJsonp: !!(window.IcbuIM && window.IcbuIM.lib && window.IcbuIM.lib.requestHelper && window.IcbuIM.lib.requestHelper.jsonp),
                  hasKHTAccessToken: !!window.KHTAccessToken,
                  khtAccessToken: window.KHTAccessToken || "",
                  hasCurrentUserAccountId: !!window.currentUserAccountId,
                  bodyTextLength: document.body ? document.body.innerText.length : 0
                }))()""",
                timeout=5,
            )
            if isinstance(page_state, dict) and page_state.get("readyState") == "complete":
                break
            time.sleep(1)

        query = build_customer_query(context.get("params") or {})
        endpoint = "https://alicrm.alibaba.com/jsonp/customerPluginQueryServiceI/queryCustomerInfo.json"
        query_json = json.dumps(query, ensure_ascii=False)
        endpoint_json = json.dumps(endpoint)
        jsonp_state = evaluate(
            ws,
            f"""(async () => {{
              const endpoint = {endpoint_json};
              const query = {query_json};
              const params = new URLSearchParams(query);
              const callbackName = "__alicrmProbe_" + Math.random().toString(36).slice(2);
              params.set("callback", callbackName);
              return await new Promise((resolve) => {{
                const timer = setTimeout(() => {{
                  try {{ delete window[callbackName]; }} catch (e) {{}}
                  resolve({{ ok: false, event: "timeout" }});
                }}, 12000);
                window[callbackName] = (data) => {{
                  clearTimeout(timer);
                  try {{ delete window[callbackName]; }} catch (e) {{}}
                  resolve({{ ok: true, event: "callback", data }});
                }};
                const script = document.createElement("script");
                script.src = endpoint + "?" + params.toString();
                script.onerror = () => {{
                  clearTimeout(timer);
                  try {{ delete window[callbackName]; }} catch (e) {{}}
                  resolve({{ ok: false, event: "script-error" }});
                }};
                document.head.appendChild(script);
              }});
            }})()""",
            timeout=20,
        )
        response_data = jsonp_state.get("data") if isinstance(jsonp_state, dict) else None
        exact_query = build_exact_customer_query(context.get("params") or {}, page_state if isinstance(page_state, dict) else {})
        exact_query_json = json.dumps(exact_query, ensure_ascii=False)
        helper_jsonp_state = evaluate(
            ws,
            f"""(async () => {{
              const query = {exact_query_json};
              const helper = window.IcbuIM && window.IcbuIM.lib && window.IcbuIM.lib.requestHelper;
              if (!helper || !helper.jsonp) return {{ ok: false, event: "missing-helper" }};
              try {{
                const data = await helper.jsonp("//alicrm.alibaba.com/jsonp/customerPluginQueryServiceI/queryCustomerInfo.json", {{
                  type: "jsonp",
                  data: query
                }});
                return {{ ok: true, event: "helper-jsonp", data }};
              }} catch (error) {{
                return {{ ok: false, event: "helper-error", errorName: error && error.name, errorMessageLength: String(error && error.message || error).length }};
              }}
            }})()""",
            timeout=25,
        )
        helper_response_data = helper_jsonp_state.get("data") if isinstance(helper_jsonp_state, dict) else None
        safe_page_state = dict(page_state) if isinstance(page_state, dict) else page_state
        if isinstance(safe_page_state, dict):
            safe_page_state.pop("khtAccessToken", None)
        output.update(
            {
                "ok": True,
                "cookie_injection": {
                    "requested_count": len(cookie_params),
                    "accepted_name_count": len(accepted_cookie_names),
                    "has_cdp_error": "error" in set_cookie_response,
                    "cdp_error_code": (set_cookie_response.get("error") or {}).get("code"),
                    "cdp_error_message_length": len((set_cookie_response.get("error") or {}).get("message") or ""),
                },
                "page_state": safe_page_state,
                "jsonp_state": {
                    "ok": isinstance(jsonp_state, dict) and bool(jsonp_state.get("ok")),
                    "event": jsonp_state.get("event") if isinstance(jsonp_state, dict) else None,
                },
                "helper_jsonp_state": {
                    "ok": isinstance(helper_jsonp_state, dict) and bool(helper_jsonp_state.get("ok")),
                    "event": helper_jsonp_state.get("event") if isinstance(helper_jsonp_state, dict) else None,
                    "errorName": helper_jsonp_state.get("errorName") if isinstance(helper_jsonp_state, dict) else None,
                    "errorMessageLength": helper_jsonp_state.get("errorMessageLength") if isinstance(helper_jsonp_state, dict) else None,
                },
                "customer_response": summarize_customer_response(response_data),
                "helper_customer_response": summarize_customer_response(helper_response_data),
            }
        )
    except Exception as exc:
        output.update({"ok": False, "error_type": type(exc).__name__, "error_message_length": len(str(exc))})
    finally:
        if ws:
            ws.close()
        if proc:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        try:
            if PROFILE_DIR.exists() and str(PROFILE_DIR).startswith(str(Path.cwd())):
                shutil.rmtree(PROFILE_DIR, ignore_errors=True)
        except Exception:
            pass

    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if output.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
