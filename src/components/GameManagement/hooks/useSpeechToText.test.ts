import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpeechToText } from "./useSpeechToText";

type MockSpeechResultEvent = {
  resultIndex: number;
  results: Array<{
    isFinal: boolean;
    0: {
      transcript: string;
      confidence: number;
    };
  }>;
};

type MockSpeechErrorEvent = {
  error: string;
};

class MockSpeechRecognition {
  static lastInstance: MockSpeechRecognition | null = null;

  lang = "";
  continuous = false;
  interimResults = false;
  onstart: (() => void) | null = null;
  onresult: ((event: MockSpeechResultEvent) => void) | null = null;
  onerror: ((event: MockSpeechErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;

  start = vi.fn(() => {
    this.onstart?.();
  });

  stop = vi.fn(() => {
    this.onend?.();
  });

  constructor() {
    MockSpeechRecognition.lastInstance = this;
  }

  emitResult(payload: MockSpeechResultEvent) {
    this.onresult?.(payload);
  }

  emitError(error: string) {
    this.onerror?.({ error });
  }
}

describe("useSpeechToText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    (window as Window & { webkitSpeechRecognition?: typeof MockSpeechRecognition }).webkitSpeechRecognition = MockSpeechRecognition;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as Window & { webkitSpeechRecognition?: typeof MockSpeechRecognition }).webkitSpeechRecognition;
    MockSpeechRecognition.lastInstance = null;
  });

  it("reports unsupported when secure-context or API checks fail", () => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(() =>
      useSpeechToText({
        isModalOpen: true,
        onFinalTranscript: vi.fn(),
      })
    );

    expect(result.current.isSupported).toBe(false);
    expect(result.current.unsupportedReason).toBe("insecure-context");
  });

  it("starts listening, emits transcript, and flags low confidence under 70%", () => {
    const onFinalTranscript = vi.fn();

    const { result } = renderHook(() =>
      useSpeechToText({
        isModalOpen: true,
        onFinalTranscript,
      })
    );

    act(() => {
      result.current.start();
    });

    expect(result.current.isListening).toBe(true);

    act(() => {
      MockSpeechRecognition.lastInstance?.emitResult({
        resultIndex: 0,
        results: [
          {
            isFinal: true,
            0: { transcript: "  Great   pressure\nteam  ", confidence: 0.64 },
          },
        ],
      });
    });

    expect(onFinalTranscript).toHaveBeenCalledWith("Great pressure team", 0.64);
    expect(result.current.lowConfidenceDetected).toBe(true);
  });

  it("auto-stops after 10 seconds of silence", () => {
    const onSessionEnd = vi.fn();

    const { result } = renderHook(() =>
      useSpeechToText({
        isModalOpen: true,
        onFinalTranscript: vi.fn(),
        onSessionEnd,
      })
    );

    act(() => {
      result.current.start();
    });

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(onSessionEnd).toHaveBeenCalledWith("timeout", null);
    expect(MockSpeechRecognition.lastInstance?.stop).toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);
  });

  it("handles manual-stop plus trailing onend with idempotent finalization", () => {
    const onSessionEnd = vi.fn();

    const { result } = renderHook(() =>
      useSpeechToText({
        isModalOpen: true,
        onFinalTranscript: vi.fn(),
        onSessionEnd,
      })
    );

    act(() => {
      result.current.start();
      result.current.stop("manual-stop");
      MockSpeechRecognition.lastInstance?.onend?.();
    });

    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    expect(onSessionEnd).toHaveBeenCalledWith("manual-stop", null);
  });

  it("stops when modal closes", () => {
    const onSessionEnd = vi.fn();

    const { result, rerender } = renderHook(
      ({ isModalOpen }) =>
        useSpeechToText({
          isModalOpen,
          onFinalTranscript: vi.fn(),
          onSessionEnd,
        }),
      { initialProps: { isModalOpen: true } }
    );

    act(() => {
      result.current.start();
    });

    rerender({ isModalOpen: false });

    expect(onSessionEnd).toHaveBeenCalledWith("modal-close", null);
  });

  it("fires onSessionEnd with 'visibility-hide' and stops recognition when pagehide fires", () => {
    const onSessionEnd = vi.fn();

    const { result } = renderHook(() =>
      useSpeechToText({
        isModalOpen: true,
        onFinalTranscript: vi.fn(),
        onSessionEnd,
      })
    );

    act(() => {
      result.current.start();
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(onSessionEnd).toHaveBeenCalledWith("visibility-hide", null);
    expect(MockSpeechRecognition.lastInstance?.stop).toHaveBeenCalled();
  });
});