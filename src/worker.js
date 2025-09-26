export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // API handlery
    if (request.method === "POST" && (path === "/v" || path === "/verify")) {
      return verifyHandler(request, env);
    }
    if (request.method === "GET" && (path === "/g" || path === "/go")) {
      return goHandler(url, env);
    }
    if (request.method === "GET" && path === "/health") {
      return new Response("ok", { status: 200 });
    }

    // Pokud se nenašla žádná API cesta, Cloudflare se pokusí doručit
    // statický soubor ze složky 'public'. Pokud ani ten nenajde, vrátí 404.
    // Tuto odpověď uvidí uživatel, jen pokud statický soubor neexistuje.
    return new Response("Not found.", { status: 404 });
  },
};

async function verifyHandler(request, env) {
  if (!env.TURNSTILE_SECRET || !env.SIGNING_SECRET || !env.TICKETS) {
    return json({ error: "server_misconfig" }, 500);
  }

  const body = await safeJson(request);
  const token = (body && (body.t || body.token)) || "";
  if (!token) return json({ error: "missing token" }, 400);

  const form = new URLSearchParams();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (ip) form.append("remoteip", ip);

  let res;
  try {
    const ver = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    res = await ver.json();
  } catch {
    return json({ error: "verify_request_failed" }, 502);
  }

  if (!res?.success) {
    return json({ error: "verification_failed", codes: res["error-codes"] || null }, 403);
  }

  const id = cryptoRandomId();
  const ttl = 60;
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${id}.${issuedAt}.${ttl}`;
  let sig;
  try {
    sig = await hmac(env.SIGNING_SECRET, payload);
  } catch (e) {
    return json({ error: "signing_failed" }, 500);
  }

  await env.TICKETS.put(`t:${id}`, "1", { expirationTtl: ttl });

  const ticket = `${id}.${issuedAt}.${ttl}.${sig}`;
  return json({ k: ticket });
}

async function goHandler(url, env) {
    if (!env.SIGNING_SECRET || !env.TARGET_URL || !env.TICKETS) {
        return json({ error: "server_misconfig" }, 500);
    }

  const ticket = url.searchParams.get("ticket") || "";
  const parts = ticket.split(".");
  if (parts.length !== 4) return json({ error: "bad ticket" }, 400);

  const [id, issuedAtStr, ttlStr, sig] = parts;
  const payload = `${id}.${issuedAtStr}.${ttlStr}`;
  let expectSig;
  try {
    expectSig = await hmac(env.SIGNING_SECRET, payload);
  } catch (e) {
    return json({ error: "signing_failed" }, 500);
  }
  if (sig !== expectSig) return json({ error: "bad signature" }, 403);

  const issuedAt = Number(issuedAtStr) | 0;
  const ttl = Number(ttlStr) | 0;
  const now = Math.floor(Date.now() / 1000);
  if (!issuedAt || !ttl || now > issuedAt + ttl) return json({ error: "expired" }, 403);

  const key = `t:${id}`;
  const exists = await env.TICKETS.get(key);
  if (!exists) return json({ error: "already used or unknown" }, 403);
  
  await env.TICKETS.delete(key);

  return new Response(null, { status: 303, headers: { Location: env.TARGET_URL } });
}

/* ---------- UTILS ---------- */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
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
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/,'');
}
