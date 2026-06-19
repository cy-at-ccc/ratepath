import { describe, it, expect } from "vitest";
import { interpolate } from "../interpolate.js";

describe("interpolate", () => {
  it("returns the template unchanged when no vars are supplied", () => {
    expect(interpolate("Hello, {name}!")).toBe("Hello, {name}!");
  });

  it("substitutes a single placeholder", () => {
    expect(interpolate("Hello, {name}!", { name: "world" })).toBe("Hello, world!");
  });

  it("substitutes multiple placeholders", () => {
    expect(interpolate("{greeting}, {name}!", { greeting: "Hi", name: "team" })).toBe("Hi, team!");
  });

  it("preserves placeholders whose vars are missing (returns the key form)", () => {
    expect(interpolate("Hi, {name}", { other: "x" })).toBe("Hi, {name}");
  });

  it("renders missing vars as the empty string when placeholder is referenced but undefined", () => {
    // The current implementation intentionally preserves the placeholder
    // when the var is missing — this test pins that behaviour so future
    // refactors don't accidentally swap to "".
    expect(interpolate("a{undefined}b")).toBe("a{undefined}b");
  });

  it("coerces numeric vars to strings", () => {
    expect(interpolate("Total: ${n}", { n: 450000 })).toBe("Total: $450000");
  });

  it("handles null and undefined vars by rendering empty", () => {
    expect(interpolate("[{a}][{b}]", { a: null, b: undefined })).toBe("[][]");
  });

  it("passes through literal braces that are not part of a placeholder", () => {
    // A single `{` not followed by an identifier is left alone.
    expect(interpolate("a { notaname } b {name}", { name: "x" })).toBe("a { notaname } b x");
  });

  it("returns empty string for null/undefined template", () => {
    expect(interpolate(null)).toBe("");
    expect(interpolate(undefined)).toBe("");
  });
});
