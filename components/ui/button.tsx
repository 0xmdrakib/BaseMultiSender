import * as React from "react";
import { cn } from "./cn";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  // Keep this in sync with usage across the app.
  // "outline" is used for bordered actions (Upload / Reset / Explorer etc.).
  variant?: "primary" | "secondary" | "ghost" | "outline" | "danger";
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
    "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition " +
    "focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-50 disabled:cursor-not-allowed";

  const variants: Record<string, string> = {
    primary: "bg-white text-black hover:bg-zinc-200",
    secondary: "bg-white/10 text-zinc-100 hover:bg-white/15 border border-white/10",
    ghost: "bg-transparent hover:bg-white/10 border border-transparent",
    outline:
      "bg-transparent text-zinc-100 hover:bg-white/10 border border-white/15",
    danger: "bg-red-500/15 text-red-100 hover:bg-red-500/20 border border-red-500/20",
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
