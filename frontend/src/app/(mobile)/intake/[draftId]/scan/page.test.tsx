import "fake-indexeddb/auto";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ScanPageClient from "./scan-page-client";
import { _resetDbForTests } from "@/lib/offline/db";
import { useIntakeStore } from "@/lib/offline/store";
import { useTaxonomyStore } from "@/lib/offline/taxonomy-store";
import { useAuthSession } from "@/lib/auth-session";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const captureFromFileMock = vi.fn();
vi.mock("@/lib/offline/capture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/capture")>();
  return {
    ...actual,
    captureFromFile: (file: File) => captureFromFileMock(file),
  };
});

const detectPartsMock = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    detectParts: (...args: unknown[]) => detectPartsMock(...args),
  };
});

const TAXONOMY = [
  { id: "tax-hood", name: "Hood", category: "Body", isQuickPick: true },
  { id: "tax-hl-left", name: "Headlight (Left)", category: "Lighting", isQuickPick: true },
  { id: "tax-hl-right", name: "Headlight (Right)", category: "Lighting", isQuickPick: true },
];

const detection = (over: Partial<Record<string, unknown>> = {}) => ({
  partName: "hood",
  taxonomyId: "tax-hood",
  taxonomyName: "Hood",
  candidateIds: ["tax-hood"],
  grade: "A",
  damageCodes: [],
  confidence: 0.95,
  ...over,
});

async function pickFiles(count = 1) {
  const input = document.getElementById("scan-photos") as HTMLInputElement;
  const files = Array.from(
    { length: count },
    (_, i) => new File(["x"], `photo-${i}.jpg`, { type: "image/jpeg" }),
  );
  await userEvent.upload(input, files);
  return files;
}

