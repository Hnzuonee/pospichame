# safelin-worker (Cloudflare Workers)

Flow: Turnstile → POST `/verify` → `/go?ticket=...` → `303` → `TARGET_URL`.

## Co udělat
1) KV:
```
wrangler login
wrangler kv:namespace create safelin-tickets
# -> vezmi id a vlož do wrangler.toml (binding TICKETS)
```

2) Secrets/vars:
```
wrangler secret put TURNSTILE_SECRET   # server secret k site key
wrangler secret put SIGNING_SECRET     # např. openssl rand -base64 32
wrangler secret put TARGET_URL         # finální URL
```

3) Publish:
```
wrangler publish
```

4) Routes:
- Workers → tvůj worker → Triggers → Routes (např. https://link.example.com/*)

## Poznámky
- Site key v HTML: **0x4AAAAAAB3aoUBtDi_jhPAf** (přidej doménu do Allowed Domains v Turnstile).
- TTL ticketu 60 s, one-time spotřeba v KV.
