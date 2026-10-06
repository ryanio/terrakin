import type { lookup as dnsLookup, LookupAddress } from "node:dns";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { cardFetch, publicHost, publicLookup } from "./node-net";

/** A stand-in for `dns.lookup` that answers from a table. */
function stubLookup(table: Record<string, string[]>) {
  return ((hostname: string, _options: unknown, callback: (...args: unknown[]) => void) => {
    const found = table[hostname];
    if (!found) {
      const err: NodeJS.ErrnoException = new Error("not found");
      err.code = "ENOTFOUND";
      callback(err, []);
      return;
    }
    callback(
      null,
      found.map((address): LookupAddress => ({ address, family: address.includes(":") ? 6 : 4 })),
    );
  }) as unknown as typeof dnsLookup;
}

const table = {
  "cards.example": ["93.184.216.34", "2606:2800:220:1::1"],
  "rebind.example": ["93.184.216.34", "10.0.0.7"],
  "metadata.example": ["169.254.169.254"],
  "site.example": ["192.0.0.8"],
  "old.example": ["fec0::1"],
};

describe("the card host's addresses on Node", () => {
  it("answers a connection's lookup only when every address is public", async () => {
    const lookup = publicLookup(stubLookup(table));
    const ask = (host: string, all: boolean) =>
      new Promise<{ err: unknown; address: unknown }>((resolve) =>
        lookup(host, { all }, (err, address) => resolve({ err, address })),
      );
    expect(await ask("cards.example", false)).toEqual({ err: null, address: "93.184.216.34" });
    expect((await ask("cards.example", true)).address).toHaveLength(2);
    for (const host of ["rebind.example", "metadata.example", "site.example", "old.example"]) {
      expect((await ask(host, false)).err, host).toBeInstanceOf(Error);
    }
    expect((await ask("missing.example", false)).err).toBeInstanceOf(Error);
  });

  it("refuses private hosts before asking for a card", async () => {
    const allowed = publicHost(stubLookup(table));
    expect(await allowed("cards.example")).toBe(true);
    expect(await allowed("rebind.example")).toBe(false);
    expect(await allowed("missing.example")).toBe(false);
  });
});

describe("cardFetch", () => {
  it("checks the address each connection uses, so a name that resolves to a private address is refused", async () => {
    const server = createServer((_req, res) => res.end("{}"));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as AddressInfo).port;
    try {
      const asked: string[] = [];
      const lookup = stubLookup({ "card.example": ["127.0.0.1"] });
      const counting = ((
        host: string,
        options: unknown,
        callback: (...args: unknown[]) => void,
      ) => {
        asked.push(host);
        (lookup as unknown as (...args: unknown[]) => void)(host, options, callback);
      }) as unknown as typeof dnsLookup;
      await expect(cardFetch(counting)(`http://card.example:${port}/`)).rejects.toThrow();
      expect(asked).toContain("card.example");
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
