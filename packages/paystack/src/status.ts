import type { VerifyResult } from "./types";

export function transactionStatus(status: string): VerifyResult["status"] {
  if (status === "success") return "paid";
  if (["failed", "abandoned", "reversed"].includes(status)) return "failed";

  return "pending";
}
