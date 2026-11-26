import Zmodem, {
  type ZmodemDetection,
  type ZmodemOffer,
  type ZmodemSession,
} from "zmodem.js/src/zsentry";

export interface ZmodemFileDetails {
  name: string;
  size?: number;
  mtime?: Date;
  mode?: number;
  files_remaining?: number;
  bytes_remaining?: number;
}

export interface ZmodemFile {
  name: string;
  data: Uint8Array;
  details: ZmodemFileDetails;
}

export interface ZmodemProgress {
  fileName: string;
  receivedBytes: number;
  totalBytes?: number;
  percent?: number;
  phase: "receiving" | "saving" | "saved";
}

export interface ZmodemHandlerOptions {
  enabled: boolean;
  send: (data: Uint8Array) => void;
  save: (file: ZmodemFile) => void | Promise<void>;
  /** Output for non-protocol bytes in a chunk that consume() handles. */
  onOutput?: (data: Uint8Array) => void;
  onProgress?: (progress: ZmodemProgress) => void;
  onError: (error: Error) => void;
}

export interface ZmodemHandler {
  /** If false, the caller should write the original bytes to xterm. */
  consume(data: Uint8Array): boolean;
  isActive(): boolean;
  dispose(): void;
}

const INITIAL_PREFIX = [42, 42, 24, 66]; // ** ZDLE B
const HEX_HEADER_BYTES = 18;
const XON = 0x11;

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function isHex(value: number): boolean {
  return (value >= 48 && value <= 57) || (value >= 65 && value <= 70) || (value >= 97 && value <= 102);
}

function isValidInitialFragment(bytes: number[]): boolean {
  for (let index = 0; index < Math.min(bytes.length, INITIAL_PREFIX.length); index += 1) {
    if (bytes[index] !== INITIAL_PREFIX[index]) return false;
  }
  if (bytes.length >= 5 && bytes[4] !== 48 && bytes[4] !== 49) return false;
  for (let index = 5; index < Math.min(bytes.length, HEX_HEADER_BYTES); index += 1) {
    if (!isHex(bytes[index])) return false;
  }
  if (bytes.length > 20) return false;
  if (bytes.length >= 19 && ![13, 10, 0x8a].includes(bytes[18])) return false;
  if (bytes.length === 20 && bytes[18] === 13 && ![10, 0x8a].includes(bytes[19])) return false;
  return true;
}

function isCompleteInitialHeader(bytes: number[]): boolean {
  if (bytes.length < 19) return false;
  if (bytes[18] === 10 || bytes[18] === 0x8a) return true;
  return bytes.length === 20 && bytes[18] === 13 && (bytes[19] === 10 || bytes[19] === 0x8a);
}

function findInitialStart(data: Uint8Array, offset: number): number {
  for (let index = offset; index < data.length; index += 1) {
    if (data[index] !== INITIAL_PREFIX[0]) continue;
    let matches = true;
    for (let part = 1; part < INITIAL_PREFIX.length && index + part < data.length; part += 1) {
      if (data[index + part] !== INITIAL_PREFIX[part]) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

function withoutInitialHeader(data: number[]): number[] {
  const bytes = Uint8Array.from(data);
  const start = findInitialStart(bytes, 0);
  if (start < 0) return data;
  for (let index = start + HEX_HEADER_BYTES; index < Math.min(bytes.length, start + 21); index += 1) {
    if (bytes[index] !== 10 && bytes[index] !== 0x8a) continue;
    let end = index + 1;
    if (bytes[end] === XON) end += 1;
    return data.slice(0, start).concat(data.slice(end));
  }
  return data;
}

function concatenate(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Adapts zmodem.js to an xterm byte stream. Only sz/download is accepted;
 * rz/upload requests are rejected explicitly because no file picker is part
 * of this byte-level module.
 */
export function createZmodemHandler(options: ZmodemHandlerOptions): ZmodemHandler {
  let pending: number[] = [];
  let disposed = false;
  let detectedInitial = false;

  const emit = (data: number[] | Uint8Array): void => {
    if (data.length) options.onOutput?.(data instanceof Uint8Array ? data : Uint8Array.from(data));
  };
  const report = (reason: unknown): void => options.onError(asError(reason));

  const receiveOffer = (offer: ZmodemOffer): void => {
    const details = offer.get_details();
    const fileName = details.name || "unnamed-file";
    const totalBytes = details.size;
    const progress = (phase: ZmodemProgress["phase"], receivedBytes: number): void => {
      let percent: number | undefined;
      if (totalBytes !== undefined) {
        percent = totalBytes === 0
          ? (phase === "saved" ? 100 : 0)
          : Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
      }
      options.onProgress?.({ fileName, receivedBytes, totalBytes, percent, phase });
    };

    progress("receiving", 0);
    offer.on("input", () => progress("receiving", offer.get_offset()));

    let accepted: Promise<Uint8Array[]>;
    try {
      accepted = offer.accept({ on_input: "spool_uint8array" });
    } catch (error) {
      report(error);
      return;
    }

    void accepted.then(async (payloads) => {
      const data = concatenate(payloads);
      progress("saving", data.byteLength);
      await options.save({ name: fileName, data, details });
      progress("saved", data.byteLength);
    }).catch(report);
  };

  const onDetect = (detection: ZmodemDetection): void => {
    detectedInitial = true;
    if (detection.get_session_role() === "send") {
      detection.deny();
      report(new Error("ZMODEM rz/upload is not supported; use sz to download files."));
      return;
    }

    const session = detection.confirm();
    session.on("offer", receiveOffer);
    void session.start().catch(report);
  };

  const sentry = new Zmodem.Sentry({
    sender: (octets) => options.send(Uint8Array.from(octets)),
    to_terminal: (octets) => {
      if (detectedInitial) {
        detectedInitial = false;
        emit(withoutInitialHeader(octets));
      } else {
        emit(octets);
      }
    },
    on_detect: onDetect,
    on_retract: () => { pending = []; },
  });

  const activeSession = (): ZmodemSession | null => sentry.get_confirmed_session();

  return {
    consume(data: Uint8Array): boolean {
      if (disposed || !options.enabled) return false;
      let offset = 0;
      let consumed = pending.length > 0 || activeSession() !== null;

      try {
        while (offset < data.length) {
          if (activeSession()) {
            sentry.consume(data.subarray(offset));
            return true;
          }

          if (pending.length) {
            pending.push(data[offset]);
            offset += 1;
            consumed = true;
            if (!isValidInitialFragment(pending)) {
              emit(pending);
              pending = [];
              continue;
            }
            if (isCompleteInitialHeader(pending)) {
              const initial = Uint8Array.from(pending);
              pending = [];
              sentry.consume(initial);
            }
            continue;
          }

          const start = findInitialStart(data, offset);
          if (start < 0) {
            if (consumed) emit(data.subarray(offset));
            return consumed;
          }
          if (start > offset) emit(data.subarray(offset, start));
          pending = [data[start]];
          offset = start + 1;
          consumed = true;
        }
        return consumed;
      } catch (error) {
        pending = [];
        report(error);
        const session = activeSession();
        if (session && !session.has_ended()) {
          try { session.abort(); } catch { /* The original error is more useful. */ }
        }
        return true;
      }
    },

    isActive(): boolean {
      return !disposed && (pending.length > 0 || activeSession() !== null);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      pending = [];
      const session = activeSession();
      if (session && !session.has_ended()) {
        try { session.abort(); } catch { /* Disposal is best-effort. */ }
      }
    },
  };
}
