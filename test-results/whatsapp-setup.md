# BYON-Omni WhatsApp Setup — Pasul Final

Pentru a conecta WhatsApp-ul tău la BYON-Omni, **un singur pas manual** rămâne (nu pot scana eu QR-ul):

## Pasul 1 — Rulează stack-ul

Dublu-click pe `start-byon.bat` din rădăcina proiectului. Sau, manual:

```bash
# Terminal 1: memory-service
cd byon-orchestrator\memory-service
python server.py
# așteaptă "Application startup complete" + "Uvicorn running on http://0.0.0.0:8000"

# Terminal 2: WhatsApp bridge
cd byon-orchestrator
node --env-file=../.env scripts/byon-whatsapp-bridge.mjs
```

## Pasul 2 — Scanează QR-ul

Pe terminalul 2 apare un cod QR ASCII. Pe telefonul tău:

1. Deschide **WhatsApp**.
2. **Settings → Linked Devices → Link a Device**.
3. Apropie camera de QR-ul din terminal.

După scan, ar trebui să vezi `[byon-bridge] READY. Logged in as +40...`.

## Pasul 3 — Trimite un mesaj

Trimite-ți pe **WhatsApp Web** (sau din alt cont) un mesaj la numărul tău. Bridge-ul va:

1. Stoca mesajul în memorie (FAISS + FCE-M).
2. Recupera context-ul similar.
3. Cere FCE-M raport morfogenetic.
4. Cere Claude Sonnet 4.6 un răspuns folosind contextul.
5. Trimite răspunsul înapoi pe WhatsApp.
6. Asimila răspunsul ca eveniment FCE-Omega.

Vei vedea log-uri ca:

```
[byon-bridge] msg from 40712345678@s.whatsapp.net: Salut! Cum te numești?
[byon-bridge] stored inbound (45ms) ctx_id=42 fce=assimilated
[byon-bridge] recall+fce (180ms) conv=3 facts=0 fce=on
[byon-bridge] claude reply (1820ms) 230 chars in 1820ms tokens=180/52
[byon-bridge] stored reply (40ms) ctx_id=43
```

## Restricționare la numere de încredere

Implicit, bridge-ul răspunde la oricine. Pentru a restricționa:

În `.env`:
```
BYON_WHATSAPP_ALLOW=40712345678@s.whatsapp.net,40798765432@s.whatsapp.net
```

(JID-ul este numărul fără `+`, urmat de `@s.whatsapp.net` pentru DM-uri.)

## Re-link (când sesiunea expiră)

Dacă bridge-ul afișează `logged out — delete ./whatsapp-session/ ...`:

```bash
rm -rf byon-orchestrator/whatsapp-session
# repornește bridge-ul → QR nou
```

## Diagnostic

| Simptom | Cauză probabilă | Fix |
|---|---|---|
| `FATAL: memory service unreachable` | Memory-service nu rulează | Pornește terminalul 1 mai întâi |
| `ANTHROPIC_API_KEY not set` | `.env` nu se încarcă | Asigură-te că rulezi cu `--env-file=../.env` |
| `connection closed (code=428)` | QR-ul a expirat și nimeni nu l-a scanat | Re-pornește; QR nou se generează |
| `connection closed (code=401)` | Sesiunea a fost invalidată (logout din telefon) | Șterge `whatsapp-session/` și re-scanează |
| Răspunsuri lente (>5s) | Claude Sonnet 4.6 e gândit, normal | E ok; reduceți `LLM_MAX_TOKENS` în `.env` dacă vreți și mai rapid |
