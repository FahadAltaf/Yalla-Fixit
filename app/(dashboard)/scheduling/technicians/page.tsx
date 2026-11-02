import { redirect } from "next/navigation";

// Technicians & leave moved to Workforce → People (C6, 13-7 decision 3).
// "In FSM" is the same list this page showed.
export default function TechniciansPage() {
  redirect("/workforce?scope=fsm");
}
