export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // API handlery
    if (request.method === "POST" && (path === "/v" || path === "/verify")) {
      return verifyHandler(request, env);
    }
    if (request.method === "GET" && (path === "/g" || path === "/go")) {
      return goHandler(url, env, request);
    }
    if (request.method === "GET" && path === "/health") {
      return new Response("ok", { status: 200 });
    }

    // Fallback
    return new Response("Not found.", { status: 404 });
  },
};

async function verifyHandler(request, env) {
  if (!env.TURNSTILE_SECRET || !env.SIGNING_SECRET || !env.TICKETS) {
    return json({ error: "server_misconfig" }, 500);
  }

  const body = await safeJson(request);
  const token = (body && (body.t || body.token)) || "";
  if (!token) return json({ error: "missing_token" }, 400);

  // ---- Turnstile siteverify ----
  const form = new URLSearchParams();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);

  const ip = request.headers.get("cf-connecting-ip") || "";
  if (ip) form.append("remoteip", ip);

  let res;
  try {
    const ver = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    res = await ver.json();
  } catch {
    return json({ error: "verify_request_failed" }, 502);
  }

  if (!res?.success) {
    return json({ error: "verification_failed", codes: res["error-codes"] || null }, 403);
  }

  // ---- NOVÉ: ověření hostname (+ měkce action) ----
  const EXPECTED_HOSTNAME = "pospichame.com"; // případně dej do ENV
  const EXPECTED_ACTION = "go";               // měkké ověření (jen pokud Turnstile vrátí)

  if (res.hostname && res.hostname !== EXPECTED_HOSTNAME) {
    return json({ error: "verification_failed", codes: ["bad-hostname"], got: res.hostname }, 403);
  }
  if (res.action && res.action !== EXPECTED_ACTION) {
    return json({ error: "verification_failed", codes: ["bad-action"], got: res.action }, 403);
  }

  // ---- Ticket (HMAC + TTL) + NOVÉ: kontext (UA + IP prefix) ----
  const ua = request.headers.get("user-agent") || "";
  const ua_hash = await sha256hex(ua);
  const ip_prefix = ipToV4Prefix24(ip);

  const id = cryptoRandomId();
  const ttl = 60; // 60 sekund
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${id}.${issuedAt}.${ttl}`;

  let sig;
  try {
    sig = await hmac(env.SIGNING_SECRET, payload);
  } catch {
    return json({ error: "signing_failed" }, 500);
  }

  // Ulož kontext k ticketu (jednorázový záznam)
  const record = { ua_hash, ip_prefix };
  await env.TICKETS.put(`t:${id}`, JSON.stringify(record), { expirationTtl: ttl });

  const ticket = `${id}.${issuedAt}.${ttl}.${sig}`;
  return json({ k: ticket });
}

async function goHandler(url, env, request) {
  if (!env.SIGNING_SECRET || !env.TARGET_URL || !env.TICKETS) {
    return json({ error: "server_misconfig" }, 500);
  }

  const ticket = url.searchParams.get("ticket") || "";
  const parts = ticket.split(".");
  if (parts.length !== 4) return json({ error: "bad_ticket" }, 400);

  const [id, issuedAtStr, ttlStr, sig] = parts;
  const payload = `${id}.${issuedAtStr}.${ttlStr}`;
  let expectSig;
  try {
    expectSig = await hmac(env.SIGNING_SECRET, payload);
  } catch {
    return json({ error: "signing_failed" }, 500);
  }
  if (sig !== expectSig) return json({ error: "bad_signature" }, 403);

  const issuedAt = Number(issuedAtStr) | 0;
  const ttl = Number(ttlStr) | 0;
  const now = Math.floor(Date.now() / 1000);
  if (!issuedAt || !ttl || now > issuedAt + ttl) return json({ error: "expired" }, 403);

  const key = `t:${id}`;
  const packed = await env.TICKETS.get(key);
  if (!packed) return json({ error: "already_used_or_unknown" }, 403);

  // ---- NOVÉ: ověř UA + IP prefix (tolerantní) ----
  let rec = null;
  try { rec = JSON.parse(packed); } catch {}
  if (rec && typeof rec === "object") {
    const uaNow = request.headers.get("user-agent") || "";
    const ipNow = request.headers.get("cf-connecting-ip") || "";
    const ua_hash_now = await sha256hex(uaNow);
    const ip_prefix_now = ipToV4Prefix24(ipNow);

    if (rec.ua_hash && rec.ua_hash !== ua_hash_now) {
      return json({ error: "ctx_mismatch", field: "ua" }, 400);
    }
    if (rec.ip_prefix && rec.ip_prefix !== ip_prefix_now) {
      return json({ error: "ctx_mismatch", field: "ip" }, 400);
    }
  }

  // spotřebuj ticket (one-time)
  await env.TICKETS.delete(key);

  return new Response(null, {
    status: 303,
    headers: {
      Location: env.TARGET_URL,
      ...secureHeaders,
    },
  });
}

/* ---------- UTILS ---------- */
const secureHeaders = {
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...secureHeaders,
    },
  });
}

async function safeJson(request) {
  try { return await request.json(); } catch { return null; }
}

function cryptoRandomId() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---- NOVÉ helpery pro kontext ----
async function sha256hex(s) {
  const d = new TextEncoder().encode(s || "");
  const h = await crypto.subtle.digest("SHA-256", d);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function ipToV4Prefix24(ip) {
  if (!ip || !ip.includes(".")) return ip || ""; // pro IPv6 ponecháme celý string (nebo si pak udělej /48)
  const p = ip.split(".");
  return `${p[0]}.${p[1]}.${p[2]}.0/24`;
}
