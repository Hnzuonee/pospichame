// s.js
window.turnstileReady = function () {
  const mount = document.getElementById('turnstile-container');
  const btn = document.getElementById('cta');
  const msg = document.getElementById('msg');

  if (!mount) return;

  try {
    // render
    const wid = turnstile.render(mount, {
      sitekey: 'TVUJ_SITE_KEY',
      action: 'go',
      size: 'invisible', // nebo 'flexible' pokud chceš viditelný widget
      callback: async (token) => {
        // POST /v → dostat ticket → /g?ticket=...
        try {
          msg.textContent = 'Ověřuji…';
          const r = await fetch('/v', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ t: token })
          });
          const j = await r.json().catch(()=> ({}));
          if (r.ok && j.k) {
            window.location.href = `/g?ticket=${encodeURIComponent(j.k)}`;
          } else {
            msg.textContent = 'Ověření se nepovedlo, zkus to znovu.';
            try { turnstile.reset(wid); } catch {}
            if (btn) { btn.disabled = false; btn.textContent = 'Pokračovat'; }
          }
        } catch {
          msg.textContent = 'Došlo k chybě připojení. Zkus to znovu.';
          try { turnstile.reset(wid); } catch {}
          if (btn) { btn.disabled = false; btn.textContent = 'Pokračovat'; }
        }
      }
    });

    // **DŮLEŽITÉ**: spustit hned po renderu (žádný druhý klik)
    try { turnstile.execute(mount); } catch {}
  } catch (e) {
    if (msg) msg.textContent = 'Načtení ověření selhalo.';
    if (btn) { btn.disabled = false; btn.textContent = 'Pokračovat'; }
  }
};
