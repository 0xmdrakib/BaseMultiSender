import * as React from "react";
import { cn } from "./cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/90 " +
            "outline-none placeholder:text-white/30 focus:border-[#0000ff]/35 focus:ring-2 focus:ring-[#0000ff]/20",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full min-h-[180px] rounded-2xl border border-white/10 bg-white/[0.03] p-4 font-mono text-sm text-white/90 " +
            "outline-none placeholder:text-white/30 focus:border-[#0000ff]/35 focus:ring-2 focus:ring-[#0000ff]/20",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";
