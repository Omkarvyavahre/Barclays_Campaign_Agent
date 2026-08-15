# Server-side AI layer

## Gemini Creative Interpreter

`POST /api/ai/creative-interpret`

Converts accepted brief + DAM asset + Modify form into a validated `CreativeSpecification`,
then runs deterministic `selectVisualReference()`.

## Modify → Firefly (Phase 4)

`POST /api/ai/modify-asset`

Flow:

1. Gemini Creative Interpreter (unless regenerating with unchanged inputs)
2. Reference resolution:
   - Priority 1: approved KG visual reference
   - Priority 2 (modify only): selected source DAM creative when KG ref is null
   - Never Retail / unknown / `great_escape` / logos
3. `buildFireflyPrompt(specification)` — not the raw marketer prompt
4. Adobe Firefly generate (visual only)
5. Derived asset DTO (original DAM untouched)

`GET /api/ai/generated/:id` serves session-registered derivatives only.
Historical `.generated/` files are never auto-loaded into the Asset Library.

## Shared clients

- `server/ai/gemini/` — first/only Gemini client
- `server/ai/firefly/` — first/only Firefly client

Live calls:

- Gemini: `GEMINI_LIVE=1` + gateway/API credentials
- Firefly: `FIREFLY_LIVE=1` + `ADOBE_FIREFLY_CLIENT_ID` / `ADOBE_FIREFLY_CLIENT_SECRET`

Defaults remain off so tests make **0** provider calls.
