import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Mirror of all callback_data strings used by the auto-products module.
// Telegram hard-limits inline_keyboard callback_data to 64 bytes.
const callbacks: string[] = [
  // entry + nav
  "a:ap",
  "a:ap:v:s",
  "a:ap:v:p",
  "a:ap:t:s",
  "a:ap:t:p",
  // stars edits
  "a:ap:e:s:title",
  "a:ap:e:s:price",
  "a:ap:e:s:min",
  "a:ap:e:s:max",
  // premium edits
  "a:ap:e:p:title",
  "a:ap:pn",
  // worst-case delete index (term_options can hold dozens; 3 digits is safe)
  "a:ap:pd:999",
];

Deno.test("auto_products: every callback_data stays within 64 bytes", () => {
  for (const cb of callbacks) {
    const bytes = new TextEncoder().encode(cb).length;
    assertEquals(bytes <= 64, true, `callback too long (${bytes}b): ${cb}`);
  }
});

Deno.test("auto_products: callback prefixes are namespaced under a:ap", () => {
  for (const cb of callbacks) {
    assertEquals(cb.startsWith("a:ap"), true, `wrong namespace: ${cb}`);
  }
});

// FSM state strings written by the module. Index.ts splits on ':' into
// [scope, verb, a, b]. Verify that split layout matches what the router expects.
Deno.test("auto_products: edit FSM states parse correctly", () => {
  const states = [
    "ap:e:s:title", "ap:e:s:price", "ap:e:s:min", "ap:e:s:max",
    "ap:e:p:title",
  ];
  for (const s of states) {
    const [scope, verb, a, b] = s.split(":");
    assertEquals(scope, "ap");
    assertEquals(verb, "e");
    assertEquals(a === "s" || a === "p", true);
    assertEquals(typeof b === "string" && b.length > 0, true);
  }
});

Deno.test("auto_products: new-premium-term FSM states parse correctly", () => {
  for (const s of ["ap:pn:m", "ap:pn:p"]) {
    const [scope, verb, a] = s.split(":");
    assertEquals(scope, "ap");
    assertEquals(verb, "pn");
    assertEquals(a === "m" || a === "p", true);
  }
});
