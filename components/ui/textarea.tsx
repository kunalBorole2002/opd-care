import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "min-h-24 w-full resize-none rounded-[13px] border bg-white px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-slate-300 focus:border-primary focus:ring-2 focus:ring-primary/15",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = "Textarea";
