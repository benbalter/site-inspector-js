import dns from "node:dns/promises";
import net from "node:net";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

function testTcpConnection(host: string, port: number, family: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, family, timeout: 5000 }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export class Ipv6Check implements Check {
  name = "ipv6";

  async run(endpoint: EndpointData, domain: string): Promise<CheckResult> {
    let aaaaRecords: string[] = [];
    let aRecords: string[] = [];

    try {
      aaaaRecords = await dns.resolve6(domain);
    } catch {
      /* no AAAA records */
    }

    try {
      aRecords = await dns.resolve4(domain);
    } catch {
      /* no A records */
    }

    const hasIpv6 = aaaaRecords.length > 0;
    const hasIpv4 = aRecords.length > 0;
    const dualStack = hasIpv4 && hasIpv6;

    // Test IPv6 connectivity if records exist
    let ipv6Reachable = false;
    if (hasIpv6) {
      const port = new URL(endpoint.url).protocol === "https:" ? 443 : 80;
      ipv6Reachable = await testTcpConnection(aaaaRecords[0], port, 6);
    }

    return {
      name: this.name,
      data: {
        hasIpv6,
        hasIpv4,
        dualStack,
        ipv6Reachable,
        aaaaRecords,
        addressCount: aaaaRecords.length,
      },
    };
  }
}
