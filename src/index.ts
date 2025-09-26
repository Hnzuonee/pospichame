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

    // ---- PAGES ----
    if (request.method === "GET" && path === "/") return serveHero();
    if (request.method === "GET" && path === "/health") return new Response("ok", { status: 200 });

    // ---- API (kratké aliasy + zpětná kompatibilita) ----
    if (request.method === "POST" && (path === "/v" || path === "/verify")) {
      return verifyHandler(request, env);
    }
    if (request.method === "GET" && (path === "/g" || path === "/go")) {
      return goHandler(url, env);
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;

/* ---------- HERO (PG-13) ---------- */
function serveHero(): Response {
  const html = `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Kristy — Official Page</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; margin:0; padding:24px; color:#f0f0f0;
           background:linear-gradient(-45deg,#0d0d1a,#1a0d1a,#0d1a1a,#0d0d1a); background-size:400% 400%; animation:bg 20s ease infinite; }
    @keyframes bg { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
    .wrap { max-width: 720px; margin: 0 auto; }
    .card { background:rgba(26,26,41,.7); backdrop-filter:blur(15px); border:1px solid rgba(255,255,255,.1);
            border-radius:24px; padding:28px; box-shadow:0 8px 32px rgba(0,0,0,.37); margin-bottom:30px; }
    .hero { display:flex; gap:24px; align-items:center; flex-wrap:wrap; }
    .hero img { width:220px; height:auto; border-radius:18px; object-fit:cover; box-shadow:0 4px 24px rgba(0,0,0,.08); border:4px solid #f900ff; }
    h1 { margin:0 0 6px; font-size:32px; font-weight:900 }
    .sub { margin:0 0 12px; opacity:.85 }
    .bio { margin: 8px 0 16px; line-height:1.5; opacity:.95 }
    .tags{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 22px}
    .tag{font-size:.9rem;padding:6px 10px;border:1px solid rgba(255,255,255,.15);border-radius:12px;opacity:.9}
    .cta { margin-top: 6px; }
    .cta button { padding:14px 18px; border-radius:50px; border:0; font-size:16px; cursor:pointer;
                  color:#fff; background:linear-gradient(-45deg,#f900ff,#00f2ff); background-size:200% 200%; animation:bg 8s ease infinite;
                  letter-spacing:1.1px; text-transform:uppercase; font-weight:700 }
    .cta button:disabled{opacity:.7; cursor:not-allowed}
    .status { margin-top:10px; font-size:13px; opacity:.8; min-height:1.2em }
    .gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
    .gallery img{width:100%;height:220px;object-fit:cover;border-radius:16px}
    .footer{ text-align:center; padding:18px 0; font-size:.9rem; opacity:.65}
    .ts-wrap{ position:absolute; left:-9999px; opacity:0; width:0; height:0; overflow:hidden; }
  </style>
  <meta name="robots" content="noindex,nofollow">
  <script defer src="https://challenges.cloudflare.com/turnstile/v0/api.js" onload="turnstileReady()"></script>
</head>
<body>
  <div class="wrap">
    <section class="card">
      <div class="hero">
        <img src="/hero.jpg" alt="Kristy" onerror="this.style.display='none'">
        <div>
          <h1>Kristy</h1>
          <p class="sub">Official Page • Lifestyle & Fitness</p>
          <p class="bio">Ahoj, jsem Kristy. Miluju cestování, fitness a sdílení momentů ze svého života. Níže najdeš moje oficiální odkazy a možnost pokračovat na 18+ obsah.</p>
          <div class="tags">
            <span class="tag">Výška 169 cm</span><span class="tag">Váha 52 kg</span><span class="tag">Míry 86–60–90</span>
            <span class="tag">Blond</span><span class="tag">Modré oči</span><span class="tag">23 let</span><span class="tag">CZ</span>
          </div>
          <div class="cta">
            <button id="enterBtn" disabled>Pokračovat na osobní stránku (18+)</button>
            <div id="msg" class="status"></div>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="gallery">
        <img src="/g1.jpg" alt="Galerie 1" onerror="this.style.display='none'">
        <img src="/g2.jpg" alt="Galerie 2" onerror="this.style.display='none'">
        <img src="/g3.jpg" alt="Galerie 3" onerror="this.style.display='none'">
      </div>
    </section>
  </div>

  <footer class="footer">© 2025 Kristy • Vstupem potvrzuješ, že je ti 18+</footer>

  <div class="ts-wrap">
    <div id="ts-widget" class="cf-turnstile"
         data-sitekey="0x4AAAAAAB3aoUBtDi_jhPAf"
         data-size="flexible"
         data-callback="onTsSuccess"
         data-error-callback="onTsError"
         data-timeout-callback="onTsTimeout"></div>
  </div>

  <script>
    const btn = document.getElementById('enterBtn');
    const msg = document.getElementById('msg');
    const WIDGET_ID = "#ts-widget";
    let isProcessing = false;

    // Tato funkce se zavolá, až bude Turnstile skript načtený a připravený
    window.turnstileReady = function () {
      // Odblokujeme tlačítko a změníme text
      btn.disabled = false;
      setStatus("Připraveno k ověření");
    };

    const setStatus = (text = "", busy = false) => {
      msg.textContent = text;
      // Tlačítko se zablokuje, jen když probíhá zpracování
      btn.disabled = busy;
      isProcessing = busy;
    };

    const handleError = (message) => {
      setStatus(message, false);
      try {
        window.turnstile?.reset(WIDGET_ID);
      } catch (e) {
        console.error("Failed to reset Turnstile:", e);
      }
    };

    window.onTsSuccess = async (token) => {
      if (!token) {
        return handleError("Ověření selhalo, zkuste to znovu.");
      }
      setStatus("Ověřeno, připravuji vstup…", true);

      try {
        const response = await fetch('/v', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ t: token }),
        });

        if (!response.ok) {
          let errorMsg = \`Server chyba (\${response.status})\`;
          try {
            const jsonError = await response.json();
            if (jsonError?.error) errorMsg = 'Server: ' + jsonError.error;
          } catch {}
          throw new Error(errorMsg);
        }

        const data = await response.json();
        const ticket = data?.k || data?.ticket;

        if (!ticket) {
          throw new Error("Chybí vstupenka, zkuste to znovu.");
        }

        window.location.href = \`/g?ticket=\${encodeURIComponent(ticket)}\`;

      } catch (e) {
        handleError(e.message || "Síťová chyba, zkuste to znovu.");
      }
    };

    window.onTsError   = () => handleError("Chyba ověření, zkuste to prosím znovu.");
    window.onTsTimeout = () => handleError("Čas ověření vypršel, zkuste to znovu.");

    btn.addEventListener('click', () => {
      if (isProcessing) return;
      setStatus("Ověřuji…", true);

      try {
        turnstile.execute(WIDGET_ID);
      } catch (e) {
        handleError("Chyba při spuštění ověření.");
      }
    });

    // Nastavíme počáteční stav
    setStatus("Načítám ověření…");
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

/* ---------- VERIFY / GO (aliasy /v,/g + kompatibilita) ---------- */
async function verifyHandler(request: Request, env: Env): Promise<Response> {
  if (!env.TURNSTILE_SECRET) return json({ error: "server_misconfig", reason: "TURNSTILE_SECRET missing" }, 500);
  if (!env.SIGNING_SECRET)   return json({ error: "server_misconfig", reason: "SIGNING_SECRET missing" }, 500);
  if (!env.TICKETS || !env.TICKETS.put) return json({ error: "server_misconfig", reason: "KV binding TICKETS missing" }, 500);

  const body = await safeJson(request);
  const token = (body && (body.t || body.token)) || "";
  if (!token) return json({ error: "missing token" }, 400);

  // Turnstile verify
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

  // ticket (one-time, TTL)
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

  // nové pole `k` + staré `ticket` (kompatibilita)
  const ticket = `${id}.${issuedAt}.${ttl}.${sig}`;
  return json({ k: ticket, ticket }, 200);
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
  const now = Math.floor(Date.now()/1000);
  if (!issuedAt || !ttl || now > issuedAt + ttl) return json({ error: "expired" }, 403);

  const key = `t:${id}`;
  const exists = await env.TICKETS.get(key);
  if (!exists) return json({ error: "already used or unknown" }, 403);
  await env.TICKETS.delete(key);

  const target = env.TARGET_URL || "";
  if (!target) return json({ error: "no target configured" }, 500);

  return new Response(null, { status: 303, headers: { Location: target } });
}

/* ---------- utils ---------- */
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
