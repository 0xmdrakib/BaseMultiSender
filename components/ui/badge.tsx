import * as React from "react";
import { cn } from "./cn";

export function Badge({ className, tone = "neutral", ...props }: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const tones: Record<string, string> = {
    neutral: "border-white/70 bg-white/[0.58] text-slate-600",
    good: "border-emerald-200/80 bg-emerald-50/80 text-emerald-700",
    warn: "border-amber-200/80 bg-amber-50/80 text-amber-700",
    bad: "border-rose-200/80 bg-rose-50/80 text-rose-700",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium shadow-none",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}
