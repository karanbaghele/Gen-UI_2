-- Keep vectors from each real embedding model at their native dimension.
-- Retrieval always filters by embedding_model and tenant before comparison.
drop index if exists public.knowledge_chunks_vector;
alter table public.knowledge_chunks
  alter column embedding type extensions.vector
  using embedding::extensions.vector;
