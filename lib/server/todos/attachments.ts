import type { SupabaseClient } from "@supabase/supabase-js";
import type { TodoAttachment } from "@/types/types";

/**
 * FR-16: files attached to a task live in the private `todos` bucket under
 * todos/<todo id>/<attachment id>.<ext>. The user's file name is kept on
 * the row only, never in the object key, so a name cannot steer the path.
 * Every read is a short-lived signed URL minted here; the bucket has no
 * policies, so nothing is reachable with a user session or a plain link.
 */
export const TODOS_BUCKET = "todos";

/** Long enough to open and save a file, short enough not to leak. */
export const ATTACHMENT_URL_TTL_SECONDS = 60 * 60;

export function attachmentObjectKey(todoId: string, attachmentId: string, extension: string) {
  return `todos/${todoId}/${attachmentId}.${extension}`;
}

export type AttachmentRow = {
  id: string;
  todo_id: string;
  comment_id?: string | null;
  uploaded_by: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
  uploader?: { id: string; email?: string | null; first_name?: string | null; last_name?: string | null; full_name?: string | null } | null;
};

export const ATTACHMENT_SELECT =
  "id,todo_id,comment_id,uploaded_by,file_name,content_type,size_bytes,storage_path,created_at," +
  "uploader:user_profile!todo_attachments_uploaded_by_fkey(id,email,first_name,last_name,full_name)";

// Before migration 20261021090000 the comment_id column is not there; the
// same select without it keeps the task's files readable in the meantime.
export const ATTACHMENT_SELECT_LEGACY = ATTACHMENT_SELECT.replace("comment_id,", "");

export function isMissingColumn(code: string | undefined): boolean {
  return code === "42703" || code === "PGRST204";
}

/** The object keys of a comment's files, so they can go with the comment. */
export async function listCommentObjectPaths(admin: SupabaseClient, commentId: string): Promise<string[]> {
  const { data: rows, error } = await admin.from("todo_attachments").select("storage_path").eq("comment_id", commentId);
  if (error) {
    if (isMissingColumn(error.code) || error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  return (rows ?? []).map((row: { storage_path: string }) => row.storage_path);
}

/**
 * Adds a signed download URL to each row; a row whose object is missing gets
 * null. Signed one at a time so each link carries its own `download` name:
 * the object key is a uuid, and a browser ignores the `download` attribute
 * on a cross-origin link, so the name has to come from the storage host.
 */
export async function signAttachments(admin: SupabaseClient, rows: AttachmentRow[]): Promise<TodoAttachment[]> {
  if (rows.length === 0) return [];
  const urls = await Promise.all(
    rows.map(async (row) => {
      const { data, error } = await admin.storage
        .from(TODOS_BUCKET)
        .createSignedUrl(row.storage_path, ATTACHMENT_URL_TTL_SECONDS, { download: row.file_name });
      if (error) {
        console.error(`todo attachment ${row.id}: signing failed`, error.message);
        return null;
      }
      return data?.signedUrl ?? null;
    }),
  );

  return rows.map((row, index) => ({
    id: row.id,
    todo_id: row.todo_id,
    comment_id: row.comment_id ?? null,
    uploaded_by: row.uploaded_by,
    file_name: row.file_name,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    uploader: row.uploader ?? null,
    signed_url: urls[index],
  }));
}

/** The object keys of a task's files. A missing attachments table (migration not applied) means none. */
export async function listTodoObjectPaths(admin: SupabaseClient, todoId: string): Promise<string[]> {
  const { data: rows, error } = await admin.from("todo_attachments").select("storage_path").eq("todo_id", todoId);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  return (rows ?? []).map((row: { storage_path: string }) => row.storage_path);
}

/** Best-effort removal of objects whose rows are already gone. An orphan object is harmless; a lost file is not. */
export async function removeObjects(admin: SupabaseClient, paths: string[], todoId: string): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await admin.storage.from(TODOS_BUCKET).remove(paths);
  if (error) console.error(`todo ${todoId}: could not remove ${paths.length} attachment object(s)`, error.message);
}
