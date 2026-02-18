import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import React from "react";

const Loader = ({ className }: { className?: string }) => {
  return (
    <div
      className={cn(
        "flex items-center justify-center py-8 h-[calc(100vh-200px)]",
        className
      )}
    >
      <Loader2 className="w-10 h-10 animate-spin" />
    </div>
  );
};

export default Loader;
