import React from "react";
import { Badge } from "./badge";
import { cn } from "@/lib/actions/utils";

const StatusBadge = ({ status }: { status: string }) => {
  // Map status to appropriate style
  const getStatusStyle = (status: string) => {
    const normalizedStatus = status.toLowerCase().replace(/_/g, "-");

    // Success/Active/Approved states
    if (
      [
        "publish",
        "resolved",
        "closed",
        "approved",
        "completed",
        "serviced",
        "paid",
        "valid",
        "active",
        "accepted",
      ].includes(normalizedStatus)
    ) {
      return "bg-green-600/10 text-green-600 focus-visible:ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:focus-visible:ring-green-400/40 [a&]:hover:bg-green-600/5 dark:[a&]:hover:bg-green-400/5";
    }

    // Warning/Pending states
    if (
      [
        "scheduled",
        "pending",
        "in-progress",
        "processing",
        "expiring-soon",
        "draft",
        "busy",
      ].includes(normalizedStatus)
    ) {
      return "bg-amber-600/10 text-amber-600 focus-visible:ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-400 dark:focus-visible:ring-amber-400/40 [a&]:hover:bg-amber-600/5 dark:[a&]:hover:bg-amber-400/5";
    }

    // Error/Destructive states
    if (
      [
        "inactive",
        "rejected",
        "overdue",
        "expired",
        "maintenance",
        "closed",
        "no-answer",
        "no_answer",
        "high",
      ].includes(normalizedStatus)
    ) {
      return "bg-destructive/10 [a&]:hover:bg-destructive/5 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive";
    }

    // Default/Neutral states
    if (
      [
        "open",
        "available",
        "occupied",
        "secondary",
        "default",
        "inbound",
        "outbound",
        "positive",
        "negative",
        "neutral",
        "low",
      ].includes(normalizedStatus)
    ) {
      return "bg-muted text-muted-foreground";
    }

    // Default fallback
    return "bg-muted text-muted-foreground";
  };

  const statusStyles = getStatusStyle(status);

  return (
    <Badge
      className={cn(
        "rounded-sm border-none capitalize focus-visible:outline-none text-xs",
        statusStyles
      )}
    >
      {status.replace(/_/g, " ")}
    </Badge>
  );
};

export default StatusBadge;
