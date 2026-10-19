import { describe, expect, it } from "vitest";
import { fromBase64Url, sha256Bytes, toBase64Url } from "./bytes";
import {
  checkAssertion,
  checkBinding,
  type PasskeyRelyingParty,
  rawEcdsaSignature,
  readAuthenticatorData,
} from "./passkeys";

/**
 * Passkeys (RFC 0037). The point of these tests is that the happy path really verifies: a key is
 * made here, an authenticator's bytes are built by hand, signed with that key, and checked. A test
 * that only proved the refusals would pass just as well against a `verify` that always said no.
 */

const RP: PasskeyRelyingParty = { origin: "https://terrakin.org", id: "terrakin.org" };
const FLAG_UP = 0x01;
const FLAG_AT = 0x40;

/** Authenticator data as an authenticator lays it out: the RP id hash, flags, then the counter. */
async function authenticatorData(
  options: { rpId?: string; flags?: number; signCount?: number; extra?: number } = {},
) {
  const hash = await sha256Bytes(new TextEncoder().encode(options.rpId ?? RP.id));
  const extra = options.extra ?? 0;
  const bytes = new Uint8Array(37 + extra);
  bytes.set(hash, 0);
  bytes[32] = options.flags ?? FLAG_UP;
  new DataView(bytes.buffer).setUint32(33, options.signCount ?? 0, false);
  return bytes;
}

const clientDataOf = (type: string, challenge: Uint8Array, origin = RP.origin) =>
  toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ type, challenge: toBase64Url(challenge), origin, crossOrigin: false }),
    ),
  );

