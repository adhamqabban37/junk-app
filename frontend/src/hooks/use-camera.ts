"use client";

import { useEffect, useRef, useState } from "react";

export interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  ready: boolean;
  error: string | null;
}

function isCameraSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** Requests the rear (environment-facing) camera. Not unit-tested — getUserMedia doesn't exist in jsdom. */
export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Lazy initializer, not an effect: this is a synchronous capability check,
  // not data that arrives later, and every page using this hook is already
  // gated behind the mobile layout's auth guard (which renders null until
  // the client-side session check resolves) — so this never actually runs
  // during SSR, only on a real client mount, where `navigator` is accurate.
  const [error, setError] = useState<string | null>(() =>
    isCameraSupported() ? null : "Camera not supported on this device/browser.",
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isCameraSupported()) {
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Camera unavailable");
        }
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { videoRef, ready, error };
}
