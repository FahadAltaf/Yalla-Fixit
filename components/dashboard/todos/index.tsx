"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CirclePause,
  Clock,
  Copy,
  LayoutGrid,
  List,
  ListTodo,
  Palette,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MultipleSelector, { Option } from "@/components/ui/multiselect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmationAlertDialog } from "@/components/ui/confirmation-alert-dialog";
import StatusBadge from "@/components/ui/status-badge";
import { useAuth } from "@/context/AuthContext";
import { usersService } from "@/modules/users/services/users-service";
import {
  TodoCreateInput,
  TodoUpdateInput,
  TodosFilters,
  todosService,
} from "@/modules/todos";
import {
  TODO_STATUS_LABELS,
  Todo,
  TodoRelatedType,
  TodoStatus,
  TodoTag,
  User,
  UserRoles,
} from "@/types/types";

const TODO_STATUSES: TodoStatus[] = ["todo", "in_progress", "done", "blocked", "canceled"];
const RELATED_TYPES: TodoRelatedType[] = ["work_order", "quotation", "appointment"];
type TodosViewMode = "kanban" | "list";

const emptyForm = {
  title: "",
  description: "",
  assigneeIds: [] as string[],
  tags: [] as string[],
  relatedType: "none" as TodoRelatedType | "none",
  relatedId: "",
  deadlineAt: "",
  reminderAt: "",
  status: "todo" as TodoStatus,
};

const emptyTagForm = {
  id: "",
  name: "",
  color: "#64748b",
};

const MATERIAL_TAG_COLORS = [
  "#f44336",
  "#e91e63",
  "#9c27b0",
  "#673ab7",
  "#3f51b5",
  "#2196f3",
  "#03a9f4",
  "#00bcd4",
  "#009688",
  "#4caf50",
  "#8bc34a",
  "#cddc39",
  "#ffeb3b",
  "#ffc107",
  "#ff9800",
  "#ff5722",
  "#795548",
  "#607d8b",
];

function toDatetimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string) {
  return value ? new Date(value).toISOString() : "";
}

function getTodoLink(todo: Todo) {
  if (typeof window === "undefined") return `/todos?todo=${encodeURIComponent(todo.todo_key)}`;
  return `${window.location.origin}/todos?todo=${encodeURIComponent(todo.todo_key)}`;
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

function formatUpdateField(fieldName?: string | null) {
  const labels: Record<string, string> = {
    title: "Title",
    description: "Description",
    tags: "Tags",
    related_type: "Related type",
    related_id: "Related ID",
    deadline: "Deadline",
    reminder: "Reminder",
    status: "Status",
    assignees: "Assignees",
  };
  return fieldName ? labels[fieldName] || fieldName.replace("_", " ") : "Todo";
}

function formatUpdateValue(value: unknown, fieldName?: string | null) {
  if (value === null || value === undefined || value === "") return "empty";
  if (fieldName === "status" && typeof value === "string" && value in TODO_STATUS_LABELS) {
    return TODO_STATUS_LABELS[value as TodoStatus];
  }
  if ((fieldName === "deadline" || fieldName === "reminder") && typeof value === "string") {
    return formatDateTime(value);
  }
  if (fieldName === "related_type" && typeof value === "string") {
    return value.replace("_", " ");
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "object" && item && "name" in item) {
          return String((item as { name: unknown }).name);
        }
        return String(item);
      })
      .join(", ") || "empty";
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatUpdateSummary(update: NonNullable<Todo["updates"]>[number]) {
  if (update.action === "created") return "created this todo";
  const fieldName = formatUpdateField(update.field_name);
  return `changed ${fieldName} from ${formatUpdateValue(update.old_value, update.field_name)} to ${formatUpdateValue(update.new_value, update.field_name)}`;
}

function tagBadgeStyle(color?: string) {
  if (!color) return undefined;
  return {
    backgroundColor: `${color}1A`,
    borderColor: `${color}66`,
    color,
  };
}

