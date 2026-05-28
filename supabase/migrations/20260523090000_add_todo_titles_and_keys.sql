CREATE SEQUENCE IF NOT EXISTS public.todos_key_seq START WITH 1 INCREMENT BY 1;

ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS todo_key TEXT;

UPDATE public.todos
SET title = LEFT(NULLIF(TRIM(description), ''), 120)
WHERE title IS NULL;

UPDATE public.todos
SET todo_key = 'YFI-' || nextval('public.todos_key_seq'::regclass)
WHERE todo_key IS NULL;

DO $$
DECLARE
  max_todo_key BIGINT;
BEGIN
  SELECT MAX(NULLIF(REGEXP_REPLACE(todo_key, '^YFI-', ''), '')::BIGINT)
  INTO max_todo_key
  FROM public.todos
  WHERE todo_key ~ '^YFI-[0-9]+$';

  IF max_todo_key IS NULL THEN
    PERFORM setval('public.todos_key_seq'::regclass, 1, false);
  ELSE
    PERFORM setval('public.todos_key_seq'::regclass, max_todo_key, true);
  END IF;
END $$;

ALTER TABLE public.todos
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN todo_key SET NOT NULL,
  ALTER COLUMN todo_key SET DEFAULT ('YFI-' || nextval('public.todos_key_seq'::regclass));

ALTER TABLE public.todos
  ADD CONSTRAINT todos_title_not_empty CHECK (LENGTH(TRIM(title)) > 0),
  ADD CONSTRAINT todos_todo_key_format CHECK (todo_key ~ '^YFI-[0-9]+$');

CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_todo_key
  ON public.todos (todo_key);

CREATE INDEX IF NOT EXISTS idx_todos_title
  ON public.todos (title);
