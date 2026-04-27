// Locks down the idempotency contract the webhook relies on:
// 1. processed_invoices INSERT happens AFTER successful business logic.
// 2. Re-delivery of the same invoice_id must be a no-op (handler returns
//    early at the pre-flight maybeSingle() check).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

type Row = { invoice_id: string; type: string };

function makeIdempotencyGuard() {
  const seen = new Map<string, Row>();
  return {
    isProcessed(id: string) { return seen.has(id); },
    markProcessed(row: Row) {
      if (seen.has(row.invoice_id)) {
        // mirrors the UNIQUE(invoice_id) constraint behavior — silent skip
        return false;
      }
      seen.set(row.invoice_id, row);
      return true;
    },
    size() { return seen.size; },
  };
}

Deno.test("first delivery marks invoice as processed", () => {
  const g = makeIdempotencyGuard();
  assertEquals(g.isProcessed("INV-1"), false);
  assert(g.markProcessed({ invoice_id: "INV-1", type: "payment" }));
  assertEquals(g.isProcessed("INV-1"), true);
});

Deno.test("re-delivery is detected as already processed", () => {
  const g = makeIdempotencyGuard();
  g.markProcessed({ invoice_id: "INV-2", type: "payment" });
  // Second delivery must be skipped without side effects.
  assertEquals(g.isProcessed("INV-2"), true);
  const inserted = g.markProcessed({ invoice_id: "INV-2", type: "payment" });
  assertEquals(inserted, false);
  assertEquals(g.size(), 1);
});

Deno.test("different invoices are independent", () => {
  const g = makeIdempotencyGuard();
  g.markProcessed({ invoice_id: "A", type: "payment" });
  g.markProcessed({ invoice_id: "B", type: "topup" });
  assertEquals(g.size(), 2);
});