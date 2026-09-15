/**
 * MDH-API — request importer.
 *
 * Turns a pasted snippet into { format, method, url, headers, body, warnings }
 * so the request form can fill itself in. Four input shapes are recognised:
 *
 *   curl    curl -X POST https://example.com/hook -H 'X-Key: abc' -d '{"a":1}'
 *   fetch   fetch("https://example.com/hook", { method: "POST", ... })
 *   httpie  http POST example.com/hook event=created X-Key:abc
 *   url     https://example.com/hook
 *
 * Nothing here touches the DOM and nothing is eval'd — pasted text is data,
 * so the fetch() form is read by a small literal parser rather than executed.
 */
(function (global) {
  "use strict";

  const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

  /* ---------------------------------------------------------------- shell */

  // Splits a command line the way a POSIX shell would: honours single quotes,
  // double quotes with escapes, $'...' quoting, and backslash/caret line
  // continuations (the latter for commands copied out of Windows).
  function tokenize(input) {
    const tokens = [];
    let current = "";
    let started = false;
    let i = 0;

    const flush = () => {
      if (started) tokens.push(current);
      current = "";
      started = false;
    };

    while (i < input.length) {
      const ch = input[i];

      if (ch === "\\" && (input[i + 1] === "\n" || input[i + 1] === "\r")) {
        i += input[i + 1] === "\r" && input[i + 2] === "\n" ? 3 : 2;
        continue;
      }
      if (ch === "^" && input[i + 1] === "\n") {
        i += 2;
        continue;
      }
      if (/\s/.test(ch)) {
        flush();
        i++;
        continue;
      }

      if (ch === "$" && input[i + 1] === "'") {
        i += 2;
        started = true;
        while (i < input.length && input[i] !== "'") {
          if (input[i] === "\\") {
            const map = { n: "\n", t: "\t", r: "\r", "'": "'", "\\": "\\" };
            const next = input[i + 1];
            current += next in map ? map[next] : next;
            i += 2;
            continue;
          }
          current += input[i++];
        }
        i++;
        continue;
      }

      if (ch === "'") {
        i++;
        started = true;
        while (i < input.length && input[i] !== "'") current += input[i++];
        i++;
        continue;
      }

      if (ch === '"') {
        i++;
        started = true;
        while (i < input.length && input[i] !== '"') {
          if (input[i] === "\\" && i + 1 < input.length) {
            const map = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", $: "$", "`": "`" };
            const next = input[i + 1];
            current += next in map ? map[next] : next;
            i += 2;
            continue;
          }
          current += input[i++];
        }
        i++;
        continue;
      }

      current += ch;
      started = true;
      i++;
    }

    flush();
    return tokens;
  }

  /* --------------------------------------------------------------- shared */

  function setHeader(headers, name, value) {
    if (!name) return;
    const existing = Object.keys(headers).find(
      (key) => key.toLowerCase() === name.toLowerCase()
    );
    headers[existing || name] = value;
  }

  function hasHeader(headers, name) {
    return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
  }

  function addRawHeader(headers, raw) {
    if (!raw) return;
    const separator = raw.indexOf(":");
    if (separator === -1) return;
    const name = raw.slice(0, separator).trim();
    const value = raw.slice(separator + 1).trim();
    if (name) setHeader(headers, name, value);
  }

  function looksLikeJson(text) {
    if (typeof text !== "string") return false;
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }

  function prettyIfJson(text) {
    if (!looksLikeJson(text)) return text;
    return JSON.stringify(JSON.parse(text), null, 2);
  }

  function toBase64(text) {
    try {
      return btoa(unescape(encodeURIComponent(text)));
    } catch {
      return btoa(text);
    }
  }

  function normalizeUrl(raw, warnings) {
    if (!raw) return raw;
    let url = raw.trim().replace(/^['"]|['"]$/g, "");

    if (/^https:\/\//i.test(url)) return url;

    if (/^http:\/\//i.test(url)) {
      warnings.push("The snippet used http://; switched to https:// because deliveries are https-only.");
      return url.replace(/^http:\/\//i, "https://");
    }

    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return "https://" + url;
    return url;
  }

  /* ----------------------------------------------------------------- curl */

  const CURL_VALUE_FLAGS_TO_SKIP = new Set([
    "-o", "--output", "-m", "--max-time", "--connect-timeout", "--retry",
    "--resolve", "--cacert", "--cert", "--key", "--proxy", "-x", "--limit-rate",
    "-w", "--write-out", "--cookie-jar", "-c",
  ]);

  function parseCurl(tokens) {
    const headers = {};
    const warnings = [];
    const dataParts = [];
    let method = null;
    let url = null;
    let multipart = false;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const take = () => tokens[++i];

      if (i === 0 && /^curl(\.exe)?$/i.test(token)) continue;

      if (token === "-X" || token === "--request") { method = String(take() || "").toUpperCase(); continue; }
      if (/^-X./.test(token)) { method = token.slice(2).toUpperCase(); continue; }
      if (token.startsWith("--request=")) { method = token.slice(10).toUpperCase(); continue; }

      if (token === "-H" || token === "--header") { addRawHeader(headers, take()); continue; }
      if (token.startsWith("--header=")) { addRawHeader(headers, token.slice(9)); continue; }
      if (/^-H./.test(token)) { addRawHeader(headers, token.slice(2)); continue; }

      if (["-d", "--data", "--data-raw", "--data-binary", "--data-ascii"].includes(token)) { dataParts.push(take()); continue; }
      if (token.startsWith("--data-raw=")) { dataParts.push(token.slice(11)); continue; }
      if (token.startsWith("--data=")) { dataParts.push(token.slice(7)); continue; }
      if (/^-d./.test(token)) { dataParts.push(token.slice(2)); continue; }

      if (token === "--data-urlencode") {
        const raw = String(take() || "");
        const separator = raw.indexOf("=");
        dataParts.push(
          separator === -1
            ? encodeURIComponent(raw)
            : raw.slice(0, separator) + "=" + encodeURIComponent(raw.slice(separator + 1))
        );
        continue;
      }

      if (token === "--json") {
        dataParts.push(take());
        if (!hasHeader(headers, "content-type")) setHeader(headers, "Content-Type", "application/json");
        if (!hasHeader(headers, "accept")) setHeader(headers, "Accept", "application/json");
        continue;
      }

      if (token === "-F" || token === "--form" || token === "--form-string") {
        multipart = true;
        dataParts.push(take());
        continue;
      }

      if (token === "-u" || token === "--user") {
        setHeader(headers, "Authorization", "Basic " + toBase64(String(take() || "")));
        continue;
      }
      if (token === "-A" || token === "--user-agent") { setHeader(headers, "User-Agent", take()); continue; }
      if (token === "-e" || token === "--referer") { setHeader(headers, "Referer", take()); continue; }
      if (token === "-b" || token === "--cookie") { setHeader(headers, "Cookie", take()); continue; }
      if (token === "--url") { url = take(); continue; }

      if (CURL_VALUE_FLAGS_TO_SKIP.has(token)) { take(); continue; }
      if (token.startsWith("-")) continue;
      if (!url) url = token;
    }

    if (multipart) {
      warnings.push("Multipart form fields (-F) were imported as text; adjust the body by hand if the destination expects a real multipart upload.");
    }

    let body = dataParts.filter(Boolean).join("&");

    if (!method) method = body ? "POST" : "GET";

    if (body && !hasHeader(headers, "content-type")) {
      setHeader(headers, "Content-Type", looksLikeJson(body) ? "application/json" : "application/x-www-form-urlencoded");
    }

    return { format: "curl", method, url, headers, body: prettyIfJson(body), warnings };
  }

  /* ------------------------------------------------- javascript literals */

  function skipWhitespace(src, i) {
    while (i < src.length) {
      if (/\s/.test(src[i])) { i++; continue; }
      if (src[i] === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (src[i] === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
      break;
    }
    return i;
  }

  function readJsString(src, i) {
    const quote = src[i++];
    let value = "";
    while (i < src.length && src[i] !== quote) {
      if (src[i] === "\\") {
        const map = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };
        const next = src[i + 1];
        if (next === "u") {
          if (src[i + 2] === "{") {
            const end = src.indexOf("}", i + 3);
            value += String.fromCodePoint(parseInt(src.slice(i + 3, end), 16));
            i = end + 1;
            continue;
          }
          value += String.fromCharCode(parseInt(src.substr(i + 2, 4), 16));
          i += 6;
          continue;
        }
        if (next === "x") { value += String.fromCharCode(parseInt(src.substr(i + 2, 2), 16)); i += 4; continue; }
        if (next === "\n") { i += 2; continue; }
        value += next in map ? map[next] : next;
        i += 2;
        continue;
      }
      value += src[i++];
    }
    return { value, next: i + 1 };
  }

  function readJsValue(src, i) {
    i = skipWhitespace(src, i);
    const ch = src[i];

    if (ch === '"' || ch === "'" || ch === "`") return readJsString(src, i);
    if (ch === "{") return readJsObject(src, i);
    if (ch === "[") return readJsArray(src, i);

    let j = i;
    let depth = 0;
    while (j < src.length) {
      const c = src[j];
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) { if (depth === 0) break; depth--; }
      else if (c === "," && depth === 0) break;
      j++;
    }

    const raw = src.slice(i, j).trim();
    let value = raw;
    if (raw === "true") value = true;
    else if (raw === "false") value = false;
    else if (raw === "null" || raw === "undefined") value = null;
    else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) value = Number(raw);
    return { value, next: j };
  }

  function readJsArray(src, i) {
    const items = [];
    i++;
    while (i < src.length) {
      i = skipWhitespace(src, i);
      if (src[i] === "]") { i++; break; }
      if (src[i] === ",") { i++; continue; }
      const result = readJsValue(src, i);
      items.push(result.value);
      i = result.next;
    }
    return { value: items, next: i };
  }

  function readJsObject(src, i) {
    const object = {};
    i++;
    while (i < src.length) {
      i = skipWhitespace(src, i);
      if (src[i] === "}") { i++; break; }
      if (src[i] === ",") { i++; continue; }

      let key;
      if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
        const result = readJsString(src, i);
        key = result.value;
        i = result.next;
      } else {
        let j = i;
        while (j < src.length && !":}".includes(src[j]) && !/\s/.test(src[j])) j++;
        key = src.slice(i, j);
        i = j;
      }

      i = skipWhitespace(src, i);
      if (src[i] !== ":") { i++; continue; }
      i++;

      const result = readJsValue(src, i);
      object[key] = result.value;
      i = result.next;
    }
    return { value: object, next: i };
  }

  function parseFetch(input) {
    const warnings = [];
    const start = input.indexOf("fetch(");
    if (start === -1) return null;

    let i = start + "fetch(".length;
    const first = readJsValue(input, i);
    if (typeof first.value !== "string") return null;
    const url = first.value;

    i = skipWhitespace(input, first.next);
    let options = {};
    if (input[i] === ",") {
      const second = readJsValue(input, i + 1);
      if (second.value && typeof second.value === "object" && !Array.isArray(second.value)) {
        options = second.value;
      }
    }

    const headers = {};
    const rawHeaders = options.headers;
    if (rawHeaders && typeof rawHeaders === "object") {
      if (Array.isArray(rawHeaders)) {
        rawHeaders.forEach((pair) => {
          if (Array.isArray(pair) && pair.length >= 2) setHeader(headers, String(pair[0]), String(pair[1]));
        });
      } else {
        Object.entries(rawHeaders).forEach(([name, value]) => setHeader(headers, name, String(value)));
      }
    }

    let body = options.body;
    if (body !== undefined && body !== null && typeof body !== "string") {
      body = JSON.stringify(body, null, 2);
    }
    if (typeof body === "string" && /^JSON\.stringify\(/.test(body.trim())) {
      warnings.push("The body was a JSON.stringify(...) call; its argument was imported as-is.");
    }

    const method = String(options.method || (body ? "POST" : "GET")).toUpperCase();

    if (body && !hasHeader(headers, "content-type")) {
      setHeader(headers, "Content-Type", looksLikeJson(body) ? "application/json" : "text/plain");
    }

    return { format: "fetch", method, url, headers, body: prettyIfJson(body || ""), warnings };
  }

  /* --------------------------------------------------------------- httpie */

  function parseHttpie(tokens) {
    const headers = {};
    const warnings = [];
    const jsonFields = {};
    const formFields = [];
    const queryParams = [];
    let method = null;
    let url = null;
    let useForm = false;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const take = () => tokens[++i];

      if (i === 0 && /^(http|https|httpie)$/i.test(token)) continue;

      if (token === "-f" || token === "--form") { useForm = true; continue; }
      if (token === "-j" || token === "--json") { useForm = false; continue; }
      if (token === "-a" || token === "--auth") {
        setHeader(headers, "Authorization", "Basic " + toBase64(String(take() || "")));
        continue;
      }
      if (token.startsWith("-")) continue;

      if (!method && !url && HTTP_METHODS.includes(token.toUpperCase())) {
        method = token.toUpperCase();
        continue;
      }
      if (!url) { url = token; continue; }

      if (token.includes("==")) {
        const [name, ...rest] = token.split("==");
        queryParams.push(encodeURIComponent(name) + "=" + encodeURIComponent(rest.join("==")));
        continue;
      }
      if (token.includes(":=")) {
        const [name, ...rest] = token.split(":=");
        const raw = rest.join(":=");
        try { jsonFields[name] = JSON.parse(raw); } catch { jsonFields[name] = raw; }
        continue;
      }
      if (/^[^:=]+=/.test(token)) {
        const separator = token.indexOf("=");
        const name = token.slice(0, separator);
        const value = token.slice(separator + 1);
        jsonFields[name] = value;
        formFields.push(encodeURIComponent(name) + "=" + encodeURIComponent(value));
        continue;
      }
      if (token.includes(":")) {
        addRawHeader(headers, token);
        continue;
      }
    }

    const hasBody = Object.keys(jsonFields).length > 0;
    if (!method) method = hasBody ? "POST" : "GET";

    let body = "";
    if (hasBody) {
      if (useForm) {
        body = formFields.join("&");
        if (!hasHeader(headers, "content-type")) setHeader(headers, "Content-Type", "application/x-www-form-urlencoded");
      } else {
        body = JSON.stringify(jsonFields, null, 2);
        if (!hasHeader(headers, "content-type")) setHeader(headers, "Content-Type", "application/json");
      }
    }

    if (queryParams.length && url) {
      url += (url.includes("?") ? "&" : "?") + queryParams.join("&");
    }

    if (!hasHeader(headers, "accept") && !useForm) setHeader(headers, "Accept", "application/json");

    return { format: "httpie", method, url, headers, body, warnings };
  }

  /* --------------------------------------------------------------- entry */

  function parseRequestSnippet(input) {
    if (typeof input !== "string") return null;
    const text = input.trim();
    if (!text) return null;

    let parsed = null;

    if (/^https?:\/\/\S+$/i.test(text)) {
      parsed = { format: "url", method: null, url: text, headers: {}, body: null, warnings: [] };
    } else if (/^curl(\.exe)?\b/i.test(text)) {
      parsed = parseCurl(tokenize(text));
    } else if (/\bfetch\s*\(/.test(text)) {
      parsed = parseFetch(text);
    } else if (/^(http|https|httpie)\s+\S/i.test(text)) {
      parsed = parseHttpie(tokenize(text));
    }

    if (!parsed || !parsed.url) return null;

    parsed.warnings = parsed.warnings || [];
    parsed.url = normalizeUrl(parsed.url, parsed.warnings);
    return parsed;
  }

  global.MDHImport = { parseRequestSnippet, tokenize };
})(window);
