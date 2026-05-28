import { NextRequest, NextResponse } from "next/server";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { emailService } from "@/lib/email-service";
import { Todo, User } from "@/types/types";

type TodoReminderRow = {
  id: string;
  todo_key: string;
  owner_id: string;
  title: string;
  description: string;
  tags: string[] | null;
  related_type: Todo["related_type"];
  related_id: string | null;
  deadline_at: string;
  reminder_at: string | null;
  reminder_sent_at: string | null;
  status: Todo["status"];
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
};

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const headerSecret = req.headers.get("x-cron-secret");
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return headerSecret === secret || bearer === secret;
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = await createAdminServerClient();
    const { data: rows, error } = await admin
      .from("todos")
      .select("*")
      .not("reminder_at", "is", null)
      .is("reminder_sent_at", null)
      .not("status", "in", "(done,canceled)")
      .lte("reminder_at", new Date().toISOString())
      .order("reminder_at", { ascending: true })
      .limit(50);

    if (error) throw new Error(error.message);

    const todos = (rows ?? []) as TodoReminderRow[];
    let sentCount = 0;
    let failedCount = 0;
    const results: Array<{
      todoKey: string;
      title: string;
      recipients: string[];
      status: "sent" | "skipped" | "failed";
      resendResponse?: unknown;
      error?: string;
    }> = [];

    for (const row of todos) {
      const [{ data: owner }, { data: assigneeRows }] = await Promise.all([
        admin
          .from("user_profile")
          .select("id,email,first_name,last_name,full_name")
          .eq("id", row.owner_id)
          .single(),
        admin
          .from("todo_assignees")
          .select("user_profile(id,email,first_name,last_name,full_name)")
          .eq("todo_id", row.id),
      ]);

      const assignees = (assigneeRows ?? [])
        .map((assignee: any) => assignee.user_profile as User | null)
        .filter(Boolean) as User[];
      const recipients = Array.from(
        new Set([owner?.email, ...assignees.map((user) => user.email)].filter(Boolean))
      ) as string[];

      const todo: Todo = {
        id: row.id,
        todo_key: row.todo_key,
        owner_id: row.owner_id,
        title: row.title,
        description: row.description,
        tags: row.tags ?? [],
        related_type: row.related_type,
        related_id: row.related_id,
        deadline_at: row.deadline_at,
        reminder_at: row.reminder_at,
        reminder_sent_at: row.reminder_sent_at,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at ?? undefined,
        completed_at: row.completed_at,
        owner: owner ?? undefined,
        assignees,
      };

      try {
        if (recipients.length > 0) {
          const resendResponse = await emailService.sendTodoReminderEmail(recipients, todo);
          sentCount += recipients.length;
          results.push({
            todoKey: row.todo_key,
            title: row.title,
            recipients,
            status: "sent",
            resendResponse,
          });
        } else {
          results.push({
            todoKey: row.todo_key,
            title: row.title,
            recipients,
            status: "skipped",
          });
        }

        const { error: updateError } = await admin
          .from("todos")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", row.id)
          .is("reminder_sent_at", null);
        if (updateError) throw new Error(updateError.message);
      } catch (error) {
        failedCount += 1;
        results.push({
          todoKey: row.todo_key,
          title: row.title,
          recipients,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`Failed to send reminder for todo ${row.id}:`, error);
      }
    }

    return NextResponse.json({
      data: {
        processedTodos: todos.length,
        sentCount,
        failedCount,
        results,
      },
    }, { status: failedCount > 0 ? 500 : 200 });
  } catch (error) {
    console.error("Todo reminders error:", error);
    return NextResponse.json({ error: "Failed to process reminders" }, { status: 500 });
  }
}
