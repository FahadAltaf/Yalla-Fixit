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
  ArrowUpDown,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CirclePause,
  Clock,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmationAlertDialog } from "@/components/ui/confirmation-alert-dialog";
import StatusBadge from "@/components/ui/status-badge";
import DateFilter from "./date-filter";
import { useAuth } from "@/context/AuthContext";
import {
  canDeleteTodoRecord,
  canEditTodoRecord,
  hasAllRecordsAccess,
  hasResourceAction,
  isAdminUser,
} from "@/lib/role-permissions";
import { usersService } from "@/modules/users/services/users-service";
import { MentionableUser, TodosFilters, todosService } from "@/modules/todos";
import { TodoDialog } from "./todo-dialog";
import { RELATED_TYPES, TODO_STATUSES, formatDateTime, tagBadgeStyle, userLabel } from "./todo-helpers";
import {
  TODO_STATUS_LABELS,
  ActionType,
  ResourceType,
  Todo,
  TodoRelatedType,
  TodoStatus,
  TodoTag,
  User,
} from "@/types/types";

type TodosViewMode = "kanban" | "list";

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

function getTodoLink(todo: Todo) {
  if (typeof window === "undefined") return `/todos?todo=${encodeURIComponent(todo.todo_key)}`;
  return `${window.location.origin}/todos?todo=${encodeURIComponent(todo.todo_key)}`;
}

function statusIcon(status: TodoStatus) {
  if (status === "done") return <CheckCircle2 className="size-4 text-success" />;
  if (status === "blocked") return <CircleAlert className="size-4 text-warning" />;
  // Canceled is closed, not broken -- neutral slate keeps it from competing
  // with Blocked for attention. The CirclePause icon still tells it apart
  // from To-do, so this does not lean on colour alone.
  if (status === "canceled") return <CirclePause className="size-4 text-muted-foreground/70" />;
  if (status === "in_progress") return <Clock className="size-4 text-warning" />;
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

  if (daysUntilDeadline <= 0) return "border-danger border";
  if (daysUntilDeadline <= 2) return "border-warning border";
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
      className={`flex min-h-[420px] flex-col rounded-lg border bg-muted/20 transition-colors ${isOver ? "border-primary bg-primary/5" : ""
        }`}
    >
      {children}
    </section>
  );
}

