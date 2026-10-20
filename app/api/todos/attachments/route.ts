import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import {
  canCommentTodoRecord,
  canEditTodoRecord,
  canViewTodoRecord,
  hasResourceAction,
} from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { loadTodoForAccess } from "@/lib/server/todos/access";
import {
  ATTACHMENT_SELECT,
  ATTACHMENT_SELECT_LEGACY,
  TODOS_BUCKET,
  attachmentObjectKey,
  isMissingColumn,
  signAttachments,
  type AttachmentRow,
} from "@/lib/server/todos/attachments";
import { ATTACHMENT_MAX_BYTES, checkAttachmentSignature } from "@/lib/server/todos/file-signature";
import { ActionType, ResourceType } from "@/types/types";

/*
  FR-16 (Portal FRD, 20 Oct 2026): files on a task.

  GET    ?todoId=   the task's files with one-hour signed links; anyone who
                    can VIEW the task.
  POST   multipart  `file` + `todoId`; anyone who can EDIT the task (owner,
                    assignee, admin, All Records). The bytes are checked
                    against the allowlist on the server, uploaded to the
                    private bucket, then the row is written; a failed row
                    removes the object again.
  DELETE ?id=       the uploader or the task's owner.

  A task the caller cannot see answers 404, never 403, so a private task
  (FR-20) does not reveal that it exists. Every upload and delete goes to
  the task's Updates log.
*/

const notFound = () => NextResponse.json({ error: "Todo not found" }, { status: 404 });

async function logUpdate(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
  todoId: string,
  actorId: string,
  action: "attachment_added" | "attachment_removed",
  value: { file_name: string; size_bytes: number },
) {
  const { error } = await admin.from("todo_updates").insert({
    todo_id: todoId,
    actor_id: actorId,
    action,
    field_name: "attachments",
    old_value: action === "attachment_removed" ? value : null,
    new_value: action === "attachment_added" ? value : null,
  });
  if (error) console.error(`todo ${todoId}: could not log ${action}`, error.message);
}

