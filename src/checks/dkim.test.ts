import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { EndpointData } from "../types.js";

const { mockResolveTxt } = vi.hoisted(() => ({ mockResolveTxt: vi.fn() }));

vi.mock("node:dns/promises", () => ({
  default: { resolveTxt: mockResolveTxt },
}));

import { DkimCheck, COMMON_SELECTORS, parseDkimRecord } from "./dkim.js";

const endpoint: EndpointData = {
  url: "https://example.com",
  finalUrl: "https://example.com/",
  statusCode: 200,
  headers: {},
  setCookies: [],
  body: "",
  redirectChain: [],
};

function spki(bits: number): string {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: bits });
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

const RSA_2048 = spki(2048);
const RSA_1024 = spki(1024);

const dnsError = (code: string) => Object.assign(new Error(`queryTxt ${code}`), { code });

/** Answer TXT lookups from a map; unlisted names are NXDOMAIN. */
function txt(byName: Record<string, string[][] | string>) {
  mockResolveTxt.mockImplementation((name: string) => {
    const r = byName[name];
    if (r === undefined) return Promise.reject(dnsError("ENOTFOUND"));
    if (typeof r === "string") return Promise.reject(dnsError(r));
    return Promise.resolve(r);
  });
}

describe("parseDkimRecord", () => {
  it("reads the exact RSA key size", () => {
    expect(parseDkimRecord("s", `v=DKIM1; k=rsa; p=${RSA_2048}`)).toEqual({
      selector: "s",
      keyType: "rsa",
      keyBits: 2048,
      revoked: false,
    });
  });

  it("defaults the key type to rsa and tolerates whitespace in p=", () => {
    const spaced = RSA_1024.replace(/(.{40})/g, "$1 ");
    expect(parseDkimRecord("s", `v=DKIM1; p=${spaced}`)).toMatchObject({
      keyType: "rsa",
      keyBits: 1024,
    });
  });

  it("reports ed25519 keys as 256 bits", () => {
    expect(
      parseDkimRecord("s", "v=DKIM1; k=ed25519; p=11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo="),
    ).toMatchObject({ keyType: "ed25519", keyBits: 256, revoked: false });
  });

  it("flags an empty p= as revoked", () => {
    expect(parseDkimRecord("s", "v=DKIM1; k=rsa; p=")).toEqual({
      selector: "s",
      keyType: "rsa",
      keyBits: null,
      revoked: true,
    });
  });

  it("returns null bits for an unparseable key", () => {
    expect(parseDkimRecord("s", "v=DKIM1; p=not-a-key").keyBits).toBeNull();
  });
});

describe("DkimCheck", () => {
  const check = new DkimCheck();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has the correct name", () => {
    expect(check.name).toBe("dkim");
  });

  it("probes every common selector", async () => {
    txt({});
    await check.run(endpoint, "example.com");
    const names = mockResolveTxt.mock.calls.map((c) => c[0]);
    expect(names).toHaveLength(COMMON_SELECTORS.length);
    expect(names).toContain("google._domainkey.example.com");
    expect(names).toContain("selector1._domainkey.example.com");
    expect(names).toContain("fm3._domainkey.example.com");
  });

  it("reports found selectors, joining multi-string records", async () => {
    const half = Math.floor(RSA_2048.length / 2);
    txt({
      "google._domainkey.example.com": [
        [`v=DKIM1; k=rsa; p=${RSA_2048.slice(0, half)}`, RSA_2048.slice(half)],
      ],
      "selector1._domainkey.example.com": [["v=DKIM1; k=rsa; p="]],
      "s1._domainkey.example.com": [["some unrelated TXT"]],
    });
    const result = await check.run(endpoint, "example.com");
    expect(result).toEqual({
      name: "dkim",
      data: {
        found: true,
        hasActiveKey: true,
        selectors: [
          { selector: "google", keyType: "rsa", keyBits: 2048, revoked: false },
          { selector: "selector1", keyType: "rsa", keyBits: null, revoked: true },
        ],
        probed: COMMON_SELECTORS.length,
        lookupErrors: 0,
        minRsaKeyBits: 2048,
      },
    });
  });

  it("reports the weakest active RSA key, ignoring revoked and ed25519 keys", async () => {
    txt({
      "s1._domainkey.example.com": [[`v=DKIM1; p=${RSA_2048}`]],
      "s2._domainkey.example.com": [[`v=DKIM1; p=${RSA_1024}`]],
      "k1._domainkey.example.com": [["v=DKIM1; p="]],
      "k2._domainkey.example.com": [
        ["v=DKIM1; k=ed25519; p=11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo="],
      ],
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.minRsaKeyBits).toBe(1024);
  });

  it("reports not found when every lookup cleanly finds nothing", async () => {
    txt({ "default._domainkey.example.com": "ENODATA" });
    const result = await check.run(endpoint, "example.com");
    expect(result.data).toEqual({
      found: false,
      hasActiveKey: false,
      selectors: [],
      probed: COMMON_SELECTORS.length,
      lookupErrors: 0,
      minRsaKeyBits: null,
    });
  });

  it("reports unknown, not absent, when nothing was found but lookups failed", async () => {
    txt({ "google._domainkey.example.com": "ETIMEOUT", "k1._domainkey.example.com": "ESERVFAIL" });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.found).toBeNull();
    expect(result.data.lookupErrors).toBe(2);
  });

  it("still reports found when some other lookups failed", async () => {
    txt({
      "google._domainkey.example.com": "ETIMEOUT",
      "k1._domainkey.example.com": [[`k=rsa; p=${RSA_1024}`]],
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.found).toBe(true);
    expect(result.data.hasActiveKey).toBe(true);
    expect(result.data.lookupErrors).toBe(1);
    expect(result.data.selectors).toEqual([
      { selector: "k1", keyType: "rsa", keyBits: 1024, revoked: false },
    ]);
  });

  it("separates published keys from active ones (revoked-only domains send no mail)", async () => {
    txt({
      "google._domainkey.example.com": [["v=DKIM1; p="]],
      "selector1._domainkey.example.com": [["v=DKIM1; p="]],
    });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.found).toBe(true);
    expect(result.data.hasActiveKey).toBe(false);
  });

  it("has no active-key verdict when lookups failed and nothing was found", async () => {
    txt({ "google._domainkey.example.com": "ETIMEOUT" });
    const result = await check.run(endpoint, "example.com");
    expect(result.data.hasActiveKey).toBeNull();
  });
});
