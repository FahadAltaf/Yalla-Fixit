import { executeRESTBackend } from "@/lib/rest-server";
import { Todo, TodoAttachment, TodoRelatedType, TodoStatus, TodoTag } from "@/types/types";

export interface TodosFilters {
  search?: string;
  ownerId?: string;
  assigneeId?: string;
  status?: TodoStatus | "all";
  sortBy?: "deadline" | "created" | "todoKey";
  sortDirection?: "asc" | "desc";
  tag?: string;
  relatedType?: TodoRelatedType | "all";
  relatedId?: string;
  deadlineDate?: string;
  reminderDate?: string;
  deadlineFrom?: string;
  deadlineTo?: string;
  reminderFrom?: string;
  reminderTo?: string;
}

export interface TodoListResponse {
  todos: Todo[];
  totalCount: number;
}

export interface TodoCreateInput {
  title: string;
  description: string;
  assigneeIds: string[];
  tags: string[];
  relatedType?: TodoRelatedType | null;
  relatedId?: string | null;
  deadlineAt: string;
  reminderAt?: string | null;
  status?: TodoStatus;
}

export interface TodoUpdateInput extends Partial<TodoCreateInput> {
  id: string;
  status?: TodoStatus;
}

/**
 * A saved todo, plus anything that went wrong AFTER the save committed
 * (FR-18: a failed assignment email; FR-19: a non-owner's title or
 * description change that was ignored). The save itself succeeded.
 */
export type TodoSaveWarning = "assignment_email_failed" | "title_description_owner_only";

export type TodoSaveResult = Todo & { warnings?: TodoSaveWarning[] };

// FR-17: what the comments route answers; `mention_email_failed` means the
// comment is saved but at least one mention email did not go out.
export interface CommentSaveResult {
  id: string;
  commentId: string;
  warnings?: string[];
}

export interface MentionableUser {
  id: string;
  name: string;
  email: string | null;
}

export interface TodoTagInput {
  id?: string;
  name: string;
  color: string;
}

export const todosService = {
  listTodos: async (
    filters: TodosFilters = {},
    page = 0,
    pageSize = 100
  ): Promise<TodoListResponse> => {
    const params: Record<string, string | number> = {
      page,
      pageSize,
    };

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "" && value !== "all") {
        params[key] = String(value);
      }
    });

    return executeRESTBackend<TodoListResponse>("/api/todos", {
      method: "GET",
      params,
    });
  },

  // One todo by id, or null when it is gone or hidden from this user.
  getTodo: async (id: string): Promise<Todo | null> => {
    const response = await executeRESTBackend<TodoListResponse>("/api/todos", {
      method: "GET",
      params: { id, page: 0, pageSize: 1 },
    });
    return response.todos[0] ?? null;
  },

  createTodo: async (data: TodoCreateInput): Promise<TodoSaveResult> => {
    return executeRESTBackend<TodoSaveResult>("/api/todos", {
      method: "POST",
      body: data as unknown as Record<string, unknown>,
    });
  },

  updateTodo: async (data: TodoUpdateInput): Promise<TodoSaveResult> => {
    return executeRESTBackend<TodoSaveResult>("/api/todos", {
      method: "PUT",
      body: data as unknown as Record<string, unknown>,
    });
  },

  deleteTodo: async (id: string): Promise<{ success: boolean }> => {
    return executeRESTBackend<{ success: boolean }>("/api/todos", {
      method: "DELETE",
      params: { id },
    });
  },

  addComment: async (todoId: string, body: string): Promise<CommentSaveResult> => {
    return executeRESTBackend<CommentSaveResult>("/api/todos/comments", {
      method: "POST",
      body: { todoId, body },
    });
  },

  // FR-17: the author rewrites a comment; only newly mentioned users are emailed.
  updateComment: async (id: string, todoId: string, body: string): Promise<CommentSaveResult> => {
    return executeRESTBackend<CommentSaveResult>("/api/todos/comments", {
      method: "PATCH",
      body: { id, todoId, body },
    });
  },

  listMentionableUsers: async (): Promise<MentionableUser[]> => {
    return executeRESTBackend<MentionableUser[]>("/api/todos/mentionable-users", { method: "GET" });
  },

  // FR-16 attachments. Upload is multipart, which executeRESTBackend (JSON
  // only) cannot send, so it is a plain fetch with the same cookie session.
  listAttachments: async (todoId: string): Promise<TodoAttachment[]> => {
    return executeRESTBackend<TodoAttachment[]>("/api/todos/attachments", {
      method: "GET",
      params: { todoId },
    });
  },

  uploadAttachment: async (todoId: string, file: File, commentId?: string): Promise<TodoAttachment> => {
    const form = new FormData();
    form.append("todoId", todoId);
    if (commentId) form.append("commentId", commentId);
    form.append("file", file, file.name);
    const response = await fetch("/api/todos/attachments", { method: "POST", body: form });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload?.error === "string" ? payload.error : "Failed to upload the attachment";
      throw new Error(message);
    }
    return payload.data as TodoAttachment;
  },

  deleteAttachment: async (id: string): Promise<{ success: boolean }> => {
    return executeRESTBackend<{ success: boolean }>("/api/todos/attachments", {
      method: "DELETE",
      params: { id },
    });
  },

  deleteComment: async (
    id: string,
    todoId: string
  ): Promise<{ success: boolean }> => {
    return executeRESTBackend<{ success: boolean }>("/api/todos/comments", {
      method: "DELETE",
      params: { id, todoId },
    });
  },

  listTags: async (): Promise<TodoTag[]> => {
    return executeRESTBackend<TodoTag[]>("/api/todos/tags", {
      method: "GET",
    });
  },

  createTag: async (data: TodoTagInput): Promise<TodoTag> => {
    return executeRESTBackend<TodoTag>("/api/todos/tags", {
      method: "POST",
      body: data as unknown as Record<string, unknown>,
    });
  },

  updateTag: async (data: TodoTagInput & { id: string }): Promise<TodoTag> => {
    return executeRESTBackend<TodoTag>("/api/todos/tags", {
      method: "PUT",
      body: data as unknown as Record<string, unknown>,
    });
  },

  deleteTag: async (id: string): Promise<{ success: boolean }> => {
    return executeRESTBackend<{ success: boolean }>("/api/todos/tags", {
      method: "DELETE",
      params: { id },
    });
  },
};
