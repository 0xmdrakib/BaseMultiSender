"use client";

import { Badge } from "./ui/badge";
import { cn } from "./ui/cn";

export type ReceiptRow = {
  index: number;
  to: string;
  amount: string;
  status: "success" | "failed";
  reason?: string;
};

export function ReceiptTable({ rows }: { rows: ReceiptRow[] }) {
  if (!rows.length) return null;

  return (
    <div className="overflow-hidden rounded-[24px] border border-white/70 bg-white/[0.58] shadow-[0_14px_34px_rgba(15,23,42,0.055),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-2xl">
      <div className="grid grid-cols-12 gap-0 border-b border-white/60 bg-white/[0.48] px-4 py-3 text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
        <div className="col-span-1">#</div>
        <div className="col-span-5">Recipient</div>
        <div className="col-span-3">Amount</div>
        <div className="col-span-3">Status</div>
      </div>
      <div className="max-h-[360px] overflow-auto scrollbar-dark">
        {rows.map((r) => (
          <div
            key={r.index}
            className={cn(
              "grid grid-cols-12 gap-0 px-4 py-3 text-sm transition-colors",
              r.status === "failed" ? "bg-rose-50/70" : "border-t border-slate-200/60 bg-transparent hover:bg-white/[0.42]"
            )}
          >
            <div className="col-span-1 text-slate-400">{r.index}</div>
            <div className="col-span-5 font-mono text-xs break-all text-slate-700">{r.to}</div>
            <div className="col-span-3 text-slate-700">{r.amount}</div>
            <div className="col-span-3 flex items-center gap-2">
              <Badge tone={r.status === "success" ? "good" : "bad"}>
                {r.status === "success" ? "Success" : "Failed"}
              </Badge>
              {r.reason ? <span className="text-xs text-slate-500 truncate">{r.reason}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
