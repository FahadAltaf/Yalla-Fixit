"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlignLeft,
  CalendarClock,
  Copy,
  History,
  Link2,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationAlertDialog } from "@/components/ui/confirmation-alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MultipleSelector, { Option } from "@/components/ui/multiselect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StatusBadge from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/actions/utils";
import {
  canCommentTodoRecord,
  canDeleteTodoRecord,
  canEditTodoContent,
  canEditTodoRecord,
  isPrivateManagerTodo,
} from "@/lib/role-permissions";
import {
  MentionableUser,
  TodoCreateInput,
  TodoSaveWarning,
  TodoUpdateInput,
  todosService,
} from "@/modules/todos";
import { TODO_STATUS_LABELS, Todo, TodoAttachment, TodoRelatedType, TodoStatus, User } from "@/types/types";
import {
  ATTACHMENT_TYPES_LABEL,
  AttachmentItem,
  FilePickerButton,
  QueuedFiles,
  uploadFiles,
} from "./attachments-panel";
import { CommentComposer, MentionText } from "./comment-composer";
import {
  RELATED_TYPES,
  RELATED_TYPE_LABELS,
  TODO_STATUSES,
  formatUpdateSummary,
  formatWhen,
  fromDatetimeLocal,
  tagBadgeStyle,
  toDatetimeLocal,
  userInitials,
  userLabel,
} from "./todo-helpers";

/*
  The todo dialog, in two shapes.

  CREATE is one short form: title, description, who and when, files to go
  with it. EDIT reads like the todo itself: the title on top, the
  description, the files, then the conversation, with the facts that get
  changed (status, people, dates, tags, link) in a side panel. Files sit in
  their own section rather than behind a tab, and a comment can carry files
  too.

  The parent mounts this only while it is open, so every open starts from
  the todo as it is; later refreshes of `todo` (a comment, a file) flow in
  without touching what is being typed.
*/

type FormState = {
  title: string;
  description: string;
  assigneeIds: string[];
  tags: string[];
  relatedType: TodoRelatedType | "none";
  relatedId: string;
  deadlineAt: string;
  reminderAt: string;
  status: TodoStatus;
};

const SAVE_WARNING_MESSAGES: Record<TodoSaveWarning, string> = {
  assignment_email_failed: "Saved, but the assignment email could not be sent.",
  title_description_owner_only:
    "Saved, but only the owner can change the title and description, so those were left as they were.",
};

function formFrom(todo: Todo | null, initialStatus?: TodoStatus): FormState {
  if (!todo) {
    return {
      title: "",
      description: "",
      assigneeIds: [],
      tags: [],
      relatedType: "none",
      relatedId: "",
      deadlineAt: "",
      reminderAt: "",
      status: initialStatus ?? "todo",
    };
  }
  return {
    title: todo.title,
    description: todo.description,
    assigneeIds: todo.assignees?.map((user) => user.id) ?? [],
    tags: todo.tags,
    relatedType: todo.related_type || "none",
    relatedId: todo.related_id || "",
    deadlineAt: toDatetimeLocal(todo.deadline_at),
    reminderAt: toDatetimeLocal(todo.reminder_at),
    status: todo.status,
  };
}

