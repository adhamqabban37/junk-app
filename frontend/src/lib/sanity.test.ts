import { describe, expect, it } from "vitest";
import { sum } from "./sanity";

describe("sanity", () => {
  it("adds two numbers", () => {
    expect(sum(2, 3)).toBe(5);
  });
});
