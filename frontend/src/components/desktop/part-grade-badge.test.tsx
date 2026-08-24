import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PartGradeBadge } from "./part-grade-badge";

describe("PartGradeBadge", () => {
  it.each([
    ["A", /grade a/i],
    ["B", /grade b/i],
    ["C", /grade c/i],
  ])("shows \"Grade %s\" for a real grade", (grade, expectedText) => {
    render(<PartGradeBadge grade={grade} />);
    expect(screen.getByText(expectedText)).toBeInTheDocument();
  });

  it('shows "Ungraded" for the ARA X state instead of "Grade X"', () => {
    render(<PartGradeBadge grade="X" />);
    expect(screen.getByText("Ungraded")).toBeInTheDocument();
    expect(screen.queryByText(/grade x/i)).not.toBeInTheDocument();
  });

  it("shows a plain dash when there is no grade at all", () => {
    render(<PartGradeBadge grade={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("surfaces the damage-unit total in a title tooltip when present", () => {
    render(<PartGradeBadge grade="B" damageUnits={1.25} />);
    expect(screen.getByText(/grade b/i)).toHaveAttribute("title", "1.25 damage units");
  });

  it("has no title tooltip when damage units are absent", () => {
    render(<PartGradeBadge grade="A" />);
    expect(screen.getByText(/grade a/i)).not.toHaveAttribute("title");
  });
});
