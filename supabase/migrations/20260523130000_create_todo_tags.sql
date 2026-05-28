CREATE TABLE IF NOT EXISTS public.todo_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_tags_name_lower
  ON public.todo_tags (LOWER(name));

ALTER TABLE public.todo_tags
  ADD CONSTRAINT todo_tags_name_not_empty CHECK (LENGTH(TRIM(name)) > 0),
  ADD CONSTRAINT todo_tags_color_hex CHECK (color ~ '^#[0-9A-Fa-f]{6}$');

CREATE INDEX IF NOT EXISTS idx_todo_tags_name
  ON public.todo_tags (name);

INSERT INTO public.todo_tags (name, color)
SELECT DISTINCT tag, '#64748b'
FROM public.todos
CROSS JOIN LATERAL UNNEST(tags) AS tag
WHERE tag IS NOT NULL AND LENGTH(TRIM(tag)) > 0
ON CONFLICT ((LOWER(name))) DO NOTHING;

ALTER TABLE public.todo_tags ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'todo_tags'
      AND policyname = 'Allow All on todo_tags'
  ) THEN
    CREATE POLICY "Allow All on todo_tags" ON public.todo_tags FOR ALL USING (true);
  END IF;
END $$;
