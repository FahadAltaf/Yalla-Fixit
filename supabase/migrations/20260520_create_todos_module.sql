-- =====================================================
-- Migration: Create todos module tables
-- Description: Stores portal todos, assignees, and comments.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.user_profile(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  related_type TEXT CHECK (related_type IS NULL OR related_type IN ('work_order', 'quotation', 'appointment')),
  related_id TEXT,
  deadline_at TIMESTAMPTZ NOT NULL,
  reminder_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'canceled', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.todo_assignees (
  todo_id UUID NOT NULL REFERENCES public.todos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profile(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (todo_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.todo_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id UUID NOT NULL REFERENCES public.todos(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.user_profile(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_todos_owner_status_deadline
  ON public.todos (owner_id, status, deadline_at);

CREATE INDEX IF NOT EXISTS idx_todos_status_deadline
  ON public.todos (status, deadline_at);

CREATE INDEX IF NOT EXISTS idx_todos_reminder_due
  ON public.todos (reminder_at)
  WHERE reminder_at IS NOT NULL AND reminder_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_todos_tags
  ON public.todos USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_todo_assignees_user
  ON public.todo_assignees (user_id);

CREATE INDEX IF NOT EXISTS idx_todo_comments_todo_created
  ON public.todo_comments (todo_id, created_at);

ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todo_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todo_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow All on todos" ON public.todos;
CREATE POLICY "Allow All on todos"
ON public.todos
FOR ALL
TO public
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All on todo_assignees" ON public.todo_assignees;
CREATE POLICY "Allow All on todo_assignees"
ON public.todo_assignees
FOR ALL
TO public
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All on todo_comments" ON public.todo_comments;
CREATE POLICY "Allow All on todo_comments"
ON public.todo_comments
FOR ALL
TO public
USING (true)
WITH CHECK (true);
