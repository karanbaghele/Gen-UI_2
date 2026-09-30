# GenUI implementation checklist

Authoritative product requirements: [product brief](docs/PRODUCT_BRIEF.md). The user later authorized Vercel hosting with Supabase Auth/database; local development stays separate, and Git pushes are release actions.

- [x] Inspect repository (empty starting directory) and installed tools.
- [x] Schedule automatic continuation after current account reset.
- [x] Next.js / strict TypeScript foundation and light/dark design tokens.
- [x] Local Supabase/PostgreSQL/pgvector infrastructure; clean migration verification.
- [ ] Google-only OAuth, protected routes, workspace creation, tenant authorization.
- [ ] Sample data and CSV upload/preview/profiling/persistence.
- [x] Versioned schema, component registry, deterministic queries and tests.
- [x] Dashboard renderer, linked filters, accessible drag/resize editing.
- [ ] Persistence, conflict detection, autosave, undo/redo, version restoration.
- [x] Embedding jobs, pgvector retrieval, definitions and provenance (real NVIDIA, fictional sample).
- [ ] Ollama/Gemini structured generation with bounded repair and real status events.
- [x] Validated conversational patches preserving manual layouts.
- [x] Google Sheets authorization, worksheet discovery, preview, import, and manual refresh.
- [x] Google Sheets background polling and refresh-history verification.
- [x] PostgreSQL connector verification against a separate read-only source.
- [x] Initial source published to private GitHub repository Gen-UI_2, with ignored local credentials excluded.
- [ ] Local Google Auth service, Google callback setting, and real account sign-in verification.
- [x] NVIDIA chat and passage/query embedding adapters; real generation, RAG and saved refinement verified on the fictional sample.
- [x] Hosted Supabase GenUI project in Karan Works; schema applied and privileged function grants narrowed.
- [x] Read-only, secret-protected hosted database health route; three daily Vercel Cron schedules to reduce free-project pause risk.
- [x] Vercel production secrets, scoped database login, Google provider and OAuth callbacks configured.
- [x] GitHub-connected Vercel production build; login page and OAuth initiation respond.
- [x] Public landing page at `/` with interactive sample dashboard, responsive layouts, and `/app` workspace entry.
- [x] Dataset-specific home prompt suggestions based on selected CSV, Sheets, PostgreSQL, or sample metadata; suggestions never assume unavailable fields.
- [x] Reference-inspired chart palettes in light/dark modes; distinct category bars and pie slices, clear series lines and area gradients (locally verified; awaiting a requested GitHub release).
- [ ] Real hosted Google session, authenticated app database flow, hosted dashboard generation and RAG check. The pooler login and NVIDIA chat/embedding APIs passed separate smoke checks; this is not an end-to-end app verification.
- [ ] Source refresh, local event notification, measured latency.
- [ ] Exports, library actions, settings, context inspector.
- [ ] Security tests, end-to-end editor tests, visual QA, lint/typecheck/build.
- [ ] Setup documentation and factual handoff.

Check items only when implemented and verified; document partial status in docs/CONTINUATION.md.
