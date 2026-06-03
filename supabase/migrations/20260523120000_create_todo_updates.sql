CREATE TABLE IF NOT EXISTS public.todo_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id UUID NOT NULL REFERENCES public.todos(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  action TEXT NOT NULL DEFAULT 'updated',
  field_name TEXT,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_todo_updates_todo_created
  ON public.todo_updates (todo_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_todo_updates_actor
  ON public.todo_updates (actor_id);

ALTER TABLE public.todo_updates ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'todo_updates'
      AND policyname = 'Allow All on todo_updates'
  ) THEN
    CREATE POLICY "Allow All on todo_updates" ON public.todo_updates FOR ALL USING (true);
  END IF;
END $$;
