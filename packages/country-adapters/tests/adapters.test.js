import { describe, it, expect } from "vitest";
import { nzProfile } from "../src/index.js";
import { MarketProfileSchema } from "@mortgage/schemas";

describe("Country Adapters Tests", () => {
  it("should validate the NZ profile against the MarketProfile Zod schema", () => {
    const parsed = MarketProfileSchema.safeParse(nzProfile);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      console.error(parsed.error);
    }
  });
});
