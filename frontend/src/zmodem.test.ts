import { describe, expect, it, vi } from "vitest";
import Zmodem from "zmodem.js/src/zsentry";
import { createZmodemHandler, type ZmodemFile } from "./zmodem";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function initialRequest(): Uint8Array {
  return Uint8Array.from(Zmodem.Header.build("ZRQINIT").to_hex());
}

function uploadRequest(): Uint8Array {
  return Uint8Array.from(
    Zmodem.Header.build("ZRINIT", ["CANFDX", "CANOVIO", "CANFC32"], 0).to_hex(),
  );
}

function createTestHandler(save: any = vi.fn()) {
  const sent: number[][] = [];
  const output: number[][] = [];
  const errors: Error[] = [];
  const progress: Array<{ receivedBytes: number; totalBytes?: number }> = [];
  let peer: { consume(data: number[]): void } | undefined;

  const handler = createZmodemHandler({
    enabled: true,
    send(data) {
      const octets = Array.from(data);
      if (peer) peer.consume(octets);
      else sent.push(octets);
    },
    save,
    onOutput: (data) => output.push(Array.from(data)),
    onProgress: (event) => progress.push(event),
    onError: (error) => errors.push(error),
  });

  return { handler, sent, output, errors, progress, save, setPeer: (value: typeof peer) => { peer = value; } };
}

async function sendFile(
  context: ReturnType<typeof createTestHandler>,
  name: string,
  payload: Uint8Array,
  fragment = false,
) {
  expect(context.handler.consume(initialRequest())).toBe(true);
  const response = context.sent.shift();
  expect(response).toBeDefined();
  const parsed = Zmodem.Header.parse(response!.slice());
  expect(parsed).toBeDefined();

  const sender = new Zmodem.Session.Send(parsed![0]);
  context.setPeer(sender);
  sender.set_sender((octets) => {
    if (fragment) {
      for (const octet of octets) context.handler.consume(Uint8Array.of(octet));
    } else {
      context.handler.consume(Uint8Array.from(octets));
    }
  });

  const transfer = await sender.send_offer({ name, size: payload.length });
  expect(transfer).toBeDefined();
  await transfer!.end(payload);
  await sender.close();
  context.setPeer(undefined);
}

describe("createZmodemHandler", () => {
  it("passes ordinary bytes through unchanged and honors disabled mode", () => {
    const plain = encoder.encode("plain \u001b[31mtext\r\n");
    const enabled = createTestHandler();
    expect(enabled.handler.consume(plain)).toBe(false);
    expect(enabled.output).toEqual([]);
    expect(enabled.sent).toEqual([]);

    const errors: Error[] = [];
    const disabled = createZmodemHandler({
      enabled: false,
      send: vi.fn(),
      save: vi.fn(),
      onError: (error) => errors.push(error),
    });
    expect(disabled.consume(initialRequest())).toBe(false);
    expect(errors).toEqual([]);
  });

  it("buffers a fragmented offer and never displays its control sequence", () => {
    const context = createTestHandler();
    const initial = initialRequest();
    expect(decoder.decode(initial)).toContain("**\u0018B00000000000000");

    for (const octet of initial) {
      expect(context.handler.consume(Uint8Array.of(octet))).toBe(true);
    }

    expect(context.sent.length).toBe(1);
    expect(context.output).toEqual([]);
    expect(context.errors).toEqual([]);
  });

  it("releases a buffered false positive as ordinary terminal output", () => {
    const context = createTestHandler();
    const source = encoder.encode("**not-zmodem");
    expect(context.handler.consume(source.subarray(0, 2))).toBe(true);
    expect(context.handler.consume(source.subarray(2))).toBe(true);
    expect(decoder.decode(Uint8Array.from(context.output.flat()))).toBe("**not-zmodem");
  });

  it("receives a fragmented file, reports progress, and saves its bytes", async () => {
    const context = createTestHandler();
    const payload = Uint8Array.from([0, 1, 2, 13, 10, 24, 127, 128, 255]);

    await sendFile(context, "binary.dat", payload, true);
    await vi.waitFor(() => expect(context.save).toHaveBeenCalledTimes(1));

    const file = context.save.mock.calls[0][0];
    expect(file.name).toBe("binary.dat");
    expect(file.data).toEqual(payload);
    expect(context.progress.some((event) => event.receivedBytes === payload.length)).toBe(true);
    expect(context.progress.at(-1)).toMatchObject({
      fileName: "binary.dat",
      receivedBytes: payload.length,
      totalBytes: payload.length,
      percent: 100,
      phase: "saved",
    });
    expect(context.errors).toEqual([]);
    expect(decoder.decode(Uint8Array.from(context.output.flat()))).not.toContain("B00000000000000");
  });

  it("reports rz/upload as unsupported and aborts the request", () => {
    const context = createTestHandler();
    expect(context.handler.consume(uploadRequest())).toBe(true);
    expect(context.errors).toHaveLength(1);
    expect(context.errors[0].message).toMatch(/rz|upload/i);
    expect(context.sent.flat()).toEqual([24, 24, 24, 24, 24]);
    expect(context.save).not.toHaveBeenCalled();
  });

  it("routes save failures to onError", async () => {
    const failure = new Error("disk full");
    const save = vi.fn<(file: ZmodemFile) => Promise<void>>().mockRejectedValue(failure);
    const context = createTestHandler(save);

    await sendFile(context, "failure.txt", encoder.encode("content"));
    await vi.waitFor(() => expect(context.errors).toContain(failure));
  });
});