function userLabel(user?: User | null) {
  if (!user) return "Unknown user";
  return user.full_name || [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email || "Unknown user";
}

function statusIcon(status: TodoStatus) {
  if (status === "done") return <CheckCircle2 className="size-4 text-green-600" />;
  if (status === "blocked") return <CircleAlert className="size-4 text-amber-600" />;
  if (status === "canceled") return <CirclePause className="size-4 text-destructive" />;
  if (status === "in_progress") return <Clock className="size-4 text-amber-600" />;
  return <ListTodo className="size-4 text-muted-foreground" />;
}

function localDayTime(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function deadlineBorderClass(todo: Todo) {
  if (todo.status === "done" || todo.status === "canceled") return "border";

  const deadlineAt = todo.deadline_at;
  const deadline = new Date(deadlineAt);
  if (Number.isNaN(deadline.getTime())) return "border";

  const dayMs = 24 * 60 * 60 * 1000;
  const daysUntilDeadline = Math.round((localDayTime(deadline) - localDayTime(new Date())) / dayMs);

  if (daysUntilDeadline <= 0) return "border border-red-500";
  if (daysUntilDeadline <= 2) return "border border-yellow-400";
  return "border";
}

const dialogScrollClass =
  "[scrollbar-width:thin] [scrollbar-color:hsl(var(--muted-foreground)/0.35)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50";

function DroppableColumn({
  status,
  children,
}: {
  status: TodoStatus;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={`min-h-[420px] rounded-lg border bg-muted/20 transition-colors ${
        isOver ? "border-primary bg-primary/5" : ""
      }`}
    >
      {children}
    </section>
  );
}

function TodoCard({
  todo,
  onEdit,
}: {
  todo: Todo;
  onEdit: (todo: Todo) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: todo.id,
    data: { status: todo.status },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg bg-background p-3 shadow-xs cursor-grab active:cursor-grabbing ${deadlineBorderClass(todo)} ${
        isDragging ? "opacity-70 shadow-md" : ""
      }`}
      onDoubleClick={() => onEdit(todo)}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="rounded-sm font-mono text-[11px]">
              {todo.todo_key}
            </Badge>
          </div>
          <p className="mt-2 text-sm font-semibold leading-5">{todo.title}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-3.5" />
          <span>{new Date(todo.deadline_at).toLocaleString()}</span>
        </div>
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        <div className="min-w-0 text-xs text-muted-foreground">
          <div className="truncate">Assignee: {(todo.assignees ?? []).map(userLabel).join(", ")}</div>
        </div>
      </div>
    </div>
  );
}

function TodosListView({
  todos,
  loading,
  tagColorMap,
  onEdit,
  onDelete,
}: {
  todos: Todo[];
  loading: boolean;
  tagColorMap: Map<string, string>;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
}) {
  return (
    <Card className="w-full min-w-0 max-w-full overflow-hidden p-0">
      <div className="w-full max-w-full overflow-x-auto overscroll-x-contain [contain:inline-size]">
        <table className="min-w-[1280px] caption-bottom text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[92px]">ID</TableHead>
              <TableHead className="w-[320px]">Title</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[220px]">Assignees</TableHead>
              <TableHead className="w-[180px]">Deadline</TableHead>
              <TableHead className="w-[180px]">Reminder</TableHead>
              <TableHead className="w-[180px]">Related</TableHead>
              <TableHead className="w-[220px]">Tags</TableHead>
              <TableHead className="w-[96px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {todos.map((todo) => (
              <TableRow
                key={todo.id}
                className="cursor-pointer"
                onDoubleClick={() => onEdit(todo)}
              >
                <TableCell className="align-top">
                  <Badge variant="secondary" className="rounded-sm font-mono text-[11px]">
                    {todo.todo_key}
                  </Badge>
                </TableCell>
                <TableCell className="align-top">
                  <div className="font-medium whitespace-normal">{todo.title}</div>
                  <div className="line-clamp-2 text-xs text-muted-foreground whitespace-normal">
                    {todo.description}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <StatusBadge status={todo.status} />
                </TableCell>
                <TableCell className="align-top">
                  <div className="max-w-[200px] truncate">
                    {(todo.assignees ?? []).map(userLabel).join(", ") || "-"}
                  </div>
                </TableCell>
                <TableCell className="align-top">{formatDateTime(todo.deadline_at)}</TableCell>
                <TableCell className="align-top">{formatDateTime(todo.reminder_at)}</TableCell>
                <TableCell className="align-top">
                  <div className="max-w-[160px] whitespace-normal">
                    {[todo.related_type?.replace("_", " "), todo.related_id].filter(Boolean).join(" ") || "-"}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex max-w-[200px] flex-wrap gap-1">
                    {todo.tags.length ? (
                      todo.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="rounded-sm"
                          style={tagBadgeStyle(tagColorMap.get(tag.toLowerCase()))}
                        >
                          {tag}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onEdit(todo)}>
                      Open
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => onDelete(todo)}>
                      <Trash2 className="size-4" />
                      <span className="sr-only">Delete todo</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!loading && todos.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                  No todos
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </table>
      </div>
    </Card>
  );
}

export default function TodosPage() {
  const { userProfile } = useAuth();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tagDefinitions, setTagDefinitions] = useState<TodoTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [deleteTodo, setDeleteTodo] = useState<Todo | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingTag, setIsSavingTag] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [filters, setFilters] = useState<TodosFilters>({});
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [viewMode, setViewMode] = useState<TodosViewMode>("kanban");
  const [form, setForm] = useState(emptyForm);
  const [tagForm, setTagForm] = useState(emptyTagForm);
  const [pendingLinkedTodo, setPendingLinkedTodo] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("todo");
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const isAdmin = userProfile?.roles?.name === UserRoles.ADMIN;

  const userOptions: Option[] = useMemo(
    () => users.map((user) => ({ value: user.id, label: userLabel(user) })),
    [users]
  );
  const selectedAssignees = userOptions.filter((option) => form.assigneeIds.includes(option.value));

  const uniqueTags = useMemo(
    () =>
      Array.from(new Set([...todos.flatMap((todo) => todo.tags), ...tagDefinitions.map((tag) => tag.name)]))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [todos, tagDefinitions]
  );

  const tagColorMap = useMemo(
    () => new Map(tagDefinitions.map((tag) => [tag.name.toLowerCase(), tag.color])),
    [tagDefinitions]
  );

  const tagRows = useMemo(
    () =>
      uniqueTags.map((name) => ({
        name,
        definition: tagDefinitions.find((tag) => tag.name.toLowerCase() === name.toLowerCase()),
      })),
    [tagDefinitions, uniqueTags]
  );

  const loadUsers = async () => {
    const allUsers = await usersService.getUsers();
    setUsers(allUsers);
  };

  const loadTags = async () => {
    try {
      const tags = await todosService.listTags();
      setTagDefinitions(tags);
    } catch (error) {
      console.error("Error loading tags:", error);
      toast.error("Failed to load tags");
    }
  };

  const loadTodos = async () => {
    setLoading(true);
    try {
      const response = await todosService.listTodos(filters, 0, 500);
      setTodos(response.todos);
    } catch (error) {
      console.error("Error loading todos:", error);
      toast.error("Failed to load todos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
    void loadTags();
  }, []);

  useEffect(() => {
    void loadTodos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  const openCreateDialog = () => {
    setEditingTodo(null);
    setForm(emptyForm);
    setCommentBody("");
    setDialogOpen(true);
  };

  const openEditDialog = (todo: Todo) => {
    setEditingTodo(todo);
    setForm({
      title: todo.title,
      description: todo.description,
      assigneeIds: todo.assignees?.map((user) => user.id) ?? [],
      tags: todo.tags,
      relatedType: todo.related_type || "none",
      relatedId: todo.related_id || "",
      deadlineAt: toDatetimeLocal(todo.deadline_at),
      reminderAt: toDatetimeLocal(todo.reminder_at),
      status: todo.status,
    });
    setCommentBody("");
    setDialogOpen(true);
  };

  useEffect(() => {
    if (!pendingLinkedTodo || dialogOpen || todos.length === 0) return;
    const linkedTodo = todos.find(
      (todo) =>
        todo.todo_key.toLowerCase() === pendingLinkedTodo.toLowerCase() ||
        todo.id === pendingLinkedTodo
    );
    if (linkedTodo) {
      openEditDialog(linkedTodo);
      setPendingLinkedTodo(null);
    }
  }, [pendingLinkedTodo, dialogOpen, todos]);

  const copyTodoLink = async (todo: Todo) => {
    const link = getTodoLink(todo);
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Todo link copied");
    } catch (error) {
      console.error("Error copying todo link:", error);
      toast.error("Failed to copy link");
    }
  };

  const clearFilters = () => {
    setFilters((current) => ({
      sortBy: current.sortBy,
      sortDirection: current.sortDirection,
    }));
  };

  const resetTagForm = () => {
    setTagForm(emptyTagForm);
  };

  const editTagDefinition = (tag: TodoTag) => {
    setTagForm({
      id: tag.id,
      name: tag.name,
      color: tag.color,
    });
  };

  const saveTagDefinition = async () => {
    if (!tagForm.name.trim()) {
      toast.error("Tag name is required");
      return;
    }

    setIsSavingTag(true);
    try {
      if (tagForm.id) {
        await todosService.updateTag({
          id: tagForm.id,
          name: tagForm.name.trim(),
          color: tagForm.color,
        });
        toast.success("Tag updated");
      } else {
        await todosService.createTag({
          name: tagForm.name.trim(),
          color: tagForm.color,
        });
        toast.success("Tag created");
      }
      resetTagForm();
      await loadTags();
    } catch (error) {
      console.error("Error saving tag:", error);
      toast.error("Failed to save tag");
    } finally {
      setIsSavingTag(false);
    }
  };

  const removeTagDefinition = async (tag: TodoTag) => {
    try {
      await todosService.deleteTag(tag.id);
      if (tagForm.id === tag.id) resetTagForm();
      toast.success("Tag color removed");
      await loadTags();
    } catch (error) {
      console.error("Error deleting tag:", error);
      toast.error("Failed to delete tag");
    }
  };

  const saveTodo = async () => {
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!form.description.trim()) {
      toast.error("Description is required");
      return;
    }
    if (form.assigneeIds.length === 0) {
      toast.error("Select at least one assignee");
      return;
    }
    if (!form.deadlineAt) {
      toast.error("Deadline is required");
      return;
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

    setIsSaving(true);
    try {
      if (editingTodo) {
        await todosService.updateTodo({ ...(payload as TodoUpdateInput), id: editingTodo.id });
        toast.success("Todo updated");
      } else {
        await todosService.createTodo(payload);
        toast.success("Todo created");
      }
      setDialogOpen(false);
      await loadTodos();
    } catch (error) {
      console.error("Error saving todo:", error);
      toast.error("Failed to save todo");
    } finally {
      setIsSaving(false);
    }
  };

  const updateStatus = async (todo: Todo, status: TodoStatus) => {
    if (todo.status === status) return;
    const previousTodos = todos;
    setTodos((current) => current.map((item) => (item.id === todo.id ? { ...item, status } : item)));
    try {
      await todosService.updateTodo({ id: todo.id, status });
      toast.success("Status updated");
      await loadTodos();
    } catch (error) {
      console.error("Error updating status:", error);
      setTodos(previousTodos);
      toast.error("Failed to update status");
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const todo = todos.find((item) => item.id === event.active.id);
    const status = event.over?.id as TodoStatus | undefined;
    if (todo && status && TODO_STATUSES.includes(status)) {
      void updateStatus(todo, status);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTodo) return;
    try {
      await todosService.deleteTodo(deleteTodo.id);
      toast.success("Todo deleted");
      setDeleteTodo(null);
      await loadTodos();
    } catch (error) {
      console.error("Error deleting todo:", error);
      toast.error("Failed to delete todo");
    }
  };

  const addComment = async () => {
    if (!editingTodo || !commentBody.trim()) return;
    try {
      await todosService.addComment(editingTodo.id, commentBody.trim());
      setCommentBody("");
      toast.success("Comment added");
      await loadTodos();
      const refreshed = (await todosService.listTodos(filters, 0, 500)).todos.find(
        (todo) => todo.id === editingTodo.id
      );
      if (refreshed) {
        setEditingTodo(refreshed);
      }
    } catch (error) {
      console.error("Error adding comment:", error);
      toast.error("Failed to add comment");
    }
  };

  const removeComment = async (commentId: string) => {
    if (!editingTodo) return;
    try {
      await todosService.deleteComment(commentId, editingTodo.id);
      toast.success("Comment deleted");
      const response = await todosService.listTodos(filters, 0, 500);
      setTodos(response.todos);
      const refreshed = response.todos.find((todo) => todo.id === editingTodo.id);
      if (refreshed) {
        setEditingTodo(refreshed);
      }
    } catch (error) {
      console.error("Error deleting comment:", error);
      toast.error("Failed to delete comment");
    }
  };

  const todosByStatus = TODO_STATUSES.reduce((acc, status) => {
    acc[status] = todos.filter((todo) => todo.status === status);
    return acc;
  }, {} as Record<TodoStatus, Todo[]>);

  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Todos</h1>
          <p className="text-sm text-muted-foreground">Track portal work by owner, assignee, deadline, and followup.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex h-11 rounded-md border p-1">
            <Button
              type="button"
              size="sm"
              className="h-9"
              variant={viewMode === "kanban" ? "secondary" : "ghost"}
              onClick={() => setViewMode("kanban")}
            >
              <LayoutGrid className="size-4 sm:mr-2" />
              <span className="hidden sm:inline">Kanban</span>
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              onClick={() => setViewMode("list")}
            >
              <List className="size-4 sm:mr-2" />
              <span className="hidden sm:inline">List</span>
            </Button>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-11" onClick={() => setTagsDialogOpen(true)}>
            <Palette className="size-4 sm:mr-2" />
            <span className="hidden sm:inline">Tags</span>
          </Button>
          <Button variant="outline" size="sm" className="h-11" onClick={loadTodos} disabled={loading}>
            <RefreshCw className={`size-4 sm:mr-2 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" className="h-11" onClick={openCreateDialog}>
            <Plus className="size-4 sm:mr-2" />
            <span className="hidden sm:inline">New Todo</span>
          </Button>
        </div>
      </div>

      <Card className="w-full min-w-0 p-4">
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-2"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal className="size-4 sm:mr-2" />
            <span className="hidden sm:inline">Filters</span>
            <ChevronDown className={`ml-1 size-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
          </Button>
          <Button variant="outline" size="sm" onClick={clearFilters}>
            <X className="size-4 sm:mr-2" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        </div>

        <div
          className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-in-out ${
            filtersOpen ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="ID, title, description, or related ID"
                value={filters.search || ""}
                onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select
              value={filters.status || "all"}
              onValueChange={(value) => setFilters((current) => ({ ...current, status: value as TodoStatus | "all" }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {TODO_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {TODO_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Assignee</Label>
            <Select
              value={filters.assigneeId || "all"}
              onValueChange={(value) => setFilters((current) => ({ ...current, assigneeId: value === "all" ? undefined : value }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Assignee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assignees</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {userLabel(user)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isAdmin && (
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">Owner</Label>
              <Select
                value={filters.ownerId || "all"}
                onValueChange={(value) => setFilters((current) => ({ ...current, ownerId: value === "all" ? undefined : value }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Owner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All owners</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {userLabel(user)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Related Type</Label>
            <Select
              value={filters.relatedType || "all"}
              onValueChange={(value) => setFilters((current) => ({ ...current, relatedType: value as TodoRelatedType | "all" }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Related type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All related types</SelectItem>
                {RELATED_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Tags</Label>
            <Select
              value={filters.tag || "all"}
              onValueChange={(value) => setFilters((current) => ({ ...current, tag: value === "all" ? undefined : value }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Tag" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tags</SelectItem>
                {uniqueTags.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Deadline</Label>
            <Input
              type="date"
              value={filters.deadlineDate || ""}
              onChange={(event) => setFilters((current) => ({ ...current, deadlineDate: event.target.value }))}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Reminder</Label>
            <Input
              type="date"
              value={filters.reminderDate || ""}
              onChange={(event) => setFilters((current) => ({ ...current, reminderDate: event.target.value }))}
            />
          </div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="w-full min-w-0 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Sort By</Label>
            <Select
              value={filters.sortBy || "deadline"}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  sortBy: value as TodosFilters["sortBy"],
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deadline">Deadline / due date</SelectItem>
                <SelectItem value="created">Created date</SelectItem>
                <SelectItem value="todoKey">Todo ID</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Sort Order</Label>
            <Select
              value={filters.sortDirection || "asc"}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  sortDirection: value as TodosFilters["sortDirection"],
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sort order" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">Earliest first</SelectItem>
                <SelectItem value="desc">Latest first</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <div className="w-full min-w-0">
        {viewMode === "kanban" ? (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="grid min-w-0 gap-4 xl:grid-cols-5">
              {TODO_STATUSES.map((status) => (
                <DroppableColumn key={status} status={status}>
                  <div className="flex items-center justify-between border-b px-3 py-3">
                    <div className="flex items-center gap-2">
                      {statusIcon(status)}
                      <h2 className="text-sm font-semibold">{TODO_STATUS_LABELS[status]}</h2>
                    </div>
                    <Badge variant="outline">{todosByStatus[status].length}</Badge>
                  </div>
                  <div className="space-y-3 p-3">
                    {todosByStatus[status].map((todo) => (
                      <TodoCard
                        key={todo.id}
                        todo={todo}
                        onEdit={openEditDialog}
                      />
                    ))}
                    {!loading && todosByStatus[status].length === 0 && (
                      <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                        No todos
                      </div>
                    )}
                  </div>
                </DroppableColumn>
              ))}
            </div>
          </DndContext>
        ) : (
          <TodosListView
            todos={todos}
            loading={loading}
            tagColorMap={tagColorMap}
            onEdit={openEditDialog}
            onDelete={setDeleteTodo}
          />
        )}
      </div>

      <Dialog open={tagsDialogOpen} onOpenChange={setTagsDialogOpen}>
        <DialogContent className="grid max-h-[86vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Manage Tags</DialogTitle>
          </DialogHeader>

          <div className={`min-h-0 overflow-y-auto pr-2 ${dialogScrollClass}`}>
          <div className="grid gap-4">
            <div className="grid gap-4 rounded-md border p-4">
              <div className="grid gap-1.5">
                <Label>Tag Name</Label>
                <Input
                  value={tagForm.name}
                  onChange={(event) => setTagForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="priority, client, billing"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Color</Label>
                <div className="grid grid-cols-9 gap-2 sm:grid-cols-18">
                  {MATERIAL_TAG_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`size-7 rounded-full border transition-transform hover:scale-110 ${
                        tagForm.color.toLowerCase() === color.toLowerCase()
                          ? "ring-2 ring-primary ring-offset-2"
                          : ""
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setTagForm((current) => ({ ...current, color }))}
                      aria-label={`Use color ${color}`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" className="h-10" onClick={saveTagDefinition} disabled={isSavingTag}>
                  {tagForm.id ? "Update" : "Add"}
                </Button>
                {tagForm.id && (
                  <Button type="button" size="sm" className="h-10" variant="outline" onClick={resetTagForm} disabled={isSavingTag}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-2">
              {tagRows.length ? (
                tagRows.map(({ name, definition }) => (
                  <div key={name} className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="size-4 shrink-0 rounded-full border"
                        style={{ backgroundColor: definition?.color || "#64748b" }}
                      />
                      <Badge
                        variant="outline"
                        className="rounded-sm"
                        style={tagBadgeStyle(definition?.color)}
                      >
                        {name}
                      </Badge>
                      {!definition && (
                        <span className="text-xs text-muted-foreground">No color assigned</span>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          editTagDefinition(
                            definition || {
                              id: "",
                              name,
                              color: "#64748b",
                            }
                          )
                        }
                      >
                        {definition ? "Edit" : "Color"}
                      </Button>
                      {definition && (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => removeTagDefinition(definition)}
                        >
                          <Trash2 className="size-4" />
                          <span className="sr-only">Delete tag color</span>
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No tags yet.
                </div>
              )}
            </div>
          </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="grid max-h-[86vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-4xl">
          <DialogHeader className="pr-10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {editingTodo && (
                    <Badge variant="secondary" className="rounded-sm font-mono">
                      {editingTodo.todo_key}
                    </Badge>
                  )}
                  {editingTodo && <StatusBadge status={editingTodo.status} />}
                </div>
                <DialogTitle className="text-2xl">{editingTodo ? form.title || "Untitled todo" : "Create Todo"}</DialogTitle>
              </div>
              <div className="flex shrink-0 gap-2 sm:pr-2">
                {editingTodo && (
                  <Button type="button" variant="outline" size="sm" onClick={() => copyTodoLink(editingTodo)}>
                    <Copy className="size-4 sm:mr-2" />
                    <span className="hidden sm:inline">Copy link</span>
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>

          <div className={`min-h-0 overflow-y-auto pr-2 ${dialogScrollClass}`}>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <div className="grid gap-3 rounded-md border p-4">
                <div className="grid gap-1.5">
                  <Label>Title</Label>
                  <Input
                    value={form.title}
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Short todo title"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Description</Label>
                  <Textarea
                    value={form.description}
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="What needs to be done?"
                    className="min-h-32 resize-none"
                  />
                </div>
              </div>

              {editingTodo && (
                <div className="grid gap-3 rounded-md border p-4">
                  <Tabs defaultValue="comments" className="gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label>Activity</Label>
                      <TabsList>
                        <TabsTrigger value="comments">Comments ({editingTodo.comments?.length ?? 0})</TabsTrigger>
                        <TabsTrigger value="updates">Updates ({editingTodo.updates?.length ?? 0})</TabsTrigger>
                      </TabsList>
                    </div>

                    <TabsContent value="comments" className="mt-0 space-y-3">
                      <div className="space-y-2">
                        {editingTodo.comments?.length ? (
                          editingTodo.comments.map((comment) => (
                            <div key={comment.id} className="rounded-md bg-muted/50 p-3">
                              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span>
                                  {userLabel(comment.author)} · {new Date(comment.created_at).toLocaleString()}
                                </span>
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="ghost"
                                  onClick={() => removeComment(comment.id)}
                                >
                                  <Trash2 className="size-3.5" />
                                  <span className="sr-only">Delete comment</span>
                                </Button>
                              </div>
                              <p className="mt-2 text-sm whitespace-pre-wrap">{comment.body}</p>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No comments yet.</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          value={commentBody}
                          onChange={(event) => setCommentBody(event.target.value)}
                          placeholder="Add a comment"
                        />
                        <Button type="button" variant="outline" onClick={addComment} disabled={!commentBody.trim()}>
                          Add
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="updates" className="mt-0 space-y-3">
                      {editingTodo.updates?.length ? (
                        editingTodo.updates.map((update) => (
                          <div key={update.id} className="flex gap-3 rounded-md bg-muted/40 p-3">
                            <div className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                                <span className="font-medium">{userLabel(update.actor)}</span>
                                <span className="text-muted-foreground">{formatUpdateSummary(update)}</span>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {new Date(update.created_at).toLocaleString()}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No updates yet.</p>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </div>

            <div className="grid content-start gap-4">
              <div className="grid gap-3 rounded-md border p-4">
                <div className="grid gap-1.5">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value as TodoStatus }))}>
                    <SelectTrigger className="w-full">
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
                </div>
                <div className="grid gap-1.5">
                  <Label>Assignees</Label>
                  <MultipleSelector
                    value={selectedAssignees}
                    options={userOptions}
                    placeholder="Select assignees"
                    onChange={(options) => setForm((current) => ({ ...current, assigneeIds: options.map((option) => option.value) }))}
                    emptyIndicator={<span className="text-muted-foreground">No users found</span>}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Tags</Label>
                  <MultipleSelector
                    value={form.tags.map((tag) => ({
                      value: tag,
                      label: tag,
                      color: tagColorMap.get(tag.toLowerCase()),
                    }))}
                    options={uniqueTags.map((tag) => ({
                      value: tag,
                      label: tag,
                      color: tagColorMap.get(tag.toLowerCase()),
                    }))}
                    creatable
                    placeholder="Add or select tags"
                    onChange={(options) => setForm((current) => ({ ...current, tags: options.map((option) => option.value) }))}
                    emptyIndicator={<span className="text-muted-foreground">Create a new tag</span>}
                  />
                </div>
              </div>

              <div className="grid gap-3 rounded-md border p-4">
                <div className="grid gap-1.5">
                  <Label>Deadline</Label>
                  <Input
                    type="datetime-local"
                    value={form.deadlineAt}
                    onChange={(event) => setForm((current) => ({ ...current, deadlineAt: event.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Reminder / Followup</Label>
                  <Input
                    type="datetime-local"
                    value={form.reminderAt}
                    onChange={(event) => setForm((current) => ({ ...current, reminderAt: event.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-3 rounded-md border p-4">
                <div className="grid gap-1.5">
                  <Label>Related Type</Label>
                  <Select value={form.relatedType} onValueChange={(value) => setForm((current) => ({ ...current, relatedType: value as TodoRelatedType | "none" }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {RELATED_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Related ID</Label>
                  <Input
                    value={form.relatedId}
                    onChange={(event) => setForm((current) => ({ ...current, relatedId: event.target.value }))}
                    placeholder="AP-123 or WO-1234"
                  />
                </div>
              </div>
            </div>
          </div>
          </div>

          <DialogFooter className="border-t pt-4">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={saveTodo} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Todo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationAlertDialog
        isOpen={Boolean(deleteTodo)}
        onOpenChange={(open) => !open && setDeleteTodo(null)}
        title="Delete Todo"
        description="This will permanently delete the todo and its comments."
        confirmText="Delete"
        variant="destructive"
        icon={<Trash2 className="size-4" />}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
