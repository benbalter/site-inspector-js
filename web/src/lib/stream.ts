// The /api/inspect progress stream: newline-delimited JSON events, shared by
// the server (which writes them) and the page (which reads them).

import type { DomainProperties, InspectionResult } from "site-inspector";

/** Content type the page sends in Accept to ask for a progress stream. */
export const NDJSON = "application/x-ndjson";

export type StreamEvent =
  | { type: "resolved"; domain: string; properties: DomainProperties; checks: string[] }
  | { type: "check-start"; check: string }
  | { type: "check-done"; check: string; completed: number; total: number }
  | { type: "result"; result: InspectionResult }
  | { type: "error"; error: string };

/** Serialize one event as a line of NDJSON. */
export function encodeEvent(event: StreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Read an NDJSON stream, calling `onEvent` for each complete line. Handles
 * lines split across chunks and a final line without a trailing newline.
 */
export async function readEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as StreamEvent);
    }
    if (done) return;
  }
}
