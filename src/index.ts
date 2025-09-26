export interface Env {
  TICKETS: KVNamespace;
  TURNSTILE_SECRET: string;
  SIGNING_SECRET: string;
  TARGET_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

    // Pro vše ostatní se pokusíme servírovat statický soubor.
    // Cloudflare Workers toto řeší automaticky díky [assets] v wrangler.toml
    // a `NotFound` fallbacku, který zde není explicitně potřeba.
    // Pokud by soubor neexistoval, worker vrátí 404.

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;


async function verifyHandler(request: Request, env: Env): Promise<Response> {
  if (!env.TURNSTILE_SECRET) return json({ error: "server_misconfig", reason: "TURNSTILE_SECRET missing" }, 500);
  if (!env.SIGNING_SECRET)   return json({ error: "server_misconfig", reason: "SIGNING_SECRET missing" }, 500);
  if (!env.TICKETS || !env.TICKETS.put) return json({ error: "server_misconfig", reason: "KV binding TICKETS missing" }, 500);

  const body = await safeJson(request);
  const token = (body && (body.t || body.token)) || "";
  if (!token) return json({ error: "missing token" }, 400);

  const form = new URLSearchParams();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (ip) form.append("remoteip", ip);

  let res:any;
  try {
    const ver = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    res = await ver.json();
  } catch {
    return json({ error: "verify_request_failed" }, 502);
  }

  if (!res?.success) {
    return json({ error: "verification_failed", codes: res["error-codes"] || null, hostname: res.hostname || null }, 403);
  }

  const id = cryptoRandomId();
  const ttl = 60;
  const issuedAt = Math.floor(Date.now()/1000);
  const payload = `${id}.${issuedAt}.${ttl}`;
  let sig: string;
  try {
    sig = await hmac(env.SIGNING_SECRET, payload);
  } catch {
    return json({ error: "signing_failed" }, 500);
  }

  try {
    await env.TICKETS.put(`t:${id}`, "1", { expirationTtl: ttl });
  } catch {
    return json({ error: "kv_put_failed" }, 500);
  }

  const ticket = `${id}.${issuedAt}.${ttl}.${sig}`;
  return json({ k: ticket, ticket }, 200);
}

async function goHandler(url: URL, env: Env): Promise<Response> {
  const ticket = url.searchParams.get("ticket") || "";
  const parts = ticket.split(".");
  if (parts.length !== 4) return json({ error: "bad ticket" }, 400);

  const [id, issuedAtStr, ttlStr, sig] = parts;
  const payload = `${id}.${issuedAtStr}.${ttlStr}`;
  let expectSig: string;
  try {
    expectSig = await hmac(env.SIGNING_SECRET, payload);
  } catch {
    return json({ error: "signing_failed" }, 500);
  }
  if (sig !== expectSig) return json({ error: "bad signature" }, 403);

  const issuedAt = Number(issuedAtStr) | 0;
  const ttl = Number(ttlStr) | 0;
  const now = Math.floor(Date.now()/1000);
  if (!issuedAt || !ttl || now > issuedAt + ttl) return json({ error: "expired" }, 403);

  const key = `t:${id}`;
  try {
    const exists = await env.TICKETS.get(key);
    if (!exists) return json({ error: "already used or unknown" }, 403);
    await env.TICKETS.delete(key);
  } catch {
    return json({ error: "kv_access_failed" }, 500);
  }

  const target = env.TARGET_URL || "";
  if (!target) return json({ error: "no target configured" }, 500);

  return new Response(null, { status: 303, headers: { Location: target } });
}

/* ---------- UTILS ---------- */
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
async function safeJson(request: Request): Promise<any | null> {
  try { return await request.json(); } catch { return null; }
}
function cryptoRandomId(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/,'');
}
