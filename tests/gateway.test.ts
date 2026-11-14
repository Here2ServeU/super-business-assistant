import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import { costUsd } from "@/lib/ai/gateway";
import { DraftSchema, SortSchema } from "@/lib/pipeline";
import { BriefSchema } from "@/lib/briefs";

describe("OpenAI gateway", () => {
  it("prices calls from OpenAI's per-1M-token rates, including cached input and dated snapshots", () => {
    expect(costUsd("gpt-6-luna", 1_000_000, 1_000_000)).toBeCloseTo(0.6);
    expect(costUsd("gpt-6.1-sol", 1_000_000, 0, 1_000_000)).toBeCloseTo(0.1);
    expect(costUsd("gpt-6.1-sol-2026-10-01", 0, 1_000_000)).toBeCloseTo(10);
    expect(costUsd("offline-small", 5000, 5000)).toBe(0);
  });
  it("every structured-output schema is accepted by OpenAI's strict JSON-schema format", () => {
    for (const [name, schema] of [["sort", SortSchema], ["draft", DraftSchema], ["brief", BriefSchema]] as const) {
      const f = zodTextFormat(schema, name);
      expect(f.type).toBe("json_schema");
      expect(f.strict).toBe(true);
    }
  });
});
