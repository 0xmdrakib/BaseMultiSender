import * as React from "react";
import { cn } from "./cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-zinc-100 outline-none " +
            "placeholder:text-zinc-500 focus:border-white/20 focus:ring-2 focus:ring-white/10",
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
          "w-full min-h-[180px] rounded-xl border border-white/10 bg-black/30 p-4 font-mono text-sm text-zinc-100 outline-none " +
            "placeholder:text-zinc-500 focus:border-white/20 focus:ring-2 focus:ring-white/10",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";
