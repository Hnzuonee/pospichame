export interface Env {
  TICKETS: KVNamespace;
  TURNSTILE_SECRET: string;
  SIGNING_SECRET: string;
  TARGET_URL: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" && request.method === "GET") {
      return serveHtml(env);
    }
    if (path === "/health" && request.method === "GET") {
      return new Response("ok", { status: 200 });
    }
    if (path === "/verify" && request.method === "POST") {
      return verifyHandler(request, env);
    }
    if (path === "/go" && request.method === "GET") {
      return goHandler(url, env);
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;

async function serveHtml(env: Env): Promise<Response> {
  const html = `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Safe Link</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 24px; }
    .wrap { max-width: 520px; margin: 0 auto; }
    button { padding: 14px 18px; border-radius: 12px; border: 0; font-size: 16px; cursor: pointer; }
    button:disabled { opacity: .6; cursor: not-allowed; }
    .status { margin-top: 14px; font-size: 14px; }
    .hidden { display: none; }
    .card { padding: 18px; border-radius: 16px; box-shadow: 0 2px 14px rgba(0,0,0,.08); margin-top: 16px; }
  </style>
  <script defer src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
</head>
<body>
  <div class="wrap">
    <h1>Pokračovat</h1>
    <p>Pro bezpečné pokračování ověř prosím, že nejsi robot.</p>

    <div id="ts-widget"
         class="cf-turnstile"
         data-sitekey="0x4AAAAAAB3aoUBtDi_jhPAf"
         data-size="flexible"
         data-callback="onTsSuccess"
         data-error-callback="onTsError"
         data-timeout-callback="onTsTimeout">
    </div>

    <div class="card">
      <button id="goBtn">Vstoupit</button>
      <div id="msg" class="status"></div>
    </div>
  </div>

  <script>
    let isExecuting = false;
    let lastToken = "";

    const $btn = document.getElementById('goBtn');
    const $msg = document.getElementById('msg');

    function setMsg(text) { $msg.textContent = text; }
    function setBusy(busy) { $btn.disabled = busy; isExecuting = busy; }

    window.onTsSuccess = async function(token) {
      lastToken = token || "";
      setMsg("Ověřeno, připravuji vstup…");
      try {
        const res = await fetch('/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: lastToken })
        });
        if (!res.ok) {
          let data = null; try { data = await res.json(); } catch {}
          setBusy(false);
          // místo backticků používáme obyčejné stringy
          setMsg((data && data.error) ? ('Server chyba: ' + data.error) : ('Server chyba (' + res.status + ').'));
          if (window.turnstile) turnstile.reset('#ts-widget');
          lastToken = "";
          return;
        }
        const data = await res.json();
        if (!data || !data.ticket) {
          setBusy(false);
          setMsg("Chybí ticket. Zkus to znovu.");
          if (window.turnstile) turnstile.reset('#ts-widget');
          lastToken = "";
          return;
        }
        window.location.href = '/go?ticket=' + encodeURIComponent(data.ticket);
      } catch (e) {
        setBusy(false);
        setMsg("Síťová chyba. Zkus to znovu.");
        if (window.turnstile) turnstile.reset('#ts-widget');
        lastToken = "";
      }
    };

    window.onTsError = function() {
      setBusy(false);
      setMsg("Chyba ověření. Zkus to prosím znovu.");
    };
    window.onTsTimeout = function() {
      setBusy(false);
      setMsg("Čas ověření vypršel. Zkus to znovu.");
    };

    $btn.addEventListener('click', async () => {
      if (isExecuting) return;
      setBusy(true);
      setMsg("Ověřuji…");
      try {
        if (window.turnstile) {
          turnstile.reset('#ts-widget');
        }
      } catch (e) {
        setBusy(false);
        setMsg("Chyba při spuštění ověření.");
      }
    });
  </script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff"
    }
  });
}

async function verifyHandler(request: Request, env: Env): Promise<Response> {
  if (!env.TURNSTILE_SECRET) return json({ error: "server_misconfig", reason: "TURNSTILE_SECRET missing" }, 500);
  if (!env.SIGNING_SECRET)   return json({ error: "server_misconfig", reason: "SIGNING_SECRET missing" }, 500);
  if (!env.TICKETS || !env.TICKETS.put) return json({ error: "server_misconfig", reason: "KV binding TICKETS missing" }, 500);

  const body = await safeJson(request);
  if (!body?.token) return json({ error: "missing token" }, 400);

  const form = new URLSearchParams();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", body.token);
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (ip) form.append("remoteip", ip);

  let res: any;
  try {
    const ver = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form
    });
    res = await ver.json();
  } catch (e) {
    return json({ error: "verify_request_failed", detail: String(e) }, 502);
  }

  if (!res?.success) {
    return json({
      error: "verification_failed",
      codes: res["error-codes"] || null,
      hostname: res.hostname || null
    }, 403);
  }

  const id = cryptoRandomId();
  const ttl = 60;
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${id}.${issuedAt}.${ttl}`;
  let sig: string;
  try {
    sig = await hmac(env.SIGNING_SECRET, payload);
  } catch (e) {
    return json({ error: "signing_failed", detail: String(e) }, 500);
  }

  try {
    await env.TICKETS.put(`t:${id}`, "1", { expirationTtl: ttl });
  } catch (e) {
    return json({ error: "kv_put_failed", detail: String(e) }, 500);
  }

  return json({ ticket: `${id}.${issuedAt}.${ttl}.${sig}` }, 200);
}

async function goHandler(url: URL, env: Env): Promise<Response> {
  const ticket = url.searchParams.get("ticket") || "";
  const parts = ticket.split(".");
  if (parts.length !== 4) return json({ error: "bad ticket" }, 400);

  const [id, issuedAtStr, ttlStr, sig] = parts;
  const payload = `${id}.${issuedAtStr}.${ttlStr}`;
  const expectSig = await hmac(env.SIGNING_SECRET, payload);
  if (sig !== expectSig) return json({ error: "bad signature" }, 403);

  const issuedAt = Number(issuedAtStr) | 0;
  const ttl = Number(ttlStr) | 0;
  const now = Math.floor(Date.now() / 1000);
  if (!issuedAt || !ttl || now > issuedAt + ttl) return json({ error: "expired" }, 403);

  const key = `t:${id}`;
  const exists = await env.TICKETS.get(key);
  if (!exists) return json({ error: "already used or unknown" }, 403);
  await env.TICKETS.delete(key);

  const target = env.TARGET_URL || "";
  if (!target) return json({ error: "no target configured" }, 500);

  return new Response(null, { status: 303, headers: { Location: target } });
}

// -------- utils --------
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
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/,'');
}
