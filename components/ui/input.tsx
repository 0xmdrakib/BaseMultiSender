import * as React from "react";
import { cn } from "./cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-[18px] border border-white/70 bg-white/[0.66] px-4 py-3 text-sm text-slate-900 backdrop-blur-xl " +
            "shadow-[0_8px_22px_rgba(15,23,42,0.035),inset_0_1px_0_rgba(255,255,255,0.88)] outline-none placeholder:text-slate-400 " +
            "transition-all duration-200 focus:border-white focus:bg-white/[0.84] focus:ring-2 focus:ring-slate-900/[0.075]",
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
          "w-full min-h-[180px] rounded-[20px] border border-white/70 bg-white/[0.66] p-4 font-mono text-sm text-slate-900 backdrop-blur-xl " +
            "shadow-[0_8px_22px_rgba(15,23,42,0.035),inset_0_1px_0_rgba(255,255,255,0.88)] outline-none placeholder:text-slate-400 " +
            "transition-all duration-200 focus:border-white focus:bg-white/[0.84] focus:ring-2 focus:ring-slate-900/[0.075]",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";
