"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface PhotoPickerBaseProps {
  /** Unique id for the underlying file input -- required since multiple pickers can exist in the app (though never two at once on the same page today). */
  inputId: string;
  label: string;
}

interface SingleFilePickerProps extends PhotoPickerBaseProps {
  onFileSelected: (file: File) => void;
  multiple?: false;
  onFilesSelected?: never;
}

interface MultiFilePickerProps extends PhotoPickerBaseProps {
  multiple: true;
  onFilesSelected: (files: File[]) => void;
  onFileSelected?: never;
}

/**
 * Single- and multi-select are separate prop shapes rather than one
 * optional callback so a caller physically cannot ask for `multiple` and
 * then read only the first file -- which is precisely the bug this
 * component had: the picker silently discarded everything after files[0],
 * so a worker selecting eight photos got one with no indication the other
 * seven were dropped.
 */
export type PhotoPickerProps = SingleFilePickerProps | MultiFilePickerProps;

/**
 * Alternative to live camera capture: pick an existing photo (native file
 * picker, which on mobile also offers "Take Photo" alongside "Choose from
 * Library") or drag-and-drop an image file. Deliberately no `capture`
 * attribute on the input -- that would bias mobile browsers toward
 * camera-only, redundant with the separate live getUserMedia capture flow
 * this sits alongside, and would narrow the picker's gallery option
 * unpredictably across platforms.
 */
export function PhotoPicker(props: PhotoPickerProps) {
  const { inputId, label } = props;
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(fileList: FileList | null) {
    const files = fileList ? Array.from(fileList) : [];
    if (files.length === 0) return;
    if (props.multiple) {
      props.onFilesSelected(files);
    } else {
      props.onFileSelected(files[0]);
    }
  }

  return (
    <div
      data-testid="photo-drop-zone"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-4 text-center transition-colors",
        dragOver ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <label
        htmlFor={inputId}
        className="cursor-pointer text-sm font-medium underline-offset-4 hover:underline"
      >
        {label}
      </label>
      <p className="text-xs text-muted-foreground">
        {props.multiple
          ? "or drag and drop images here"
          : "or drag and drop an image here"}
      </p>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        multiple={props.multiple === true}
        // Visually hidden but still focusable/keyboard-accessible (not
        // display:none) -- written out explicitly rather than relying on a
        // "sr-only" utility class, which this project's Tailwind v4 setup
        // doesn't resolve (no prior usage anywhere else in the codebase;
        // confirmed via computed styles that the class produced no rule).
        className="absolute h-px w-px overflow-hidden border-0 p-0 whitespace-nowrap [clip:rect(0,0,0,0)]"
        onChange={(e) => {
          handleFiles(e.target.files);
          // Reset so selecting the same file again still fires onChange.
          e.target.value = "";
        }}
      />
    </div>
  );
}
