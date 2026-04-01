import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const LOW_CONFIDENCE_THRESHOLD = 0.7;
const SILENCE_TIMEOUT_MS = 10000;

type SpeechStatus = "idle" | "starting" | "listening" | "stopping";
type StopReason =
  | "manual-stop"
  | "timeout"
  | "onend"
  | "onerror"
  | "modal-close"
  | "visibility-hide";

type SpeechErrorCode =
  | "not-allowed"
  | "network"
  | "no-speech"
  | "aborted"
  | "start-failed"
  | "unknown";

interface SpeechAlternativeLike {
  transcript?: string;
  confidence?: number;
}

interface SpeechResultLike {
  isFinal?: boolean;
  0?: SpeechAlternativeLike;
}

interface SpeechRecognitionResultEventLike {
  resultIndex?: number;
  results?: ArrayLike<SpeechResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
}

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructorLike;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
};

interface UseSpeechToTextOptions {
  isModalOpen: boolean;
  onFinalTranscript: (transcript: string, confidence: number | null) => void;
  onSessionEnd?: (reason: StopReason, errorCode: SpeechErrorCode | null) => void;
}

function normalizeTranscript(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapSpeechError(error: string | undefined): SpeechErrorCode {
  if (error === "not-allowed" || error === "service-not-allowed") return "not-allowed";
  if (error === "network") return "network";
  if (error === "no-speech") return "no-speech";
  if (error === "aborted") return "aborted";
  return "unknown";
}

function getRecognitionConstructor(): SpeechRecognitionConstructorLike | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function useSpeechToText({
  isModalOpen,
  onFinalTranscript,
  onSessionEnd,
}: UseSpeechToTextOptions) {
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [errorCode, setErrorCode] = useState<SpeechErrorCode | null>(null);
  const [lastConfidence, setLastConfidence] = useState<number | null>(null);
  const [lowConfidenceDetected, setLowConfidenceDetected] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const statusRef = useRef<SpeechStatus>("idle");
  const silenceTimerRef = useRef<number | null>(null);
  const sessionTokenRef = useRef(0);
  const finalizedTokenRef = useRef<number>(-1);

  const recognitionConstructor = useMemo(() => getRecognitionConstructor(), []);
  const isSupported = Boolean(
    typeof window !== "undefined" &&
      window.isSecureContext &&
      recognitionConstructor
  );

  const unsupportedReason = useMemo(() => {
    if (typeof window === "undefined") return "unavailable";
    if (!window.isSecureContext) return "insecure-context";
    if (!recognitionConstructor) return "unsupported-api";
    return null;
  }, [recognitionConstructor]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const finalizeSession = useCallback((reason: StopReason, code: SpeechErrorCode | null) => {
    const token = sessionTokenRef.current;
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (finalizedTokenRef.current === token) {
      return;
    }
    finalizedTokenRef.current = token;

    clearSilenceTimer();
    setStatus("idle");
    statusRef.current = "idle";
    setInterimTranscript("");
    onSessionEnd?.(reason, code);
  }, [clearSilenceTimer, onSessionEnd]);

  const armSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      setStatus("stopping");
      statusRef.current = "stopping";
      finalizeSession("timeout", null);
      recognitionRef.current?.stop();
    }, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer, finalizeSession]);

  const stop = useCallback((reason: StopReason = "manual-stop") => {
    const currentStatus = statusRef.current;
    if (currentStatus !== "starting" && currentStatus !== "listening" && currentStatus !== "stopping") {
      return;
    }

    setStatus("stopping");
    statusRef.current = "stopping";
    clearSilenceTimer();
    if (reason !== "onend") {
      finalizeSession(reason, null);
    }
    recognitionRef.current?.stop();
  }, [clearSilenceTimer, finalizeSession]);

  const start = useCallback(() => {
    if (!isSupported || !recognitionConstructor) {
      setErrorCode("start-failed");
      return false;
    }
    if (statusRef.current !== "idle") {
      return false;
    }

    sessionTokenRef.current += 1;
    finalizedTokenRef.current = -1;
    setStatus("starting");
    statusRef.current = "starting";
    setInterimTranscript("");
    setErrorCode(null);
    setLastConfidence(null);
    setLowConfidenceDetected(false);

    const token = sessionTokenRef.current;
    const recognition = new recognitionConstructor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (token !== sessionTokenRef.current) return;
      setStatus("listening");
      statusRef.current = "listening";
      armSilenceTimer();
    };

    recognition.onresult = (event) => {
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (token !== sessionTokenRef.current) return;

      const results = event.results;
      if (!results) return;

      const interimParts: string[] = [];
      const finalParts: string[] = [];
      const confidenceValues: number[] = [];
      const startIndex = event.resultIndex ?? 0;

      for (let index = startIndex; index < results.length; index += 1) {
        const result = results[index];
        const transcript = normalizeTranscript(result?.[0]?.transcript ?? "");
        if (!transcript) continue;

        if (result?.isFinal) {
          finalParts.push(transcript);
          const confidence = result?.[0]?.confidence;
          if (typeof confidence === "number") {
            confidenceValues.push(confidence);
          }
        } else {
          interimParts.push(transcript);
        }
      }

      setInterimTranscript(normalizeTranscript(interimParts.join(" ")));

      if (finalParts.length > 0) {
        const finalTranscript = normalizeTranscript(finalParts.join(" "));
        const confidence = confidenceValues.length > 0
          ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
          : null;

        if (typeof confidence === "number") {
          setLastConfidence(confidence);
          if (confidence < LOW_CONFIDENCE_THRESHOLD) {
            setLowConfidenceDetected(true);
          }
        }

        onFinalTranscript(finalTranscript, confidence);
      }

      armSilenceTimer();
    };

    recognition.onerror = (event) => {
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (token !== sessionTokenRef.current) return;
      const mapped = mapSpeechError(event.error);
      setErrorCode(mapped);
      setStatus("stopping");
      statusRef.current = "stopping";
      finalizeSession("onerror", mapped);
    };

    recognition.onend = () => {
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (token !== sessionTokenRef.current) return;
      finalizeSession("onend", null);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      return true;
    } catch {
      setErrorCode("start-failed");
      finalizeSession("onerror", "start-failed");
      return false;
    }
  }, [armSilenceTimer, finalizeSession, isSupported, onFinalTranscript, recognitionConstructor]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!isModalOpen) {
      const activeStatus = status === "starting" || status === "listening" || status === "stopping";
      if (activeStatus) {
        stop("modal-close");
      }
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stop("visibility-hide");
      }
    };

    const handlePageHide = () => {
      stop("visibility-hide");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [isModalOpen, status, stop]);

  useEffect(() => () => {
    clearSilenceTimer();
    recognitionRef.current?.stop();
  }, [clearSilenceTimer]);

  return {
    isSupported,
    unsupportedReason,
    status,
    isListening: status === "listening",
    interimTranscript,
    errorCode,
    lastConfidence,
    lowConfidenceDetected,
    start,
    stop,
  };
}

export type { SpeechStatus, StopReason, SpeechErrorCode };