import * as React from "react";

import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md px-3 py-2 text-sm border border-stroke bg-container text-ink transition-colors duration-150 placeholder:text-ink-quaternary hover:border-stroke-active focus-visible:border-stroke-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stroke-active disabled:cursor-not-allowed disabled:bg-raised disabled:opacity-60",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
