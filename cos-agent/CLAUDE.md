# cos-agent — Entwicklungsregeln

## Architektur

- Business-Logik **immer** in `services/`, nie in Route-Handlern.
- Route-Handler: `requireAuth` → Service-Aufruf → `jsonResponse` — das war’s.
- Vendor-Agnostik: alle externen Services hinter Interface-Abstraktion.
- Keine direkten API-SDK-Imports in der Business-Logik.

## Security

- JWT-Validierung + Ownership-Check bei **jedem** Request (Ausnahmen nur bewusst dokumentiert, z. B. strikt interne Health-Checks).
- Service-Tokens: Pflichtfelder, min. 32 Zeichen, **Startup-Fehler** wenn fehlt.
- CORS: explizite Allowlist aus ENV, kein Wildcard.
- User-ID **immer** aus JWT, nie aus Request-Body.

## Git: vor jedem `git push`

- **`.gitignore` checken und bei Bedarf updaten** (Workspace-Root und bei Bedarf `cos-agent/.gitignore`), damit sicherheitsrelevante Dateien nicht ins Repo gelangen (`.env*`, Keys, Zertifikate, lokale Overrides, Artefakte mit eingebetteten Secrets).
- Kurz verifizieren: nichts Sensibles im Index — z. B. `git status -u`, bei Zweifel `git check-ignore -v <pfad>`.
- Wenn eine sensible Datei schon getrackt war: `git rm --cached <datei>` (Datei lokal behalten), dann `.gitignore` und Commit.
- Kein Push vorschlagen oder begleiten, solange offensichtliche Lücken in der Ignore-Liste oder getrackte Geheimnisse bestehen.

## Testing

- Jeder neue Endpoint bekommt einen **E2E-Test** (Black-Box über HTTP).
- Tests laufen gegen **echte DB** (Test-Schema), keine Mocks.
- Test-Datei liegt neben der Route-Datei: `routes/users.ts` → `routes/users.test.ts`.

## LLM / BERT

- **Alle** LLM-Calls gehen über **BERT** (`llm-gateway`), nie direkt zur Anthropic API.
- Kosten-Tracking läuft automatisch über BERT.
- System-Prompts liegen in der DB (`agent_configs`), nie hardcoded.

## Migrations

- Jede Migration: numerisch gepräfixt (`001_`, `002_`, …).
- Nach jeder Migration: **Migration-Runner-Test** aktualisieren.
- Niemals Produktions-Schema manuell ändern.

## Cron / Automation

- Cron-Jobs: eigene Datei in `cron/`, Registrierung in `main.ts`.
- Jeder Job loggt Start, Ende und Fehler strukturiert.
- Jobs sind **idempotent** (mehrfacher Lauf = kein Problem).