function Section({
  icon: Icon,
  title,
  count,
  action,
  children,
}: {
  icon: React.ElementType;
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="text-muted-foreground size-4" />
          {title}
          {typeof count === "number" && count > 0 && (
            <span className="text-muted-foreground font-normal tabular-nums">{count}</span>
          )}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

function Avatar({ user }: { user?: User | null }) {
  return (
    <span
      className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      title={userLabel(user)}
    >
      {userInitials(user)}
    </span>
  );
}

export function TodoDialog({
  todo,
  initialStatus,
  users,
  mentionableUsers,
  tagOptions,
  tagColorMap,
  userProfile,
  userId,
  isAdmin,
  canViewAllRecords,
  onClose,
  onRefresh,
  onDelete,
  onCopyLink,
}: {
  todo: Todo | null;
  initialStatus?: TodoStatus;
  users: User[];
  mentionableUsers: MentionableUser[];
  tagOptions: Option[];
  tagColorMap: Map<string, string | undefined>;
  userProfile: User | null | undefined;
  userId: string;
  isAdmin: boolean;
  canViewAllRecords: boolean;
  onClose: () => void;
  // Reloads the list and the open todo after anything changes.
  onRefresh: () => Promise<void>;
  onDelete?: (todo: Todo) => void;
  onCopyLink: (todo: Todo) => void;
}) {
  const isCreate = todo === null;
  const [form, setForm] = useState<FormState>(() => formFrom(todo, initialStatus));
  const [initial] = useState<FormState>(() => formFrom(todo, initialStatus));
  const [saving, setSaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState<null | "self" | "private">(null);
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);

  // Files on the todo, loaded when the dialog opens and after each change.
  const [attachments, setAttachments] = useState<TodoAttachment[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteFile, setDeleteFile] = useState<TodoAttachment | null>(null);
  const [deletingFile, setDeletingFile] = useState(false);

  // The conversation.
  const [commentBody, setCommentBody] = useState("");
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [editingComment, setEditingComment] = useState<{ id: string; body: string } | null>(null);
  const [savingComment, setSavingComment] = useState(false);
  const [deleteComment, setDeleteComment] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const canEdit = todo ? canEditTodoRecord(userProfile, todo, userId) : true;
  const canEditContent = todo ? canEditTodoContent(todo, userId) : true;
  const canComment = todo ? canCommentTodoRecord(userProfile, todo, userId) : false;
  const canDelete = todo ? canDeleteTodoRecord(userProfile, todo, userId) : false;

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  const userOptions: Option[] = useMemo(
    () => users.map((user) => ({ value: user.id, label: userLabel(user) })),
    [users],
  );
  const selectedAssignees = userOptions.filter((option) => form.assigneeIds.includes(option.value));
  const mentionNameById = useMemo(
    () => new Map(mentionableUsers.map((user) => [user.id, user.name])),
    [mentionableUsers],
  );

  const todoId = todo?.id;
  const loadAttachments = async () => {
    if (!todoId) return;
    try {
      setAttachments(await todosService.listAttachments(todoId));
    } catch (error) {
      console.error("Error loading attachments:", error);
      setAttachments([]);
    }
  };
  useEffect(() => {
    if (!todoId) return;
    let cancelled = false;
    todosService
      .listAttachments(todoId)
      .then((list) => {
        if (!cancelled) setAttachments(list);
      })
      .catch((error) => {
        console.error("Error loading attachments:", error);
        if (!cancelled) setAttachments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [todoId]);

  const todoFiles = (attachments ?? []).filter((file) => !file.comment_id);
  const filesByComment = useMemo(() => {
    const map = new Map<string, TodoAttachment[]>();
    (attachments ?? []).forEach((file) => {
      if (!file.comment_id) return;
      map.set(file.comment_id, [...(map.get(file.comment_id) ?? []), file]);
    });
    return map;
  }, [attachments]);

  const refreshAll = async () => {
    await Promise.all([onRefresh(), loadAttachments()]);
  };

  // ---- Save / create ----------------------------------------------------

  const validate = () => {
    if (!form.title.trim()) return "Title is required";
    if (!form.description.trim()) return "Description is required";
    if (form.assigneeIds.length === 0) return "Select at least one assignee";
    if (!form.deadlineAt) return "Deadline is required";
    return null;
  };

  const save = async (leaveConfirmed = false) => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }

    if (todo) {
      // Two ways a non-owner can save themselves out: an Own-Records
      // assignee removing themselves, or leaving a flagged manager as the
      // only assignee (FR-20). Ask once.
      const removesSelf =
        !canViewAllRecords &&
        todo.owner_id !== userId &&
        Boolean(todo.assignees?.some((user) => user.id === userId)) &&
        !form.assigneeIds.includes(userId);
      const makesPrivate =
        todo.owner_id !== userId &&
        isPrivateManagerTodo({
          owner_id: todo.owner_id,
          owner: todo.owner,
          assignees: form.assigneeIds.map((id) => ({ id })),
        });
      if ((removesSelf || makesPrivate) && !leaveConfirmed) {
        setConfirmLeave(makesPrivate ? "private" : "self");
        return;
      }
    }

    const payload: TodoCreateInput = {
      title: form.title.trim(),
      description: form.description.trim(),
      assigneeIds: form.assigneeIds,
      tags: form.tags,
      relatedType: form.relatedType === "none" ? null : form.relatedType,
      relatedId: form.relatedId.trim() || null,
      deadlineAt: fromDatetimeLocal(form.deadlineAt),
      reminderAt: form.reminderAt ? fromDatetimeLocal(form.reminderAt) : null,
      status: form.status,
    };

    setSaving(true);
    try {
      if (todo) {
        const update: TodoUpdateInput = { ...(payload as TodoUpdateInput), id: todo.id };
        if (!canEditContent) {
          delete update.title;
          delete update.description;
        }
        const saved = await todosService.updateTodo(update);
        toast.success("Todo updated");
        saved.warnings?.forEach((warning) => toast.warning(SAVE_WARNING_MESSAGES[warning] ?? warning));
        await onRefresh();
        onClose();
      } else {
        const created = await todosService.createTodo(payload);
        toast.success(`${created.todo_key} created`);
        created.warnings?.forEach((warning) => toast.warning(SAVE_WARNING_MESSAGES[warning] ?? warning));
        if (queuedFiles.length > 0) {
          const added = await uploadFiles(created.id, queuedFiles);
          if (added > 0) toast.success(added === 1 ? "File attached" : `${added} files attached`);
        }
        await onRefresh();
        onClose();
      }
    } catch (error) {
      console.error("Error saving todo:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save todo");
    } finally {
      setSaving(false);
    }
  };

  // ---- Files ------------------------------------------------------------

  const attachToTodo = async (files: File[]) => {
    if (!todo) return;
    setUploading(true);
    try {
      const added = await uploadFiles(todo.id, files);
      if (added > 0) {
        toast.success(added === 1 ? "File attached" : `${added} files attached`);
        await refreshAll();
      }
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async () => {
    if (!deleteFile) return;
    setDeletingFile(true);
    try {
      await todosService.deleteAttachment(deleteFile.id);
      toast.success("File deleted");
      setDeleteFile(null);
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete the file");
    } finally {
      setDeletingFile(false);
    }
  };

  const canDeleteFile = (file: TodoAttachment) => file.uploaded_by === userId || todo?.owner_id === userId;

  // ---- Conversation -----------------------------------------------------

  const postComment = async () => {
    if (!todo || (!commentBody.trim() && commentFiles.length === 0)) return;
    if (!commentBody.trim()) {
      toast.error("Write a comment to go with the files");
      return;
    }
    setSavingComment(true);
    try {
      const result = await todosService.addComment(todo.id, commentBody.trim());
      if (commentFiles.length > 0) {
        const added = await uploadFiles(todo.id, commentFiles, result.commentId);
        if (added < commentFiles.length) toast.warning("The comment was posted, but not every file went with it.");
      }
      setCommentBody("");
      setCommentFiles([]);
      toast.success("Comment posted");
      if (result.warnings?.includes("mention_email_failed")) {
        toast.warning("Comment saved, but a mention email could not be sent.");
      }
      await refreshAll();
    } catch (error) {
      console.error("Error adding comment:", error);
      toast.error(error instanceof Error ? error.message : "Failed to post the comment");
    } finally {
      setSavingComment(false);
    }
  };

  const saveEditedComment = async () => {
    if (!todo || !editingComment || !editingComment.body.trim()) return;
    setSavingComment(true);
    try {
      const result = await todosService.updateComment(editingComment.id, todo.id, editingComment.body.trim());
      setEditingComment(null);
      toast.success("Comment updated");
      if (result.warnings?.includes("mention_email_failed")) {
        toast.warning("Comment saved, but a mention email could not be sent.");
      }
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update the comment");
    } finally {
      setSavingComment(false);
    }
  };

  const removeComment = async () => {
    if (!todo || !deleteComment) return;
    try {
      await todosService.deleteComment(deleteComment, todo.id);
      toast.success("Comment deleted");
      setDeleteComment(null);
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete the comment");
    }
  };

  // ---- Pieces -----------------------------------------------------------

  const detailFields = (
    <>
      <Field label="Status">
        <Select
          value={form.status}
          disabled={!canEdit}
          onValueChange={(value) => setForm((current) => ({ ...current, status: value as TodoStatus }))}
        >
          <SelectTrigger className="w-full" id="todo-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TODO_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {TODO_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Assignees">
        <MultipleSelector
          value={selectedAssignees}
          options={userOptions}
          disabled={!canEdit}
          placeholder="Who is doing this?"
          onChange={(options) => setForm((current) => ({ ...current, assigneeIds: options.map((option) => option.value) }))}
          emptyIndicator={<span className="text-muted-foreground">No users found</span>}
        />
      </Field>
      <Field label="Deadline">
        <Input
          id="todo-deadline"
          type="datetime-local"
          value={form.deadlineAt}
          disabled={!canEdit}
          onChange={(event) => setForm((current) => ({ ...current, deadlineAt: event.target.value }))}
        />
      </Field>
      <Field label="Reminder" hint={isCreate ? "Optional. Everyone on the todo is emailed at this time." : undefined}>
        <Input
          id="todo-reminder"
          type="datetime-local"
          value={form.reminderAt}
          disabled={!canEdit}
          onChange={(event) => setForm((current) => ({ ...current, reminderAt: event.target.value }))}
        />
      </Field>
      <Field label="Tags">
        <MultipleSelector
          value={form.tags.map((tag) => ({ value: tag, label: tag, color: tagColorMap.get(tag.toLowerCase()) }))}
          options={tagOptions}
          disabled={!canEdit}
          creatable={canEdit}
          placeholder="Add tags"
          onChange={(options) => setForm((current) => ({ ...current, tags: options.map((option) => option.value) }))}
          emptyIndicator={<span className="text-muted-foreground">Type to create a tag</span>}
        />
      </Field>
      <Field label="Linked record">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2">
          <Select
            value={form.relatedType}
            disabled={!canEdit}
            onValueChange={(value) => setForm((current) => ({ ...current, relatedType: value as TodoRelatedType | "none" }))}
          >
            <SelectTrigger className="w-full" id="todo-related-type" aria-label="Linked record type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {RELATED_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {RELATED_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            id="todo-related-id"
            value={form.relatedId}
            disabled={!canEdit || form.relatedType === "none"}
            onChange={(event) => setForm((current) => ({ ...current, relatedId: event.target.value }))}
            placeholder="WO-1234 or AP-123"
            aria-label="Linked record ID"
          />
        </div>
      </Field>
    </>
  );

  const filesSection = todo && (
    <Section
      icon={Paperclip}
      title="Files"
      count={todoFiles.length}
      action={canEdit ? <FilePickerButton onPick={attachToTodo} busy={uploading} /> : undefined}
    >
      {attachments === null ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading files…
        </div>
      ) : todoFiles.length === 0 ? (
        <div className="text-muted-foreground rounded-md border border-dashed px-4 py-5 text-sm">
          {canEdit ? (
            <>
              No files yet. Quotations, sheets and reports that belong with this todo go here.
              <span className="block text-xs">{ATTACHMENT_TYPES_LABEL}.</span>
            </>
          ) : (
            "No files on this todo."
          )}
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {todoFiles.map((file) => (
            <AttachmentItem key={file.id} attachment={file} canDelete={canDeleteFile(file)} onDelete={setDeleteFile} />
          ))}
        </ul>
      )}
    </Section>
  );

  const conversationSection = todo && (
    <Section icon={MessageSquare} title="Conversation" count={todo.comments?.length ?? 0}>
      <div className="space-y-3">
        {todo.comments?.length ? (
          todo.comments.map((comment) => {
            const mine = comment.author_id === userId;
            const files = filesByComment.get(comment.id) ?? [];
            return (
              <div key={comment.id} className="flex gap-3">
                <Avatar user={comment.author} />
                <div className="min-w-0 flex-1 rounded-md border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div className="text-sm">
                      <span className="font-medium">{userLabel(comment.author)}</span>
                      <span className="text-muted-foreground"> · {formatWhen(comment.created_at)}</span>
                      {comment.updated_at && comment.updated_at !== comment.created_at && (
                        <span className="text-muted-foreground text-xs"> · edited</span>
                      )}
                    </div>
                    {editingComment?.id !== comment.id && (mine || isAdmin) && (
                      <span className="flex items-center gap-0.5">
                        {mine && (
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            aria-label="Edit comment"
                            onClick={() => setEditingComment({ id: comment.id, body: comment.body })}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Delete comment"
                          onClick={() => setDeleteComment(comment.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </span>
                    )}
                  </div>
                  {editingComment?.id === comment.id ? (
                    <div className="mt-2">
                      <CommentComposer
                        value={editingComment.body}
                        onChange={(body) => setEditingComment({ id: comment.id, body })}
                        users={mentionableUsers}
                        onSubmit={() => void saveEditedComment()}
                        onCancel={() => setEditingComment(null)}
                        submitting={savingComment}
                        submitLabel="Save"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <MentionText body={comment.body} nameById={mentionNameById} />
                  )}
                  {files.length > 0 && (
                    <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      {files.map((file) => (
                        <AttachmentItem
                          key={file.id}
                          attachment={file}
                          compact
                          canDelete={canDeleteFile(file)}
                          onDelete={setDeleteFile}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-muted-foreground rounded-md border border-dashed px-4 py-5 text-sm">
            No comments yet. Type @ to bring someone in.
          </p>
        )}

        {canComment && (
          <div className="flex gap-3">
            <Avatar user={userProfile} />
            <div className="min-w-0 flex-1 space-y-2">
              <CommentComposer
                value={commentBody}
                onChange={setCommentBody}
                users={mentionableUsers}
                onSubmit={() => void postComment()}
                submitting={savingComment}
                submitLabel="Post"
                placeholder="Write a comment. Type @ to mention someone"
                leading={
                  <FilePickerButton
                    onPick={(files) => setCommentFiles((current) => [...current, ...files])}
                    disabled={savingComment}
                    size="xs"
                    variant="ghost"
                    label="Attach files to this comment"
                    iconOnly
                  />
                }
              />
              <QueuedFiles
                files={commentFiles}
                onRemove={(index) => setCommentFiles((current) => current.filter((_, i) => i !== index))}
              />
            </div>
          </div>
        )}
      </div>
    </Section>
  );

  const historySection = todo && (
    <div className="border-t pt-4">
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground flex w-full items-center justify-between text-sm"
        onClick={() => setHistoryOpen((open) => !open)}
        aria-expanded={historyOpen}
      >
        <span className="flex items-center gap-2">
          <History className="size-4" /> History
          <span className="tabular-nums">{todo.updates?.length ?? 0}</span>
        </span>
        <span className="text-xs">{historyOpen ? "Hide" : "Show"}</span>
      </button>
      {historyOpen && (
        <ul className="mt-3 space-y-2">
          {todo.updates?.length ? (
            todo.updates.map((update) => (
              <li key={update.id} className="text-xs">
                <span className="font-medium">{userLabel(update.actor)}</span>{" "}
                <span className="text-muted-foreground">{formatUpdateSummary(update)}</span>
                <div className="text-muted-foreground">{formatWhen(update.created_at)}</div>
              </li>
            ))
          ) : (
            <li className="text-muted-foreground text-xs">Nothing yet.</li>
          )}
        </ul>
      )}
    </div>
  );

  // ---- Create -----------------------------------------------------------

  if (isCreate) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <div className="border-b px-6 py-4">
            <DialogTitle className="text-lg">New todo</DialogTitle>
            <DialogDescription className="text-xs">
              You become its owner. Assignees are emailed when it is created.
            </DialogDescription>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <Input
              id="todo-title"
              autoFocus
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="What needs doing?"
              className="h-11 text-base font-medium"
              aria-label="Title"
            />
            <Textarea
              id="todo-description"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Add the details: what, where, anything the assignee should know."
              className="min-h-28 resize-y"
              aria-label="Description"
            />
            <div className="grid gap-4 sm:grid-cols-2">{detailFields}</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Files</Label>
                <FilePickerButton onPick={(files) => setQueuedFiles((current) => [...current, ...files])} />
              </div>
              {queuedFiles.length > 0 ? (
                <QueuedFiles
                  files={queuedFiles}
                  onRemove={(index) => setQueuedFiles((current) => current.filter((_, i) => i !== index))}
                />
              ) : (
                <p className="text-muted-foreground text-xs">{ATTACHMENT_TYPES_LABEL}. Uploaded once the todo is created.</p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t px-6 py-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Create todo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ---- Edit / view ------------------------------------------------------

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <div className="border-b px-6 pt-4 pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="rounded-sm font-mono">
                    {todo.todo_key}
                  </Badge>
                  <StatusBadge status={todo.status} />
                  <span className="text-muted-foreground text-xs">
                    Opened by {userLabel(todo.owner)} · {formatWhen(todo.created_at)}
                  </span>
                </div>
                {canEditContent ? (
                  <Input
                    id="todo-title"
                    value={form.title}
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Title"
                    className="h-auto border-0 bg-transparent px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
                    aria-label="Title"
                  />
                ) : (
                  <DialogTitle className="text-xl font-semibold">{todo.title}</DialogTitle>
                )}
                {canEditContent && <DialogTitle className="sr-only">{todo.title}</DialogTitle>}
                <DialogDescription className="sr-only">Todo {todo.todo_key}</DialogDescription>
              </div>
              <div className="flex shrink-0 items-center gap-1 pr-6">
                <Button type="button" variant="ghost" size="sm" onClick={() => onCopyLink(todo)}>
                  <Copy className="size-4" /> Copy link
                </Button>
                {canDelete && onDelete && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => onDelete(todo)}>
                    <Trash2 className="size-4" /> Delete
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid gap-8 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 space-y-7">
                <Section icon={AlignLeft} title="Description">
                  {canEditContent ? (
                    <Textarea
                      id="todo-description"
                      value={form.description}
                      onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                      placeholder="What needs to be done?"
                      className="min-h-24 resize-y"
                    />
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-sm whitespace-pre-wrap">{todo.description}</p>
                      {canEdit && (
                        <p className="text-muted-foreground text-xs">
                          Only {userLabel(todo.owner)}, the owner, can change the title and description.
                        </p>
                      )}
                    </div>
                  )}
                </Section>
                {filesSection}
                {conversationSection}
              </div>

              <aside className="min-w-0 space-y-4 lg:border-l lg:pl-6">
                <div className="grid gap-4">{detailFields}</div>
                {!canEdit && (
                  <p className="text-muted-foreground text-xs">
                    You can read this todo{canComment ? " and comment on it" : ""}, but not change it.
                  </p>
                )}
                {todo.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {todo.tags.map((tag) => (
                      <Badge key={tag} variant="outline" style={tagBadgeStyle(tagColorMap.get(tag.toLowerCase()))}>
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                {todo.related_type && todo.related_id && (
                  <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <Link2 className="size-3.5" /> {RELATED_TYPE_LABELS[todo.related_type]} {todo.related_id}
                  </p>
                )}
                <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <CalendarClock className="size-3.5" /> Due {formatWhen(todo.deadline_at)}
                </p>
                {historySection}
              </aside>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-6 py-3">
            <span className={cn("text-xs", dirty ? "text-warning" : "text-muted-foreground")}>
              {dirty ? "Unsaved changes" : canEdit ? "All changes saved" : ""}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                {canEdit ? "Cancel" : "Close"}
                <X className="size-4" />
              </Button>
              {canEdit && (
                <Button type="button" onClick={() => void save()} disabled={saving || !dirty}>
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  Save changes
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationAlertDialog
        isOpen={confirmLeave !== null}
        onOpenChange={(open) => !open && setConfirmLeave(null)}
        title={confirmLeave === "private" ? "Make this todo private to its owner?" : "Remove yourself from this todo?"}
        description={
          confirmLeave === "private"
            ? "The owner is a task manager and would be the only assignee, so the todo becomes private to them. Once saved, it will disappear from your list and you will not be able to open it again."
            : "You are no longer an assignee. Once saved, this todo will disappear from your list and you will not be able to open it again."
        }
        confirmText="Save anyway"
        onConfirm={() => {
          setConfirmLeave(null);
          void save(true);
        }}
      />

      <ConfirmationAlertDialog
        isOpen={Boolean(deleteFile)}
        onOpenChange={(open) => !open && setDeleteFile(null)}
        title="Delete this file?"
        description={`"${deleteFile?.file_name ?? ""}" will be removed. This cannot be undone.`}
        confirmText="Delete"
        variant="destructive"
        loading={deletingFile}
        onConfirm={removeFile}
      />

      <ConfirmationAlertDialog
        isOpen={Boolean(deleteComment)}
        onOpenChange={(open) => !open && setDeleteComment(null)}
        title="Delete this comment?"
        description="The comment and any files posted with it will be removed."
        confirmText="Delete"
        variant="destructive"
        onConfirm={removeComment}
      />
    </>
  );
}
