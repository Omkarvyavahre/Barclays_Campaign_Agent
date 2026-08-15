/**
 * Server-side AI layer.
 *
 * - gemini/: shared Gemini gateway (first/only client)
 * - creative/: Gemini Creative Interpreter + CreativeSpecification validation
 * - firefly/: shared Firefly client + prompt builder + session image storage
 * - modify/: Gemini-only edits + Firefly-only regeneration orchestration
 * - http/: POST /api/ai/creative-interpret, POST /api/ai/modify-asset, GET /api/ai/generated/:id
 */

export * from './gemini';
export * from './creative';
export * from './firefly';
export * from './modify';
export * from './http';
