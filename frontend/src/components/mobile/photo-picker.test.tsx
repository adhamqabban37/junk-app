import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PhotoPicker } from "./photo-picker";

function makeImageFile(name = "photo.jpg"): File {
  return new File(["fake-image-bytes"], name, { type: "image/jpeg" });
}

describe("PhotoPicker", () => {
  it("calls onFileSelected with the chosen file when a file is selected via the input", async () => {
    const onFileSelected = vi.fn();
    const user = userEvent.setup();
    render(<PhotoPicker inputId="test-picker" label="Choose photo" onFileSelected={onFileSelected} />);

    const file = makeImageFile();
    const input = screen.getByLabelText(/choose photo/i);
    await user.upload(input, file);

    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it("calls onFileSelected once per file when multiple files are chosen via the input", async () => {
    const onFileSelected = vi.fn();
    const user = userEvent.setup();
    render(<PhotoPicker inputId="test-picker" label="Choose photo" onFileSelected={onFileSelected} />);

    const fileA = makeImageFile("a.jpg");
    const fileB = makeImageFile("b.jpg");
    const input = screen.getByLabelText(/choose photo/i);
    await user.upload(input, [fileA, fileB]);

    expect(onFileSelected).toHaveBeenCalledTimes(2);
    expect(onFileSelected).toHaveBeenNthCalledWith(1, fileA);
    expect(onFileSelected).toHaveBeenNthCalledWith(2, fileB);
  });

  it("calls onFileSelected with the dropped file when an image is dragged and dropped", () => {
    const onFileSelected = vi.fn();
    render(<PhotoPicker inputId="test-picker" label="Choose photo" onFileSelected={onFileSelected} />);

    const file = makeImageFile("dropped.png");
    const dropZone = screen.getByTestId("photo-drop-zone");
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it("shows a visual highlight while a drag is over the drop zone, cleared on drop", () => {
    const onFileSelected = vi.fn();
    render(<PhotoPicker inputId="test-picker" label="Choose photo" onFileSelected={onFileSelected} />);

    const dropZone = screen.getByTestId("photo-drop-zone");
    fireEvent.dragOver(dropZone, { dataTransfer: { files: [] } });
    expect(dropZone.className).toMatch(/border-primary/);

    fireEvent.drop(dropZone, { dataTransfer: { files: [makeImageFile()] } });
    expect(dropZone.className).not.toMatch(/border-primary/);
  });

  it("does not call onFileSelected when the drop has no files", () => {
    const onFileSelected = vi.fn();
    render(<PhotoPicker inputId="test-picker" label="Choose photo" onFileSelected={onFileSelected} />);

    const dropZone = screen.getByTestId("photo-drop-zone");
    fireEvent.drop(dropZone, { dataTransfer: { files: [] } });

    expect(onFileSelected).not.toHaveBeenCalled();
  });

  it("renders the caption text pointing at drag-and-drop as an alternative", () => {
    render(<PhotoPicker inputId="test-picker" label="Choose photo" onFileSelected={vi.fn()} />);
    expect(screen.getByText(/drag/i)).toBeInTheDocument();
  });
});
