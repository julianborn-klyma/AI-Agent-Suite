CREATE TABLE cos_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES cos_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  document_type TEXT NOT NULL,
  content_text TEXT,
  summary TEXT,
  file_size_bytes INTEGER,
  mime_type TEXT,
  source TEXT NOT NULL DEFAULT 'upload',
  drive_file_id TEXT,
  processed BOOLEAN NOT NULL DEFAULT false,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cos_documents_user_type ON cos_documents (user_id, document_type);
CREATE INDEX idx_cos_documents_user_processed ON cos_documents (user_id, processed);
CREATE INDEX idx_cos_documents_user_created ON cos_documents (user_id, created_at DESC);

CREATE TABLE cos_document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES cos_documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES cos_users(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  page_number INTEGER,
  section_title TEXT,
  content TEXT NOT NULL,
  token_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cos_document_chunks_doc_idx ON cos_document_chunks (document_id, chunk_index);
CREATE INDEX idx_cos_document_chunks_user_doc ON cos_document_chunks (user_id, document_id);
