import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { Agent, fetch } from "undici";
import {
  guardedConnect,
  guardedLookup,
  isLoopbackClient,
  isPublicAddress,
  isValidHostname,
} from "./network.ts";

describe("isPublicAddress", () => {
  it("allows public addresses", () => {
    for (const a of ["93.184.215.14", "8.8.8.8", "2606:4700::1111"]) {
      assert.equal(isPublicAddress(a), true, a);
    }
  });

  it("rejects loopback, private, link-local, CGNAT, and reserved addresses", () => {
    for (const a of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "255.255.255.255",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
    ]) {
      assert.equal(isPublicAddress(a), false, a);
    }
  });

  it("rejects non-IP input", () => {
    assert.equal(isPublicAddress("example.com"), false);
    assert.equal(isPublicAddress(""), false);
  });
});

describe("isValidHostname", () => {
  it("accepts domain names", () => {
    for (const h of ["example.com", "www.example.co.uk", "xn--bcher-kva.example"]) {
      assert.equal(isValidHostname(h), true, h);
    }
  });

  it("rejects IP literals, single labels, and junk", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "[::1]",
      "",
      "exa mple.com",
      "-bad.com",
      "a..com",
      "<img src=x onerror=alert(1)>",
    ]) {
      assert.equal(isValidHostname(h), false, h);
    }
  });
});

describe("guardedLookup", () => {
  it("refuses hostnames that resolve to loopback", (_, done) => {
    guardedLookup("localhost", {}, (err) => {
      assert.equal(err?.code, "ERR_NON_PUBLIC_ADDRESS");
      done();
    });
  });
});

describe("guardedConnect", () => {
  // Node skips DNS lookup for IP-literal hosts, so a lookup hook alone never
  // sees them: a link, script, or redirect to http://127.0.0.1/ got through.
  it("refuses IP-literal hosts in non-public ranges, which skip DNS lookup", async () => {
    const server = http.createServer((_req, res) => res.end("secret"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const dispatcher = new Agent({ connect: guardedConnect });
    try {
      for (const host of ["127.0.0.1", "[::ffff:127.0.0.1]"]) {
        await assert.rejects(
          fetch(`http://${host}:${port}/`, { dispatcher }),
          (err: Error & { cause?: NodeJS.ErrnoException }) => {
            assert.equal(err.cause?.code, "ERR_NON_PUBLIC_ADDRESS");
            return true;
          },
        );
      }
    } finally {
      await dispatcher.close();
      server.close();
    }
  });

  it("still refuses hostnames that resolve to non-public addresses", async () => {
    const dispatcher = new Agent({ connect: guardedConnect });
    try {
      await assert.rejects(
        fetch("http://localhost:8080/", { dispatcher }),
        (err: Error & { cause?: NodeJS.ErrnoException }) => {
          assert.equal(err.cause?.code, "ERR_NON_PUBLIC_ADDRESS");
          return true;
        },
      );
    } finally {
      await dispatcher.close();
    }
  });
});

describe("isLoopbackClient", () => {
  it("recognizes loopback clients", () => {
    assert.equal(isLoopbackClient("127.0.0.1"), true);
    assert.equal(isLoopbackClient("::1"), true);
    assert.equal(isLoopbackClient("::ffff:127.0.0.1"), true);
  });

  it("rejects other clients and missing addresses", () => {
    assert.equal(isLoopbackClient("192.168.1.10"), false);
    assert.equal(isLoopbackClient(undefined), false);
  });
});