function TodoCard({
  todo,
  onEdit,
  canDrag,
}: {
  todo: Todo;
  onEdit: (todo: Todo) => void;
  canDrag: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: todo.id,
    data: { status: todo.status },
    disabled: !canDrag,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg bg-background p-3 shadow-xs ${canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${deadlineBorderClass(todo)} ${isDragging ? "opacity-70 shadow-md" : ""
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
  canDeleteTodo,
}: {
  todos: Todo[];
  loading: boolean;
  tagColorMap: Map<string, string>;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  canDeleteTodo: (todo: Todo) => boolean;
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
                    {canDeleteTodo(todo) && (
                      <Button size="icon-sm" variant="ghost" onClick={() => onDelete(todo)}>
                        <Trash2 className="size-4" />
                        <span className="sr-only">Delete todo</span>
                      </Button>
                    )}
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
  const [isSavingTag, setIsSavingTag] = useState(false);
  // FR-17: who can be @-mentioned in a comment.
  const [mentionableUsers, setMentionableUsers] = useState<MentionableUser[]>([]);
  // The column a quick-add started from, so the new todo lands there.
  const [createStatus, setCreateStatus] = useState<TodoStatus | undefined>(undefined);
  const [filters, setFilters] = useState<TodosFilters>({});
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [viewMode, setViewMode] = useState<TodosViewMode>("kanban");
  const [tagForm, setTagForm] = useState(emptyTagForm);
  const [pendingLinkedTodo, setPendingLinkedTodo] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("todo");
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const userId = userProfile?.id ?? "";
  const isAdmin = isAdminUser(userProfile);
  const canCreate = hasResourceAction(userProfile, ResourceType.TODOS, ActionType.CREATE);
  const canEdit = hasResourceAction(userProfile, ResourceType.TODOS, ActionType.EDIT);
  const canDelete = hasResourceAction(userProfile, ResourceType.TODOS, ActionType.DELETE);
  const canViewAllRecords = isAdmin || hasAllRecordsAccess(userProfile, ResourceType.TODOS);

  const canEditTodo = (todo: Todo) => canEditTodoRecord(userProfile, todo, userId);
  const canDeleteTodo = (todo: Todo) => canDeleteTodoRecord(userProfile, todo, userId);
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
    try {
      setMentionableUsers(await todosService.listMentionableUsers());
    } catch (error) {
      console.error("Error loading mentionable users:", error);
    }
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

  // `status` is passed by a column's quick-add so the new todo lands in the
  // column it was started from; the header button omits it and gets the
  // default.
  const openCreateDialog = (status?: TodoStatus) => {
    if (!canCreate) {
      toast.error("You do not have permission to create todos");
      return;
    }
    setEditingTodo(null);
    setCreateStatus(status);
    setDialogOpen(true);
  };

  const openEditDialog = (todo: Todo) => {
    setEditingTodo(todo);
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

  // Sort is not a filter, so an empty board that is merely sorted should
  // still read as "nothing here yet" rather than "nothing matched".
  const hasActiveFilters = useMemo(
    () =>
      Object.entries(filters).some(
        ([key, value]) =>
          key !== "sortBy" &&
          key !== "sortDirection" &&
          value !== undefined &&
          value !== "" &&
          value !== "all",
      ),
    [filters],
  );

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
    if (!canEdit) {
      toast.error("You do not have permission to manage tags");
      return;
    }
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
    if (!canDelete) {
      toast.error("You do not have permission to delete tags");
      return;
    }
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

  const updateStatus = async (todo: Todo, status: TodoStatus) => {
    if (!canEditTodo(todo)) {
      toast.error("You do not have permission to update this todo");
      return;
    }
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
    if (!canDeleteTodo(deleteTodo)) {
      toast.error("You do not have permission to delete this todo");
      setDeleteTodo(null);
      return;
    }
    try {
      await todosService.deleteTodo(deleteTodo.id);
      toast.success("Todo deleted");
      setDeleteTodo(null);
      setDialogOpen(false);
      await loadTodos();
    } catch (error) {
      console.error("Error deleting todo:", error);
      toast.error("Failed to delete todo");
    }
  };

  // Reloads the list and the open dialog together, so tab counts and the
  // Updates log follow an upload, a delete or a comment change.
  const refreshEditingTodo = async () => {
    if (editingTodo) {
      // The open todo first, on its own, so the dialog updates at once; the
      // board follows in the background.
      const refreshed = await todosService.getTodo(editingTodo.id);
      if (refreshed) {
        setEditingTodo(refreshed);
        setTodos((current) => current.map((todo) => (todo.id === refreshed.id ? refreshed : todo)));
      }
      void loadTodos();
      return;
    }
    await loadTodos();
  };

  const todosByStatus = TODO_STATUSES.reduce((acc, status) => {
    acc[status] = todos.filter((todo) => todo.status === status);
    return acc;
  }, {} as Record<TodoStatus, Todo[]>);

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {/* Header, toolbar and filters follow the Daily schedule layout: a
          plain heading block, one flowing toolbar row, and a small text
          toggle over an uncarded filter grid -- rather than a heading with
          the whole toolbar crammed into its right-hand actions slot and the
          filters boxed in a Card. */}
      <div>
        <p className="eyebrow">Work management</p>
        <h1 className="mt-1.5 text-3xl">Todos</h1>
        <p className="text-muted-foreground mt-1 text-[0.9375rem]">
          Track portal work by owner, assignee, deadline, and follow-up.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: what you are looking at, and how it is arranged. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border p-1">
            <Button
              type="button"
              size="sm"
              variant={viewMode === "kanban" ? "secondary" : "ghost"}
              onClick={() => setViewMode("kanban")}
            >
              <LayoutGrid className="size-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Kanban</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              onClick={() => setViewMode("list")}
            >
              <List className="size-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">List</span>
            </Button>
          </div>

          <Select
            value={filters.sortBy || "deadline"}
            onValueChange={(value) =>
              setFilters((current) => ({ ...current, sortBy: value as TodosFilters["sortBy"] }))
            }
          >
            <SelectTrigger size="sm" className="w-[188px] rounded-full" aria-label="Sort by">
              <ArrowUpDown className="size-3.5 shrink-0" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="deadline">Deadline / due date</SelectItem>
              <SelectItem value="created">Created date</SelectItem>
              <SelectItem value="todoKey">Todo ID</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filters.sortDirection || "asc"}
            onValueChange={(value) =>
              setFilters((current) => ({ ...current, sortDirection: value as TodosFilters["sortDirection"] }))
            }
          >
            <SelectTrigger size="sm" className="w-[148px] rounded-full" aria-label="Sort order">
              <SelectValue placeholder="Sort order" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">Earliest first</SelectItem>
              <SelectItem value="desc">Latest first</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Right: utilities, then the one primary action. */}
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Button type="button" variant="outline" size="sm" onClick={() => setTagsDialogOpen(true)}>
              <Palette className="size-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Tags</span>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={loadTodos} disabled={loading}>
            <RefreshCw className={`size-3.5 sm:mr-1.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          {canCreate && (
            <Button size="sm" onClick={() => openCreateDialog()}>
              <Plus className="size-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">New Todo</span>
            </Button>
          )}
        </div>
      </div>

      {/* The whole search + filter area collapses behind a text toggle, as
          on the schedule board. Clear only appears when there is something
          to clear. */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs font-medium"
        >
          <SlidersHorizontal className="size-3.5" />
          Search &amp; filters
          {filtersOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="size-3.5" />
            Clear
          </Button>
        )}
      </div>

      <div className={`flex flex-col gap-2 ${filtersOpen ? "" : "hidden"}`}>
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
        {canViewAllRecords && (
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
          <DateFilter
            ariaLabel="Filter by deadline"
            value={filters.deadlineDate || ""}
            onChange={(value) => setFilters((current) => ({ ...current, deadlineDate: value }))}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">Reminder</Label>
          <DateFilter
            ariaLabel="Filter by reminder"
            value={filters.reminderDate || ""}
            onChange={(value) => setFilters((current) => ({ ...current, reminderDate: value }))}
          />
        </div>
        </div>
      </div>

      <div className="w-full min-w-0">
        {viewMode === "kanban" && !loading && todos.length === 0 ? (
          // With nothing on the board at all, five identical "No todos"
          // placeholders say the same thing five times and bury the one
          // action that helps. Show it once, with the way out.
          <Card className="flex min-h-[420px] w-full min-w-0 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
              <ListTodo className="size-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">
                {hasActiveFilters ? "No todos match these filters" : "No todos yet"}
              </h2>
              <p className="text-muted-foreground text-sm">
                {hasActiveFilters
                  ? "Try widening or clearing the filters to see more."
                  : "Create the first one and it will show up in the To-do column."}
              </p>
            </div>
            {hasActiveFilters ? (
              <Button variant="outline" onClick={clearFilters}>
                <X className="size-4" />
                Clear filters
              </Button>
            ) : (
              canCreate && (
                <Button onClick={() => openCreateDialog()}>
                  <Plus className="size-4" />
                  New Todo
                </Button>
              )
            )}
          </Card>
        ) : viewMode === "kanban" ? (
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

                  {/* flex-1 on the card area lets an empty column centre its
                      placeholder instead of pinning it to the top of a tall
                      blank box, and keeps quick-add at the bottom either way. */}
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex-1 space-y-3 p-3">
                      {todosByStatus[status].map((todo) => (
                        <TodoCard
                          key={todo.id}
                          todo={todo}
                          onEdit={openEditDialog}
                          canDrag={canEditTodo(todo)}
                        />
                      ))}
                      {!loading && todosByStatus[status].length === 0 && (
                        <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 py-6 text-center">
                          {statusIcon(status)}
                          <span className="text-sm">No todos</span>
                        </div>
                      )}
                    </div>

                    {canCreate && (
                      <div className="p-2 pt-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-foreground w-full justify-start"
                          onClick={() => openCreateDialog(status)}
                        >
                          <Plus className="size-3.5" />
                          Add task
                        </Button>
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
            canDeleteTodo={canDeleteTodo}
          />
        )}
      </div>

      <Dialog open={tagsDialogOpen} onOpenChange={setTagsDialogOpen}>
        <DialogContent className="grid max-h-[86vh] w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage Tags</DialogTitle>
            <DialogDescription>
              Tags are shared across every todo. Renaming a colour here updates it everywhere the tag appears.
            </DialogDescription>
          </DialogHeader>

          <div className={`min-h-0 overflow-y-auto pr-2 ${dialogScrollClass}`}>
            <div className="grid gap-4">
              <div className="grid gap-4 rounded-md border p-4">
                <div className="grid gap-1.5">
                  <Label>Tag Name</Label>
                  <Input
                    value={tagForm.name}
                    onChange={(event) => setTagForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="e.g. priority"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Color</Label>
                  {/* `sm:grid-cols-18` is not a real utility, so the row was
                      relying on the 4xl dialog width to fit. A wrapping flex
                      row holds any number of swatches at any dialog width. */}
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tag colour">
                    {MATERIAL_TAG_COLORS.map((color) => {
                      const selected = tagForm.color.toLowerCase() === color.toLowerCase();
                      return (
                        <button
                          key={color}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={`flex size-7 items-center justify-center rounded-full border transition-transform hover:scale-110 ${
                            selected ? "ring-primary ring-2 ring-offset-2" : ""
                          }`}
                          style={{ backgroundColor: color }}
                          onClick={() => setTagForm((current) => ({ ...current, color }))}
                          aria-label={`Use color ${color}`}
                        >
                          {/* A ring alone is easy to miss against a saturated
                              fill; the tick says which one is chosen. */}
                          {selected && <Check className="size-3.5 text-white drop-shadow" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canEdit && (
                    <Button type="button" onClick={saveTagDefinition} disabled={isSavingTag}>
                      {tagForm.id ? "Update" : "Add"}
                    </Button>
                  )}
                  {tagForm.id && (
                    <Button type="button" variant="outline" onClick={resetTagForm} disabled={isSavingTag}>
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
                        {definition && canDelete && (
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

      {dialogOpen && (
        <TodoDialog
          todo={editingTodo}
          initialStatus={createStatus}
          users={users}
          mentionableUsers={mentionableUsers}
          tagOptions={uniqueTags.map((tag) => ({ value: tag, label: tag, color: tagColorMap.get(tag.toLowerCase()) }))}
          tagColorMap={tagColorMap}
          userProfile={userProfile}
          userId={userId}
          isAdmin={isAdmin}
          canViewAllRecords={canViewAllRecords}
          onClose={() => setDialogOpen(false)}
          onRefresh={refreshEditingTodo}
          onDelete={(todo) => setDeleteTodo(todo)}
          onCopyLink={copyTodoLink}
        />
      )}

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