export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.TODOS, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const todoId = req.nextUrl.searchParams.get("todoId");
    if (!todoId) return NextResponse.json({ error: "todoId is required" }, { status: 400 });

    const todo = await loadTodoForAccess(todoId);
    if (!todo || !canViewTodoRecord(accessUser, todo, profile.id)) return notFound();

    const admin = await createAdminServerClient();
    let { data: rows, error } = await admin
      .from("todo_attachments")
      .select(ATTACHMENT_SELECT)
      .eq("todo_id", todoId)
      .order("created_at", { ascending: true });
    // comment_id arrives with migration 20261021090000; until then the
    // task's files are still listed, just without a comment to sit under.
    if (error && isMissingColumn(error.code)) {
      ({ data: rows, error } = await admin
        .from("todo_attachments")
        .select(ATTACHMENT_SELECT_LEGACY)
        .eq("todo_id", todoId)
        .order("created_at", { ascending: true }));
    }
    if (error) throw new Error(error.message);

    const attachments = await signAttachments(admin, (rows ?? []) as unknown as AttachmentRow[]);
    return NextResponse.json({ data: attachments });
  } catch (error) {
    console.error("Todo attachments GET error:", error);
    return NextResponse.json({ error: "Failed to load attachments" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // View is the floor: a mentioned user attaches files to their own comment
    // with it; a file on the task itself needs the Edit rule below.
    if (!hasResourceAction(accessUser, ResourceType.TODOS, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Refuse an oversized body before it is read into memory. Multipart
    // framing adds a little, so allow 1 MB over the file limit.
    const declaredLength = Number(req.headers.get("content-length") ?? 0);
    if (declaredLength > ATTACHMENT_MAX_BYTES + 1024 * 1024) {
      return NextResponse.json({ error: "The file is larger than 25 MB" }, { status: 413 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const todoId = form.get("todoId");
    const commentIdField = form.get("commentId");
    const commentId = typeof commentIdField === "string" && commentIdField ? commentIdField : null;
    if (typeof todoId !== "string" || !todoId) {
      return NextResponse.json({ error: "todoId is required" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      return NextResponse.json({ error: "The file is larger than 25 MB" }, { status: 400 });
    }

    const todo = await loadTodoForAccess(todoId);
    if (!todo) return notFound();

    const admin = await createAdminServerClient();
    if (commentId) {
      /*
        A file posted with a comment: the comment's author attaches it, and
        the right to do so is the right to comment (a mentioned user has it
        without the Edit action), checked against the comment itself.
      */
      if (!canCommentTodoRecord(accessUser, todo, profile.id)) return notFound();
      const { data: comment, error: commentError } = await admin
        .from("todo_comments")
        .select("id,author_id")
        .eq("id", commentId)
        .eq("todo_id", todo.id)
        .maybeSingle();
      if (commentError) throw new Error(commentError.message);
      if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 });
      if (comment.author_id !== profile.id) {
        return NextResponse.json({ error: "Only the comment's author can attach files to it" }, { status: 403 });
      }
    } else if (!canEditTodoRecord(accessUser, todo, profile.id)) {
      return notFound();
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkAttachmentSignature(file.name, bytes);
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });

    const attachmentId = randomUUID();
    // todo.id, not the form value: Postgres accepts several uuid spellings.
    const storagePath = attachmentObjectKey(todo.id, attachmentId, check.extension);

    const { error: uploadError } = await admin.storage
      .from(TODOS_BUCKET)
      .upload(storagePath, bytes, { contentType: check.contentType, upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const fileName = file.name.trim().slice(0, 255);
    const { data: created, error: insertError } = await admin
      .from("todo_attachments")
      .insert({
        id: attachmentId,
        todo_id: todo.id,
        ...(commentId ? { comment_id: commentId } : {}),
        uploaded_by: profile.id,
        file_name: fileName,
        content_type: check.contentType,
        size_bytes: bytes.byteLength,
        storage_path: storagePath,
      })
      .select(commentId ? ATTACHMENT_SELECT : ATTACHMENT_SELECT_LEGACY)
      .single();
    if (insertError || !created) {
      // No orphaned objects: the row is the record of the file.
      await admin.storage.from(TODOS_BUCKET).remove([storagePath]);
      if (commentId && isMissingColumn(insertError?.code)) {
        return NextResponse.json(
          { error: "Files on comments need the database update 20261021090000 applied first." },
          { status: 409 },
        );
      }
      throw new Error(insertError?.message ?? "Attachment row was not created");
    }

    await logUpdate(admin, todo.id, profile.id, "attachment_added", {
      file_name: fileName,
      size_bytes: bytes.byteLength,
    });

    const [attachment] = await signAttachments(admin, [created as unknown as AttachmentRow]);
    return NextResponse.json({ data: attachment }, { status: 201 });
  } catch (error) {
    console.error("Todo attachments POST error:", error);
    return NextResponse.json({ error: "Failed to upload the attachment" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.TODOS, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const admin = await createAdminServerClient();
    const { data: row, error: rowError } = await admin
      .from("todo_attachments")
      .select("id,todo_id,uploaded_by,file_name,size_bytes,storage_path")
      .eq("id", id)
      .maybeSingle();
    if (rowError) throw new Error(rowError.message);
    if (!row) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

    const todo = await loadTodoForAccess(row.todo_id);
    if (!todo || !canViewTodoRecord(accessUser, todo, profile.id)) return notFound();

    // FR-16 point 5: the uploader and the task owner delete; nobody else.
    if (row.uploaded_by !== profile.id && todo.owner_id !== profile.id) {
      return NextResponse.json({ error: "Only the uploader or the todo's owner can delete this file" }, { status: 403 });
    }

    const { error: deleteError } = await admin.from("todo_attachments").delete().eq("id", id);
    if (deleteError) throw new Error(deleteError.message);

    const { error: removeError } = await admin.storage.from(TODOS_BUCKET).remove([row.storage_path]);
    if (removeError) console.error(`attachment ${id}: row deleted but object remains`, removeError.message);

    await logUpdate(admin, row.todo_id, profile.id, "attachment_removed", {
      file_name: row.file_name,
      size_bytes: row.size_bytes,
    });

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("Todo attachments DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete the attachment" }, { status: 500 });
  }
}
