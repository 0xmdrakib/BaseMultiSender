import * as React from "react";
import { cn } from "./cn";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  // Keep this in sync with usage across the app.
  // "outline" is used for bordered actions (Upload / Reset / Explorer etc.).
  // "default" is a common shadcn/ui variant name; we alias it to our "primary".
  variant?: "primary" | "secondary" | "ghost" | "outline" | "danger" | "default";
  size?: "sm" | "md";
};

export function Button({
  className,
  variant = "secondary",
  size = "md",
  disabled,
  ...props
}: Props) {
  const base =
    "group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full font-semibold tracking-[-0.01em] " +
    "transition-all duration-200 ease-out active:scale-[0.985] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/[0.12] focus-visible:ring-offset-0 " +
    "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:translate-y-0";

  const variants: Record<string, string> = {
    default:
      "border border-slate-950 bg-slate-950 text-white shadow-none hover:-translate-y-0.5 hover:bg-slate-800",
    primary:
      "border border-slate-950 bg-slate-950 text-white shadow-none hover:-translate-y-0.5 hover:bg-slate-800",
    secondary:
      "border border-slate-200/85 bg-white text-slate-700 shadow-none " +
      "hover:-translate-y-0.5 hover:border-slate-300/80 hover:bg-white/95 hover:text-slate-950",
    ghost:
      "border border-transparent bg-transparent text-slate-600 shadow-none hover:bg-slate-50 hover:text-slate-950",
    outline:
      "border border-slate-200/85 bg-white text-slate-700 shadow-none hover:-translate-y-0.5 hover:border-slate-300/85 hover:bg-slate-50 hover:text-slate-950",
    danger:
      "border border-rose-200/80 bg-rose-50 text-rose-700 shadow-none hover:bg-rose-100",
  };

  const sizes: Record<string, string> = {
    sm: "px-3 py-2 text-sm",
    md: "px-4 py-2.5 text-sm",
  };

  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled}
      {...props}
    />
  );
}
