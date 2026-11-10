import { redirect } from "next/navigation";

/* Finance is a group of pages; /finance (the breadcrumb's link) opens the queue. */
export default function FinanceIndex() {
  redirect("/finance/queue");
}
