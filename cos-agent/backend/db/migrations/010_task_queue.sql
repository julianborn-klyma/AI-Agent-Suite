CREATE TABLE cos_task_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES cos_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  document_ids UUID[],
  context TEXT,
  result TEXT,
  result_notion_page_id TEXT,
  result_draft_id TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cos_task_queue_priority_chk CHECK (
    priority IN ('urgent', 'high', 'medium', 'low')
  ),
  CONSTRAINT cos_task_queue_status_chk CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
  )
);

CREATE INDEX cos_task_queue_user_status_idx ON cos_task_queue(user_id, status);
CREATE INDEX cos_task_queue_status_created_idx ON cos_task_queue(status, created_at ASC);
CREATE INDEX cos_task_queue_user_created_idx ON cos_task_queue(user_id, created_at DESC);
