import { describe, it, expect } from "vitest";
import { CookiesCheck } from "./cookies.js";
import type { EndpointData } from "../types.js";

function makeEndpoint(setCookies: string[] = []): EndpointData {
  return {
    url: "https://example.com",
    finalUrl: "https://example.com",
    statusCode: 200,
    headers: {},
    setCookies,
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
      makeEndpoint(["sid=abc123; Secure; HttpOnly; SameSite=Strict"]),
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
    const result = await check.run(
      makeEndpoint(["sid=abc; Secure; HttpOnly; SameSite=Lax", "tracker=xyz; SameSite=None"]),
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
    const result = await check.run(makeEndpoint(["tok=v; samesite=NONE; secure"]), "example.com");

    const cookies = result.data.cookies as Array<{
      sameSite: string | null;
      secure: boolean;
    }>;
    expect(cookies[0]?.sameSite).toBe("None");
    expect(cookies[0]?.secure).toBe(true);
  });

  it("keeps cookies whose Expires date contains a comma", async () => {
    const result = await check.run(
      makeEndpoint([
        "a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Secure; HttpOnly",
        "b=2; Expires=Thu, 22 Oct 2026 07:28:00 GMT; Secure",
      ]),
      "example.com",
    );

    expect(result.data.count).toBe(2);
    expect(result.data.allSecure).toBe(true);
    expect(result.data.allHttpOnly).toBe(false);
  });

  describe("cookie name prefixes", () => {
    it("reports no prefix problems when there are no cookies", async () => {
      const result = await check.run(makeEndpoint(), "example.com");
      expect(result.data.prefixedCount).toBe(0);
      expect(result.data.invalidPrefixed).toEqual([]);
      expect(result.data.prefixViolation).toBe(false);
    });

    it("accepts prefixed cookies that follow the rules", async () => {
      const result = await check.run(
        makeEndpoint([
          "__Host-sid=1; Secure; Path=/; HttpOnly",
          "__Secure-pref=1; Secure; Domain=example.com",
          "plain=1",
        ]),
        "example.com",
      );
      expect(result.data.prefixedCount).toBe(2);
      expect(result.data.invalidPrefixed).toEqual([]);
      expect(result.data.prefixViolation).toBe(false);
    });

    it("flags __Secure- cookies without Secure", async () => {
      const result = await check.run(makeEndpoint(["__Secure-a=1; HttpOnly"]), "example.com");
      expect(result.data.invalidPrefixed).toEqual(["__Secure-a"]);
      expect(result.data.prefixViolation).toBe(true);
    });

    it("flags __Host- cookies with a Domain, a narrower Path, or no Secure", async () => {
      const result = await check.run(
        makeEndpoint([
          "__Host-a=1; Secure; Path=/; Domain=example.com",
          "__Host-b=1; Secure; Path=/app",
          "__Host-c=1; Secure",
          "__Host-d=1; Path=/",
        ]),
        "example.com",
      );
      expect(result.data.prefixedCount).toBe(4);
      expect(result.data.invalidPrefixed).toEqual(["__Host-a", "__Host-b", "__Host-c", "__Host-d"]);
    });

    it("matches prefixes case-insensitively, as browsers do", async () => {
      const result = await check.run(makeEndpoint(["__host-a=1; Path=/"]), "example.com");
      expect(result.data.invalidPrefixed).toEqual(["__host-a"]);
    });
  });
});