/** Web Crypto signs ECDSA raw; a real authenticator sends DER, so the test wraps it as one would. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const half = (bytes: Uint8Array) => {
    let at = 0;
    while (at < bytes.length - 1 && bytes[at] === 0) at++;
    const trimmed = bytes.subarray(at);
    // DER integers are signed, so a high bit takes a leading zero.
    const body = (trimmed[0] as number) & 0x80 ? [0, ...trimmed] : [...trimmed];
    return [0x02, body.length, ...body];
  };
  const body = [...half(raw.subarray(0, 32)), ...half(raw.subarray(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

async function authenticator() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const sign = async (authData: Uint8Array, clientData: string) => {
    const bytes = fromBase64Url(clientData) as Uint8Array<ArrayBuffer>;
    const signed = new Uint8Array(authData.length + 32);
    signed.set(authData, 0);
    signed.set(await sha256Bytes(bytes), authData.length);
    const raw = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, signed),
    );
    return toBase64Url(rawToDer(raw));
  };
  return { spki, sign };
}

const challenge = () => crypto.getRandomValues(new Uint8Array(32));

describe("binding a passkey", () => {
  it("takes a credential made over the challenge we issued, from our own origin", async () => {
    const { spki } = await authenticator();
    const ask = challenge();
    const authData = await authenticatorData({ flags: FLAG_UP | FLAG_AT, signCount: 7 });
    const result = await checkBinding(
      {
        clientData: clientDataOf("webauthn.create", ask),
        authenticatorData: toBase64Url(authData),
        credentialId: toBase64Url(new Uint8Array([1, 2, 3, 4])),
        publicKey: toBase64Url(spki),
        algorithm: -7,
      },
      { challenge: ask, rp: RP },
    );
    expect(result).toMatchObject({ ok: true, value: { algorithm: -7, signCount: 7 } });
  });

  it("refuses a ceremony that isn't the one we asked for", async () => {
    const { spki } = await authenticator();
    const ask = challenge();
    const good = {
      authenticatorData: toBase64Url(await authenticatorData({ flags: FLAG_UP | FLAG_AT })),
      credentialId: toBase64Url(new Uint8Array([1])),
      publicKey: toBase64Url(spki),
      algorithm: -7,
    };
    const why = async (over: Record<string, unknown>) => {
      const r = await checkBinding(
        { ...good, clientData: clientDataOf("webauthn.create", ask), ...over } as Parameters<
          typeof checkBinding
        >[0],
        { challenge: ask, rp: RP },
      );
      return r.ok ? "ok" : r.why;
    };
    // A sign-in's ceremony replayed as a binding, someone else's challenge, a lookalike origin.
    expect(await why({ clientData: clientDataOf("webauthn.get", ask) })).toBe("wrong_type");
    expect(await why({ clientData: clientDataOf("webauthn.create", challenge()) })).toBe(
      "wrong_challenge",
    );
    expect(
      await why({ clientData: clientDataOf("webauthn.create", ask, "https://terrak1n.org") }),
    ).toBe("wrong_origin");
    // Another site's authenticator data, and one with nobody present.
    expect(
      await why({
        authenticatorData: toBase64Url(
          await authenticatorData({ rpId: "example.com", flags: FLAG_UP | FLAG_AT }),
        ),
      }),
    ).toBe("wrong_relying_party");
    expect(
      await why({ authenticatorData: toBase64Url(await authenticatorData({ flags: FLAG_AT })) }),
    ).toBe("not_present");
    // A binding with no attested credential data is not a registration.
    expect(
      await why({ authenticatorData: toBase64Url(await authenticatorData({ flags: FLAG_UP })) }),
    ).toBe("bad_authenticator_data");
    expect(await why({ algorithm: -8 })).toBe("bad_key");
    expect(await why({ publicKey: toBase64Url(new Uint8Array([9, 9, 9])) })).toBe("bad_key");
    expect(await why({ credentialId: "not base64url!" })).toBe("bad_encoding");
    expect(await why({ clientData: toBase64Url(new TextEncoder().encode("{")) })).toBe(
      "bad_client_data",
    );
  });
});

describe("signing in with a passkey", () => {
  it("takes an assertion the stored key really signed, and refuses a tampered one", async () => {
    const { spki, sign } = await authenticator();
    const ask = challenge();
    const authData = await authenticatorData({ signCount: 12 });
    const clientData = clientDataOf("webauthn.get", ask);
    const signature = await sign(authData, clientData);
    const stored = { publicKey: spki, algorithm: -7 as const };

    expect(
      await checkAssertion(
        { clientData, authenticatorData: toBase64Url(authData), signature },
        stored,
        { challenge: ask, rp: RP },
      ),
    ).toMatchObject({ ok: true, value: { signCount: 12 } });

    // One flipped byte of the signature, and a counter changed after signing: both must fail, and
    // the second is the one that proves the signature covers the authenticator data.
    const bent = fromBase64Url(signature) as Uint8Array;
    bent[bent.length - 1] = ((bent[bent.length - 1] as number) + 1) % 256;
    expect(
      await checkAssertion(
        { clientData, authenticatorData: toBase64Url(authData), signature: toBase64Url(bent) },
        stored,
        { challenge: ask, rp: RP },
      ),
    ).toMatchObject({ ok: false, why: "bad_signature" });

    const moved = await authenticatorData({ signCount: 99 });
    expect(
      await checkAssertion(
        { clientData, authenticatorData: toBase64Url(moved), signature },
        stored,
        { challenge: ask, rp: RP },
      ),
    ).toMatchObject({ ok: false, why: "bad_signature" });
  });

  it("refuses another key's assertion", async () => {
    const mine = await authenticator();
    const theirs = await authenticator();
    const ask = challenge();
    const authData = await authenticatorData();
    const clientData = clientDataOf("webauthn.get", ask);
    expect(
      await checkAssertion(
        {
          clientData,
          authenticatorData: toBase64Url(authData),
          signature: await theirs.sign(authData, clientData),
        },
        { publicKey: mine.spki, algorithm: -7 },
        { challenge: ask, rp: RP },
      ),
    ).toMatchObject({ ok: false, why: "bad_signature" });
  });
});

describe("the bytes these checks walk", () => {
  it("reads no authenticator data shorter than its header, at any length", async () => {
    const whole = await authenticatorData({ extra: 20 });
    for (let n = 0; n < 37; n++)
      expect(readAuthenticatorData(whole.subarray(0, n))).toBeUndefined();
    expect(readAuthenticatorData(whole)).toMatchObject({ flags: FLAG_UP, signCount: 0 });
    // A counter past 2^31 reads unsigned, not negative.
    const high = await authenticatorData({ signCount: 4_000_000_000 });
    expect(readAuthenticatorData(high)?.signCount).toBe(4_000_000_000);
  });

  it("takes r and s out of a DER signature, padding each one back to 32 bytes", () => {
    const der = (r: number[], s: number[]) =>
      new Uint8Array([0x30, 4 + r.length + s.length, 0x02, r.length, ...r, 0x02, s.length, ...s]);
    // A short r (DER trims leading zeros) lands at the end of its half, zero-padded in front.
    const short = rawEcdsaSignature(der([0x01], [0x02])) as Uint8Array;
    expect(short.length).toBe(64);
    expect(short[31]).toBe(1);
    expect(short[63]).toBe(2);
    expect([...short.subarray(0, 31)].every((b) => b === 0)).toBe(true);
    // A leading zero added to keep a high-bit value positive is dropped, not kept as data.
    const padded = rawEcdsaSignature(der([0x00, 0xff, ...Array(31).fill(0x11)], [0x03]));
    expect(padded?.[0]).toBe(0xff);
    // Nothing that isn't such a sequence comes back.
    expect(rawEcdsaSignature(new Uint8Array(0))).toBeUndefined();
    expect(rawEcdsaSignature(new Uint8Array([0x31, 6, 0x02, 1, 1, 0x02, 1, 2]))).toBeUndefined();
    expect(rawEcdsaSignature(der([0x01], [0x02]).subarray(0, 6))).toBeUndefined();
    // A length claiming more than the buffer holds, and r longer than a P-256 integer.
    expect(rawEcdsaSignature(new Uint8Array([0x30, 6, 0x02, 40, 1, 0x02, 1, 2]))).toBeUndefined();
    expect(rawEcdsaSignature(der(Array(33).fill(0x11), [0x02]))).toBeUndefined();
  });

  it("never throws on random bytes, and never returns a wrong size", () => {
    const sizes = new Set<number | undefined>();
    for (let n = 0; n < 2000; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n % 80));
      const out = rawEcdsaSignature(bytes);
      sizes.add(out?.length);
    }
    expect([...sizes].every((size) => size === undefined || size === 64)).toBe(true);
    // And a real signature corrupted a byte at a time still only ever parses or refuses.
    const good = new Uint8Array([0x30, 6, 0x02, 1, 0x11, 0x02, 1, 0x22]);
    for (let i = 0; i < good.length; i++) {
      for (const value of [0, 1, 0x7f, 0x80, 0xff]) {
        const bent = Uint8Array.from(good);
        bent[i] = value;
        const out = rawEcdsaSignature(bent);
        expect(out === undefined || out.length === 64).toBe(true);
      }
    }
  });
});
