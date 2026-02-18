"use client";

import * as React from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?:
      | "default"
      | "outline"
      | "ghost"
      | "link"
      | "destructive"
      | "secondary";
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
    variant?:
      | "default"
      | "outline"
      | "ghost"
      | "link"
      | "destructive"
      | "secondary";
  };
  className?: string;
  iconClass?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  iconClass,
}: EmptyStateProps) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        {icon && (
          <EmptyMedia variant="icon" className={iconClass}>
            {icon}
          </EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {(action || secondaryAction) && (
        <EmptyContent>
          <div className="flex gap-2">
            {action && (
              <Button
                size="sm"
                onClick={action.onClick}
                variant={action.variant || "default"}
              >
                {action.label}
              </Button>
            )}
            {secondaryAction && (
              <Button
                size="sm"
                variant={secondaryAction.variant || "outline"}
                onClick={secondaryAction.onClick}
              >
                {secondaryAction.icon && <>{secondaryAction.icon}</>}
                {secondaryAction.label && (
                  <span className={secondaryAction.icon ? "ml-2" : ""}>
                    {secondaryAction.label}
                  </span>
                )}
              </Button>
            )}
          </div>
        </EmptyContent>
      )}
    </Empty>
  );
}
