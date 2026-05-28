import { executeRESTBackend } from "@/lib/rest-server";
import { Todo, TodoRelatedType, TodoStatus, TodoTag } from "@/types/types";

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

  createTodo: async (data: TodoCreateInput): Promise<Todo> => {
    return executeRESTBackend<Todo>("/api/todos", {
      method: "POST",
      body: data as unknown as Record<string, unknown>,
    });
  },

  updateTodo: async (data: TodoUpdateInput): Promise<Todo> => {
    return executeRESTBackend<Todo>("/api/todos", {
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

  addComment: async (todoId: string, body: string): Promise<Todo> => {
    return executeRESTBackend<Todo>("/api/todos/comments", {
      method: "POST",
      body: { todoId, body },
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
