/**
 * Node only (main.ts): fetching agent cards (RFC 0007) without reaching a private network. A card
 * host name could resolve to a public address when we ask and a private one when we connect (DNS
 * rebinding), so the check runs on the lookup the connection itself uses: `publicLookup` is the
 * `connect.lookup` of the undici Agent behind `cardFetch`. `publicHost` asks first as well, so a
 * private host is refused before any request starts. The Worker never imports this file; it can't
 * reach private networks at all.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { isPrivateAddress } from "./agent-card";

type Lookup = typeof dnsLookup;
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** The refusal a private address gets. */
function privateError(hostname: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(`Refusing a private address for ${hostname}`);
  err.code = "ENOTFOUND";
  return err;
}

/**
 * A `dns.lookup` that answers only when every address the name has is public. Shaped for undici's
 * `connect.lookup`, which may ask for one address or all of them.
 */
export function publicLookup(lookup: Lookup = dnsLookup) {
  return (
    hostname: string,
    options: { all?: boolean; family?: number },
    callback: LookupCallback,
  ) => {
    lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        callback(err, []);
        return;
      }
      const list = addresses as LookupAddress[];
      if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
        callback(privateError(hostname), []);
        return;
      }
      if (options.all) {
        callback(null, list);
        return;
      }
      const [first] = list;
      callback(null, first?.address ?? "", first?.family);
    });
  };
}

/** Whether every address a host name resolves to is public. */
export function publicHost(lookup: Lookup = dnsLookup) {
  const check = publicLookup(lookup);
  return (hostname: string) =>
    new Promise<boolean>((resolve) => {
      check(hostname, { all: true }, (err) => resolve(err === null));
    });
}

/** `fetch` for cards on Node: every connection's address passes `publicLookup`. */
export function cardFetch(lookup: Lookup = dnsLookup): typeof fetch {
  const dispatcher = new Agent({ connect: { lookup: publicLookup(lookup) as never } });
  return ((input: string | URL | Request, init?: RequestInit) =>
    undiciFetch(input as never, { ...(init as object), dispatcher } as never)) as typeof fetch;
}
