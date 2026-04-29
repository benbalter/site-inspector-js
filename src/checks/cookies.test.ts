import { describe, it, expect } from "vitest";
import { CookiesCheck } from "./cookies.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(headers: Record<string, string> = {}): EndpointData {
  return {
    url: "https://example.com",
    statusCode: 200,
    headers,
    body: "",
    redirectChain: [],
  };
}

describe("CookiesCheck", () => {
  const check = new CookiesCheck();

  it("reports no cookies when set-cookie header is absent", async () => {
    const result = await check.run(makeEndpoint(), "example.com");

    expect(result.name).toBe("cookies");
    expect(result.data.hasCookies).toBe(false);
    expect(result.data.count).toBe(0);
    expect(result.data.cookies).toEqual([]);
    expect(result.data.allSecure).toBe(true);
    expect(result.data.allHttpOnly).toBe(true);
  });

  it("parses a single secure cookie with all flags", async () => {
    const result = await check.run(
      makeEndpoint({
        "set-cookie": "sid=abc123; Secure; HttpOnly; SameSite=Strict",
      }),
      "example.com",
    );

    expect(result.data.hasCookies).toBe(true);
    expect(result.data.count).toBe(1);
    expect(result.data.cookies).toEqual([
      { name: "sid", secure: true, httpOnly: true, sameSite: "Strict" },
    ]);
    expect(result.data.allSecure).toBe(true);
    expect(result.data.allHttpOnly).toBe(true);
  });

  it("handles multiple cookies with mixed security flags", async () => {
    const header =
      "sid=abc; Secure; HttpOnly; SameSite=Lax, " +
      "tracker=xyz; SameSite=None";
    const result = await check.run(
      makeEndpoint({ "set-cookie": header }),
      "example.com",
    );

    expect(result.data.hasCookies).toBe(true);
    expect(result.data.count).toBe(2);

    const cookies = result.data.cookies as Array<{
      name: string;
      secure: boolean;
      httpOnly: boolean;
      sameSite: string | null;
    }>;
    expect(cookies[0]).toEqual({
      name: "sid",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    });
    expect(cookies[1]).toEqual({
      name: "tracker",
      secure: false,
      httpOnly: false,
      sameSite: "None",
    });

    expect(result.data.allSecure).toBe(false);
    expect(result.data.allHttpOnly).toBe(false);
  });

  it("parses SameSite attribute case-insensitively", async () => {
    const result = await check.run(
      makeEndpoint({
        "set-cookie": "tok=v; samesite=NONE; secure",
      }),
      "example.com",
    );

    const cookies = result.data.cookies as Array<{
      sameSite: string | null;
      secure: boolean;
    }>;
    expect(cookies[0]?.sameSite).toBe("None");
    expect(cookies[0]?.secure).toBe(true);
  });
});
