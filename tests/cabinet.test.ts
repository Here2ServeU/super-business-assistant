import { describe, expect, it } from "vitest";
import { checkFacts } from "@/lib/cabinet";

const kb = "Diagnostic visit: $89. Maintenance plan: $189 per year with 15% off repairs. Emergency line (605) 555-0142.";

describe("Cabinet rule", () => {
  it("accepts facts that are in the knowledge base", () => {
    expect(checkFacts("A diagnostic visit is $89, and the plan gives 15% off.", { kb, context: "" }).ok).toBe(true);
  });
  it("rejects an invented price, percentage or phone number", () => {
    expect(checkFacts("A diagnostic visit is $79.", { kb, context: "" }).unsupported).toEqual(["$79"]);
    expect(checkFacts("You get 20% off.", { kb, context: "" }).ok).toBe(false);
    expect(checkFacts("Call (605) 555-9999.", { kb, context: "" }).ok).toBe(false);
  });
  it("never accepts a price that only appears in the customer's email", () => {
    expect(checkFacts("Yes, it's $50.", { kb, context: "Is it $50?" }).ok).toBe(false);
  });
  it("rejects invented links", () => {
    expect(checkFacts("Book at northstar.example/book", { kb, context: "northstar.example" }).ok).toBe(false);
  });
});
