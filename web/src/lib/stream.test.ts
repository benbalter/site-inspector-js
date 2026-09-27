import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeEvent, readEvents, type StreamEvent } from "./stream.ts";

/** A byte stream that delivers `text` in chunks of the given sizes. */
function chunked(text: string, sizes: number[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const size of sizes) {
    chunks.push(bytes.slice(offset, offset + size));
    offset += size;
  }
  if (offset < bytes.length) chunks.push(bytes.slice(offset));
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  await readEvents(stream, (e) => events.push(e));
  return events;
}

const start: StreamEvent = { type: "check-start", check: "dns" };
const done: StreamEvent = { type: "check-done", check: "dns", completed: 1, total: 2 };
const error: StreamEvent = { type: "error", error: "Unknown checks: é" };

describe("readEvents", () => {
  it("reads one event per line", async () => {
    const text = [start, done].map(encodeEvent).join("");
    assert.deepEqual(await collect(chunked(text, [])), [start, done]);
  });

  it("reassembles lines and multi-byte characters split across chunks", async () => {
    const text = [start, error].map(encodeEvent).join("");
    // Split every 3 bytes, which cuts through JSON and the 2-byte "é".
    const sizes = Array.from({ length: Math.ceil(text.length / 3) }, () => 3);
    assert.deepEqual(await collect(chunked(text, sizes)), [start, error]);
  });

  it("reads a final line without a trailing newline", async () => {
    const text = encodeEvent(start) + JSON.stringify(done);
    assert.deepEqual(await collect(chunked(text, [])), [start, done]);
  });
});
