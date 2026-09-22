# GenUI implementation checklist

Authoritative requirements: [product brief](docs/PRODUCT_BRIEF.md). Local-only; no deployment, public tunnels, or cloud infrastructure.

- [x] Inspect repository (empty starting directory) and installed tools.
- [x] Schedule automatic continuation after current account reset.
- [x] Next.js / strict TypeScript foundation and light/dark design tokens.
- [x] Local Supabase/PostgreSQL/pgvector infrastructure; clean migration verification.
- [ ] Google-only OAuth, protected routes, workspace creation, tenant authorization.
- [ ] Sample data and CSV upload/preview/profiling/persistence.
- [x] Versioned schema, component registry, deterministic queries and tests.
- [x] Dashboard renderer, linked filters, accessible drag/resize editing.
- [ ] Persistence, conflict detection, autosave, undo/redo, version restoration.
- [ ] Embedding jobs, pgvector retrieval, definitions and provenance.
- [ ] Ollama/Gemini structured generation with bounded repair and real status events.
- [x] Validated conversational patches preserving manual layouts.
- [x] Google Sheets authorization, worksheet discovery, preview, import, and manual refresh.
- [x] Google Sheets background polling and refresh-history verification.
- [x] PostgreSQL connector verification against a separate read-only source.
- [ ] Source refresh, local event notification, measured latency.
- [ ] Exports, library actions, settings, context inspector.
- [ ] Security tests, end-to-end editor tests, visual QA, lint/typecheck/build.
- [ ] Setup documentation and factual handoff.

Check items only when implemented and verified; document partial status in docs/CONTINUATION.md.
