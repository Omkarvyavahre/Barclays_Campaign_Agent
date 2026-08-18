# Barclays Knowledge Layer (server-side)

Source of truth (sibling of this application, not copied into the app):

`../Barclays Brand Guidelines, Content & GS4PM Demo Support`

This package inventories those files, extracts typed knowledge with provenance,
builds a lightweight in-memory graph, and exposes deterministic retrieval APIs
for later Gemini grounding and Firefly visual-reference selection.

## Constraints

- Server-side only — do not import from `src/` / the Vite client bundle.
- No Gemini calls.
- No Firefly calls.
- No embeddings / vector DB / Neo4j.
- Corporate vs Retail separation is enforced; unknown stays unknown.

## Key APIs

```ts
import {
  inventoryResources,
  loadCatalogue,
  getKnowledgeForCampaign,
  getBrandGuardrails,
  selectVisualReference,
  buildGeminiGrounding
} from '../server/knowledge';
```
