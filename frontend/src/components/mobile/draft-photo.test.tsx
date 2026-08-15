import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftPhotoView } from "./draft-photo";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DraftPhotoView", () => {
  it("renders the blob as an image with the given alt text", () => {
    render(<DraftPhotoView blob={new Blob(["x"])} alt="front of the vehicle" />);

    const img = screen.getByAltText("front of the vehicle");
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toMatch(/^blob:/);
  });

  // Not tidiness -- this runs on a phone, and a worker re-picking their
  // walkaround a few times would otherwise pin a full-size image in memory
  // per render for as long as the tab lives.
  it("revokes the object url on unmount", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const { unmount } = render(<DraftPhotoView blob={new Blob(["x"])} alt="a" />);

    const src = screen.getByAltText("a").getAttribute("src");
    expect(revoke).not.toHaveBeenCalled();

    unmount();

    expect(revoke).toHaveBeenCalledWith(src);
  });

  it("revokes the previous url when the blob changes", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const { rerender } = render(<DraftPhotoView blob={new Blob(["a"])} alt="a" />);
    const firstSrc = screen.getByAltText("a").getAttribute("src");

    rerender(<DraftPhotoView blob={new Blob(["b"])} alt="a" />);

    expect(revoke).toHaveBeenCalledWith(firstSrc);
    // And the new blob got its own url rather than reusing the revoked one.
    expect(screen.getByAltText("a").getAttribute("src")).not.toBe(firstSrc);
  });
});