describe("ScanPageClient", () => {
  let draftId: string;

  beforeEach(async () => {
    pushMock.mockReset();
    detectPartsMock.mockReset();
    captureFromFileMock.mockReset();
    captureFromFileMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      qualityFlags: { blurry: false, tooDark: false },
    });
    await _resetDbForTests();
    useIntakeStore.setState({ drafts: [], hydrated: false });
    useTaxonomyStore.setState({ items: TAXONOMY, hydrated: true });
    useAuthSession.setState({ token: "test-token", claims: null, restored: true });
    const draft = await useIntakeStore.getState().createDraft();
    draftId = draft.id;
  });

  it("sends every selected photo, not just the first", async () => {
    // The whole point of the feature: the old picker silently kept files[0].
    detectPartsMock.mockResolvedValue([{ index: 0, detections: [] }]);

    render(<ScanPageClient draftId={draftId} />);
    await pickFiles(3);

    await waitFor(() => expect(detectPartsMock).toHaveBeenCalled());
    const blobs = detectPartsMock.mock.calls[0][1] as Blob[];
    expect(blobs).toHaveLength(3);
  });

  it("lists each detected part with its grade and confidence", async () => {
    detectPartsMock.mockResolvedValue([
      {
        index: 0,
        detections: [
          detection(),
          detection({
            partName: "left headlight",
            taxonomyId: "tax-hl-left",
            taxonomyName: "Headlight (Left)",
            grade: "B",
            damageCodes: ["crack"],
            confidence: 0.8,
          }),
        ],
      },
    ]);

    render(<ScanPageClient draftId={draftId} />);
    await pickFiles();

    expect(await screen.findByText("Found 2 parts")).toBeInTheDocument();
    expect(screen.getByText("Hood")).toBeInTheDocument();
    expect(screen.getByText("Headlight (Left)")).toBeInTheDocument();
    expect(screen.getByText("Grade B")).toBeInTheDocument();
    expect(screen.getByText("crack")).toBeInTheDocument();
  });

  it("adds confirmed parts to the draft and returns to the parts screen", async () => {
    detectPartsMock.mockResolvedValue([{ index: 0, detections: [detection()] }]);

    render(<ScanPageClient draftId={draftId} />);
    await pickFiles();

    await userEvent.click(await screen.findByRole("button", { name: /add 1 part/i }));

    await waitFor(() => {
      const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
      expect(draft?.parts).toHaveLength(1);
      expect(draft?.parts[0].taxonomyId).toBe("tax-hood");
      expect(draft?.parts[0].photos).toHaveLength(1);
    });
    expect(pushMock).toHaveBeenCalledWith(`/intake/${draftId}/parts`);
  });

  it("leaves an ambiguous detection unticked until a side is chosen", async () => {
    detectPartsMock.mockResolvedValue([
      {
        index: 0,
        detections: [
          detection({
            partName: "headlight",
            taxonomyId: null,
            taxonomyName: null,
            candidateIds: ["tax-hl-left", "tax-hl-right"],
          }),
        ],
      },
    ]);

    render(<ScanPageClient draftId={draftId} />);
    await pickFiles();

    const checkbox = await screen.findByRole("checkbox");
    expect(checkbox).not.toBeChecked();

    // Only the two candidate sides are offered, not the whole taxonomy.
    const select = screen.getByRole("combobox", { name: /part for headlight/i });
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Choose a part…",
      "Headlight (Left)",
      "Headlight (Right)",
    ]);

    await userEvent.click(checkbox);
    await userEvent.selectOptions(select, "tax-hl-right");
    await userEvent.click(screen.getByRole("button", { name: /add 1 part/i }));

    await waitFor(() => {
      const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
      expect(draft?.parts[0].taxonomyId).toBe("tax-hl-right");
    });
  });

  it("offers the full taxonomy for an unmapped detection", async () => {
    detectPartsMock.mockResolvedValue([
      {
        index: 0,
        detections: [
          detection({
            partName: "windshield",
            taxonomyId: null,
            taxonomyName: null,
            candidateIds: [],
          }),
        ],
      },
    ]);

    render(<ScanPageClient draftId={draftId} />);
    await pickFiles();

    expect(await screen.findByText(/no matching part for/i)).toBeInTheDocument();
    const select = screen.getByRole("combobox", { name: /part for windshield/i });
    expect(within(select).getAllByRole("option")).toHaveLength(TAXONOMY.length + 1);
  });

  it("blocks confirming a ticked row that still has no part type", async () => {
    detectPartsMock.mockResolvedValue([
      {
        index: 0,
        detections: [
          detection({ partName: "windshield", taxonomyId: null, taxonomyName: null, candidateIds: [] }),
        ],
      },
    ]);

    render(<ScanPageClient draftId={draftId} />);
    await pickFiles();

    await userEvent.click(await screen.findByRole("checkbox"));

    expect(screen.getByRole("alert")).toHaveTextContent(/still needs a part type/i);
    expect(screen.getByRole("button", { name: /add part/i })).toBeDisabled();
  });

  it("collapses one part seen in two photos into a single part", async () => {
    detectPartsMock.mockResolvedValue([
      { index: 0, detections: [detection()] },
      { index: 1, detections: [detection()] },
    ]);

    render(<ScanPageClient draftId={draftId} />);
    await pickFiles(2);

    expect(await screen.findByText("Found 2 parts")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /add 2 parts/i }));

    await waitFor(() => {
      const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
      expect(draft?.parts).toHaveLength(1);
      expect(draft?.parts[0].photos).toHaveLength(2);
    });
  });

  it("reports a photo that failed without losing the others", async () => {
    detectPartsMock.mockResolvedValue([
      { index: 0, detections: [detection()] },
      { index: 1, detections: [], error: "Could not analyze this photo" },
    ]);

    render(<ScanPageClient draftId={draftId} />);
    await pickFiles(2);

    expect(await screen.findByText(/photo 2: could not analyze/i)).toBeInTheDocument();
    expect(screen.getByText("Found 1 part")).toBeInTheDocument();
  });

  it("surfaces a failed request and lets the worker retry", async () => {
    detectPartsMock.mockRejectedValue(new Error("offline"));

    render(<ScanPageClient draftId={draftId} />);
    await pickFiles();

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't analyze/i);
    // Back on the picker, not stranded on a spinner.
    expect(document.getElementById("scan-photos")).toBeInTheDocument();
  });
});
