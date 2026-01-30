import * as React from "react";
import { cn } from "./cn";

export function Badge({ className, tone = "neutral", ...props }: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-white/10 text-zinc-200 border-white/10",
    good: "bg-emerald-400/15 text-emerald-200 border-emerald-400/20",
    warn: "bg-amber-400/15 text-amber-200 border-amber-400/20",
    bad: "bg-red-400/15 text-red-200 border-red-400/20",
  };
  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs", tones[tone], className)}
      {...props}
    />
  );
}
