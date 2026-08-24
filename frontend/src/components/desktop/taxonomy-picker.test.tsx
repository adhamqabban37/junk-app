import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaxonomyPicker } from "./taxonomy-picker";
import type { TaxonomyItemResponse } from "@/lib/api";

const TAXONOMIES: TaxonomyItemResponse[] = [
  { id: "t-alt", name: "Alternator", category: "Electrical", isQuickPick: true },
  { id: "t-fender", name: "Fender", category: "Body", isQuickPick: true },
  { id: "t-frontdoor", name: "Front Door", category: "Body", isQuickPick: false },
  { id: "t-frame", name: "Frame", category: "Body", isQuickPick: false },
  { id: "t-hood", name: "Hood", category: "Body", isQuickPick: true },
];

describe("TaxonomyPicker", () => {
  it("shows only quick picks by default, not the full scrollable list", () => {
    render(<TaxonomyPicker taxonomies={TAXONOMIES} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fender" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hood" })).toBeInTheDocument();
    // Not a quick pick -- shouldn't appear until browsing/searching.
    expect(screen.queryByText("Front Door")).not.toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows every name starting with a pressed letter, including non-quick-picks", async () => {
    const user = userEvent.setup();
    render(<TaxonomyPicker taxonomies={TAXONOMIES} selectedId={null} onSelect={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "F" }));

    const list = screen.getByRole("listbox", { name: "Part results" });
    expect(within(list).getByText("Fender")).toBeInTheDocument();
    expect(within(list).getByText("Frame")).toBeInTheDocument();
    expect(within(list).getByText("Front Door")).toBeInTheDocument();
    expect(within(list).queryByText("Alternator")).not.toBeInTheDocument();
    expect(within(list).queryByText("Hood")).not.toBeInTheDocument();
  });

  it("pressing the same active letter again returns to the default quick-pick view", async () => {
    const user = userEvent.setup();
    render(<TaxonomyPicker taxonomies={TAXONOMIES} selectedId={null} onSelect={vi.fn()} />);

    const letterF = screen.getByRole("button", { name: "F" });
    await user.click(letterF);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.click(letterF);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("typing a query live-filters the whole catalog, not just quick picks, and clears the active letter", async () => {
    const user = userEvent.setup();
    render(<TaxonomyPicker taxonomies={TAXONOMIES} selectedId={null} onSelect={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "H" }));
    await user.type(screen.getByLabelText("Search parts"), "front");

    const list = screen.getByRole("listbox", { name: "Part results" });
    expect(within(list).getByText("Front Door")).toBeInTheDocument();
    expect(within(list).queryByText("Hood")).not.toBeInTheDocument();
    // Active letter no longer highlighted once a query takes over.
    expect(screen.getByRole("button", { name: "H" })).not.toHaveClass("bg-primary");
  });

  it("calls onSelect with the clicked part's id", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<TaxonomyPicker taxonomies={TAXONOMIES} selectedId={null} onSelect={onSelect} />);

    await user.type(screen.getByLabelText("Search parts"), "fender");
    await user.click(screen.getByText("Fender"));

    expect(onSelect).toHaveBeenCalledWith("t-fender");
  });

  it("shows a no-matches message for a query that matches nothing", async () => {
    const user = userEvent.setup();
    render(<TaxonomyPicker taxonomies={TAXONOMIES} selectedId={null} onSelect={vi.fn()} />);

    await user.type(screen.getByLabelText("Search parts"), "zzz-nonexistent");

    expect(screen.getByText("No matching parts.")).toBeInTheDocument();
  });

  it("highlights the currently selected result", async () => {
    const user = userEvent.setup();
    render(<TaxonomyPicker taxonomies={TAXONOMIES} selectedId="t-fender" onSelect={vi.fn()} />);

    await user.type(screen.getByLabelText("Search parts"), "fender");

    expect(screen.getByRole("option", { name: "Fender" })).toHaveAttribute("aria-selected", "true");
  });
});
