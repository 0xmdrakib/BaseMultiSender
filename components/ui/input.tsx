import * as React from "react";
import { cn } from "./cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-[18px] border border-slate-200/90 bg-slate-50/[0.68] px-4 py-3 text-sm text-slate-900 backdrop-blur-xl " +
            "shadow-[inset_0_2px_5px_rgba(15,23,42,0.045),inset_0_-1px_0_rgba(255,255,255,0.94)] outline-none placeholder:text-slate-400 " +
            "transition-all duration-200 focus:border-blue-300/65 focus:bg-white/[0.90] focus:ring-2 focus:ring-blue-500/[0.09]",
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
          "w-full min-h-[180px] rounded-[20px] border border-slate-200/90 bg-slate-50/[0.68] p-4 font-mono text-sm text-slate-900 backdrop-blur-xl " +
            "shadow-[inset_0_2px_5px_rgba(15,23,42,0.045),inset_0_-1px_0_rgba(255,255,255,0.94)] outline-none placeholder:text-slate-400 " +
            "transition-all duration-200 focus:border-blue-300/65 focus:bg-white/[0.90] focus:ring-2 focus:ring-blue-500/[0.09]",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";
