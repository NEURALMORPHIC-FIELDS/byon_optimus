# Gmail Setup pentru BYON Optimus

## Pasul 1: Creează OAuth Credentials

1. Deschide: https://console.cloud.google.com/apis/credentials

2. Creează un proiect nou (sau selectează unul existent):
   - Click "Select a project" → "New Project"
   - Name: `byon-optimus`
   - Create

3. Enable Gmail API:
   - APIs & Services → Library
   - Caută "Gmail API" → Enable

4. Configure OAuth Consent Screen:
   - APIs & Services → OAuth consent screen
   - User Type: External → Create
   - App name: `BYON Optimus`
   - User support email: `lucianborbeleac@gmail.com`
   - Developer contact: `lucianborbeleac@gmail.com`
   - Save and Continue (skip scopes)
   - Add test users:
     - `lucianborbeleac@gmail.com`
     - `v.lucian.borb@gmail.com`
     - `v.l.borbel@gmail.com`
   - Save and Continue → Back to Dashboard

5. Create OAuth Client ID:
   - Credentials → Create Credentials → OAuth client ID
   - Application type: **Desktop app**
   - Name: `BYON Gmail CLI`
   - Create
   - **Download JSON** (butonul cu săgeată în jos)

## Pasul 2: Salvează Credentials

Mută fișierul descărcat în acest folder și redenumește-l:
```
C:\Users\Lucian\Desktop\byon_optimus\openclaw-config\gogcli\credentials.json
```

## Pasul 3: Repornește Gateway

```powershell
cd C:\Users\Lucian\Desktop\byon_optimus
docker-compose restart openclaw-gateway
```

## Pasul 4: Autentifică Conturile

```powershell
docker exec -it openclaw-gateway gog auth add lucianborbeleac@gmail.com
docker exec -it openclaw-gateway gog auth add v.lucian.borb@gmail.com
docker exec -it openclaw-gateway gog auth add v.l.borbel@gmail.com
```

## Pasul 5: Testează

```powershell
docker exec openclaw-gateway gog gmail list --account lucianborbeleac@gmail.com --limit 3
```

---
Generat automat de BYON Optimus Setup
