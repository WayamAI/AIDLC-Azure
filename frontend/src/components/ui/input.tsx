import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md px-3 py-1.5 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink border border-stroke bg-container text-ink transition-colors duration-150 placeholder:text-ink-quaternary hover:border-stroke-active focus-visible:border-stroke-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stroke-active disabled:cursor-not-allowed disabled:bg-raised disabled:opacity-60",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
