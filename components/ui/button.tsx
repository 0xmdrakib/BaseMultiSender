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
    "inline-flex items-center justify-center gap-2 rounded-2xl font-medium transition-colors duration-150 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0000ff]/30 focus-visible:ring-offset-0 " +
    "disabled:opacity-50 disabled:cursor-not-allowed";

  const variants: Record<string, string> = {
    // Primary action uses Base Blue (#0000FF) with a restrained glow.
    default:
      "bg-[#0000ff] text-white hover:bg-[#0000ff]/90 border border-[#0000ff]/35 shadow-[0_14px_55px_-30px_rgba(0,0,255,0.9)]",
    primary:
      "bg-[#0000ff] text-white hover:bg-[#0000ff]/90 border border-[#0000ff]/35 shadow-[0_14px_55px_-30px_rgba(0,0,255,0.9)]",
    secondary:
      "bg-white/[0.06] text-white/90 hover:bg-white/[0.09] border border-white/10",
    ghost:
      "bg-transparent text-white/80 hover:bg-white/[0.06] border border-transparent",
    outline:
      "bg-transparent text-white/85 hover:bg-white/[0.06] border border-white/15",
    danger:
      "bg-rose-500/15 text-rose-100 hover:bg-rose-500/20 border border-rose-500/20",
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
