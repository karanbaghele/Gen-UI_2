# GenUI

Read docs/PRODUCT_BRIEF.md for authoritative requirements and docs/CONTINUATION.md for current state. Work only in this workspace. Do not deploy or create public tunnels. Keep secrets server-only. Google is the only normal login; any development bypass must be opt-in, local-only and rejected in production. Do not substitute fake AI, embeddings, or hosted infrastructure when a local service is missing. Mark unverified integrations honestly.

Use strict TypeScript and feature/domain separation. Query values come from deterministic code, not LLM text. All resource access and retrieval must enforce tenant scope before returning data. Make one slice work before expanding. Update the checklist and checkpoint after verified milestones.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
