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
      "border border-slate-950 bg-gradient-to-b from-slate-800 to-slate-950 text-white " +
      "shadow-[0_14px_30px_rgba(2,6,23,0.24),inset_0_1px_0_rgba(255,255,255,0.16)] " +
      "hover:-translate-y-0.5 hover:from-slate-700 hover:to-slate-950 hover:shadow-[0_18px_40px_rgba(2,6,23,0.28),inset_0_1px_0_rgba(255,255,255,0.18)] " +
      "before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-white/30",
    primary:
      "border border-slate-950 bg-gradient-to-b from-slate-800 to-slate-950 text-white " +
      "shadow-[0_14px_30px_rgba(2,6,23,0.24),inset_0_1px_0_rgba(255,255,255,0.16)] " +
      "hover:-translate-y-0.5 hover:from-slate-700 hover:to-slate-950 hover:shadow-[0_18px_40px_rgba(2,6,23,0.28),inset_0_1px_0_rgba(255,255,255,0.18)] " +
      "before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-white/30",
    secondary:
      "border border-white/70 bg-white/[0.72] text-slate-700 backdrop-blur-xl " +
      "shadow-[0_10px_24px_rgba(15,23,42,0.055),inset_0_1px_0_rgba(255,255,255,0.92)] " +
      "hover:-translate-y-0.5 hover:bg-white/90 hover:text-slate-950",
    ghost:
      "border border-transparent bg-transparent text-slate-600 hover:bg-white/[0.58] hover:text-slate-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]",
    outline:
      "border border-white/70 bg-white/[0.50] text-slate-700 backdrop-blur-xl " +
      "shadow-[0_8px_22px_rgba(15,23,42,0.045),inset_0_1px_0_rgba(255,255,255,0.9)] " +
      "hover:-translate-y-0.5 hover:border-white hover:bg-white/[0.82] hover:text-slate-950 hover:shadow-[0_14px_30px_rgba(15,23,42,0.075),inset_0_1px_0_rgba(255,255,255,0.95)]",
    danger:
      "border border-rose-200/80 bg-rose-50/80 text-rose-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] hover:bg-rose-100/90",
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
