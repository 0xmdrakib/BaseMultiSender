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
    <div className="overflow-hidden rounded-2xl border border-white/10">
      <div className="grid grid-cols-12 gap-0 bg-white/5 px-4 py-3 text-xs text-zinc-300">
        <div className="col-span-1">#</div>
        <div className="col-span-5">Recipient</div>
        <div className="col-span-3">Amount</div>
        <div className="col-span-3">Status</div>
      </div>
      <div className="max-h-[360px] overflow-auto">
        {rows.map((r) => (
          <div
            key={r.index}
            className={cn(
              "grid grid-cols-12 gap-0 px-4 py-3 text-sm border-t border-white/10",
              r.status === "failed" ? "bg-red-500/5" : "bg-transparent"
            )}
          >
            <div className="col-span-1 text-zinc-400">{r.index}</div>
            <div className="col-span-5 font-mono text-xs break-all">{r.to}</div>
            <div className="col-span-3 text-zinc-200">{r.amount}</div>
            <div className="col-span-3 flex items-center gap-2">
              <Badge tone={r.status === "success" ? "good" : "bad"}>
                {r.status === "success" ? "Success" : "Failed"}
              </Badge>
              {r.reason ? <span className="text-xs text-zinc-400 truncate">{r.reason}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
