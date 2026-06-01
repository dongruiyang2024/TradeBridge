#!/usr/bin/env node
import { readFileSync } from "node:fs";

const harPath = process.argv[2] || "/Users/wait9yan/Downloads/onetalk.alibaba.com.har";
const har = JSON.parse(readFileSync(harPath, "utf8"));
const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];

const interestingKey = /(name|nick|display|company|first|last|contact|login|buyer|customer|member|profile|portrait|avatar|country|info|tag)/i;
const sensitiveKey = /(token|cookie|sign|password|secret|authorization|chatToken|csrf|sid|uid|device|did)/i;

const summaries = [];

for (const entry of entries) {
  const request = entry.request || {};
  const response = entry.response || {};
  const url = safeUrl(request.url || "");
  const method = request.method || "GET";
  const status = response.status;
  const resourceType = entry._resourceType || entry._initiator?.type || "";
  const requestShape = summarizeRequest(request);
  const parsedResponse = parsePayload(response.content?.text || "");
  const responseShape = summarizePayload(parsedResponse);
  const matches = [];
  if (parsedResponse.ok) {
    collectInterestingPaths(parsedResponse.value, "", matches, 0);
  }

  const isRelevant =
    /onetalk\.alibaba\.com|acs\.h\.alibaba\.com|alicrm\.alibaba\.com|message\.alibaba\.com|wss-icbu\.dingtalk\.com/.test(url.host || "") ||
    requestShape.api ||
    matches.length > 0;

  if (!isRelevant) continue;

  summaries.push({
    method,
    host: url.host,
    path: url.path,
    status,
    resourceType,
    api: requestShape.api,
    requestDataKeys: requestShape.dataKeys,
    requestPostKeys: requestShape.postKeys,
    responseParsed: parsedResponse.ok,
    responseTopKeys: responseShape.topKeys,
    responseArrays: responseShape.arrays.slice(0, 10),
    interestingPathCount: matches.length,
    interestingPaths: compactPathMatches(matches).slice(0, 50)
  });
}

const withInterestingPaths = summaries
  .filter((item) => item.interestingPathCount > 0)
  .sort((a, b) => b.interestingPathCount - a.interestingPathCount);

const candidateApis = summaries
  .filter((item) => {
    const haystack = [
      item.host,
      item.path,
      item.api,
      ...(item.requestDataKeys || []),
      ...(item.responseTopKeys || []),
      ...item.interestingPaths.map((path) => path.path)
    ].join(" ");
    return /(queryCustomerInfo|customer|buyer|member|contact|profile|name|login|listRecentConversationContactDetail|UserInfo|Tag)/i.test(haystack);
  })
  .sort((a, b) => b.interestingPathCount - a.interestingPathCount);

printJson({
  harPath,
  totalEntries: entries.length,
  relevantEntries: summaries.length,
  endpointsWithInterestingNameLikePaths: withInterestingPaths.length,
  candidateApis: candidateApis.slice(0, 80)
});

function summarizeRequest(request) {
  const query = Object.fromEntries((request.queryString || []).map((item) => [item.name, item.value]));
  const postText = request.postData?.text || "";
  const postPayload = parsePayload(postText);
  const requestData = query.data ? parsePayload(decodeMaybe(query.data)) : { ok: false };
  const postKeys = postPayload.ok && isRecord(postPayload.value) ? Object.keys(postPayload.value).sort().filter((key) => !sensitiveKey.test(key)) : [];
  const dataKeys = requestData.ok && isRecord(requestData.value) ? Object.keys(requestData.value).sort().filter((key) => !sensitiveKey.test(key)) : [];
  return {
    api: typeof query.api === "string" ? query.api : undefined,
    dataKeys,
    postKeys
  };
}

function summarizePayload(parsed) {
  if (!parsed.ok) return { topKeys: [], arrays: [] };
  const arrays = [];
  visitArrays(parsed.value, "", arrays, 0);
  return {
    topKeys: isRecord(parsed.value) ? Object.keys(parsed.value).sort().filter((key) => !sensitiveKey.test(key)).slice(0, 30) : [],
    arrays
  };
}

function visitArrays(value, path, arrays, depth) {
  if (depth > 5 || arrays.length >= 20) return;
  if (Array.isArray(value)) {
    const sample = value.find(isRecord);
    arrays.push({
      path: path || "$",
      length: value.length,
      sampleKeys: sample ? Object.keys(sample).sort().filter((key) => !sensitiveKey.test(key)).slice(0, 30) : []
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey.test(key)) continue;
    visitArrays(child, path ? `${path}.${key}` : key, arrays, depth + 1);
  }
}

function collectInterestingPaths(value, path, output, depth) {
  if (depth > 8 || output.length >= 500) return;
  if (Array.isArray(value)) {
    const limit = Math.min(value.length, 3);
    for (let index = 0; index < limit; index += 1) {
      collectInterestingPaths(value[index], `${path}[]`, output, depth + 1);
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey.test(key)) continue;
    const nextPath = path ? `${path}.${key}` : key;
    if (interestingKey.test(key) && isPrimitive(child) && child !== "") {
      output.push({
        path: nextPath,
        type: child === null ? "null" : typeof child,
        hasValue: child !== null && child !== undefined && String(child).length > 0
      });
    }
    collectInterestingPaths(child, nextPath, output, depth + 1);
  }
}

function compactPathMatches(matches) {
  const byPath = new Map();
  for (const match of matches) {
    const key = match.path.replace(/\[\]\[\]/g, "[]");
    const current = byPath.get(key) || { path: key, type: match.type, valueCount: 0 };
    if (match.hasValue) current.valueCount += 1;
    byPath.set(key, current);
  }
  return Array.from(byPath.values()).sort((a, b) => b.valueCount - a.valueCount || a.path.localeCompare(b.path));
}

function parsePayload(text) {
  if (!text || typeof text !== "string") return { ok: false };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false };
  for (const candidate of unwrapCandidates(trimmed)) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {}
  }
  return { ok: false };
}

function unwrapCandidates(text) {
  const candidates = [text];
  const firstParen = text.indexOf("(");
  const lastParen = text.lastIndexOf(")");
  if (firstParen > 0 && lastParen > firstParen) {
    candidates.push(text.slice(firstParen + 1, lastParen));
  }
  if (text.startsWith("jsonp") && firstParen > 0 && lastParen > firstParen) {
    candidates.push(text.slice(firstParen + 1, lastParen));
  }
  return candidates;
}

function decodeMaybe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function safeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return { host: url.host, path: url.pathname };
  } catch {
    return { host: "", path: rawUrl.split("?")[0] || "" };
  }
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPrimitive(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
