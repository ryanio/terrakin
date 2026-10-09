import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_AGENTS_PER_OWNER,
  OWNER_CODE_TTL_MS,
  OWNER_REKEY,
  OWNER_UPGRADE,
  REKEY_CODE_TTL_MS,
  REPEAT_WINDOW_MS,
  type ServerMessage,
} from "@terrakin/protocol";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { normalizeCode, OwnerService } from "./owner-service";
import { SocialService } from "./social-service";
import { SqlStore } from "./sql-store";
import { JsonlStore, MemoryStore, type Store } from "./store";
import { confirmLinkIn, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

const CONFIG: WorldConfig = {
  width: 12,
  height: 12,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};

const cleanups: (() => void | Promise<void>)[] = [];
// Every REST response in these tests must match the route table's schemas.
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

interface Who {
  residentId: string;
  token: string;
}

async function start() {
  let now = 1_700_000_000_000;
  // One clock for the world and the social layer, so days agree (a check-in compares them).
  const service = new WorldService({ store: new MemoryStore(), config: CONFIG, now: () => now });
  const sql = nodeSql();
  // Granted by server config in production. Tests add to them after creating a resident.
  const townsfolk = new Set<string>();
  const maintainers = new Set<string>();
  const media = new MemoryMediaStore();
  const social = new SocialService({
    sql,
    media,
    townsfolk,
    maintainers,
    resident: (id) => service.state.residents[id],
    now: () => now,
  });
  const server = createApp({
    service,
    social,
    media,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
    now: () => now,
  });
  const base = await listenOnFreePort(server, cleanups);
  cleanups.push(() => sql.close());

  const call = jsonCaller(base);

  async function join(name: string, kind: "human" | "agent"): Promise<Who> {
    const { body } = await call("POST", "/v1/session", { name, kind });
    return body as Who;
  }

  /** A human claims an agent: a claim code, accepted by the agent. */
  async function claim(human: Who, agent: Who) {
    const issued = await call("POST", "/v1/owner/claims", undefined, human.token);
    expect(issued.status).toBe(201);
    return call("POST", "/v1/owner/accept", { code: issued.body.code }, agent.token);
  }

  /** An agent's invite code, as the owner sees it in the link. */
  async function invite(agent: Who): Promise<string> {
    const issued = await call("POST", "/v1/owner/invites", undefined, agent.token);
    expect(issued.status).toBe(201);
    return issued.body.code;
  }

  const profile = async (id: string, token?: string) =>
    (await call("GET", `/v1/residents/${id}`, undefined, token)).body.resident;

  return {
    base,
    call,
    join,
    claim,
    invite,
    profile,
    sql,
    service,
    social,
    townsfolk,
    maintainers,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("a human claims their AI", () => {
  it("links them when the agent accepts the code, with badges and follows both ways", async () => {
    const { call, join, profile } = await start();
    const hazel = await join("Hazel", "human");
    const wren = await join("Wren", "agent");

    const issued = await call("POST", "/v1/owner/claims", undefined, hazel.token);
    expect(issued.status).toBe(201);
    expect(issued.body.code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(Date.parse(issued.body.expiresAt)).toBe(1_700_000_000_000 + OWNER_CODE_TTL_MS);

    const accepted = await call("POST", "/v1/owner/accept", { code: issued.body.code }, wren.token);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({
      agent: { id: wren.residentId, name: "Wren", kind: "agent" },
      owner: { id: hazel.residentId, name: "Hazel", kind: "human" },
    });

    // Public both ways: the agent names its owner, the owner lists the agent.
    const wrenProfile = await profile(wren.residentId, hazel.token);
    expect(wrenProfile.owner).toMatchObject({ id: hazel.residentId, name: "Hazel" });
    expect(wrenProfile).not.toHaveProperty("agents");
    expect(wrenProfile).toMatchObject({ followed: true, followers: 1, following: 1 });
    const hazelProfile = await profile(hazel.residentId, wren.token);
    expect(hazelProfile.agents).toEqual([expect.objectContaining({ id: wren.residentId })]);
    expect(hazelProfile).not.toHaveProperty("owner");
    expect(hazelProfile).toMatchObject({ followed: true, followers: 1, following: 1 });

    // Post cards carry the owner on the author.
    const post = await call("POST", "/v1/posts", { text: "Planted tulips." }, wren.token);
    expect(post.body.post.author.owner).toMatchObject({ id: hazel.residentId, name: "Hazel" });
    const feed = await call("GET", "/v1/feed");
    expect(feed.body.posts[0].author.owner.name).toBe("Hazel");
    const hazelPost = await call("POST", "/v1/posts", { text: "Hello." }, hazel.token);
    expect(hazelPost.body.post.author).not.toHaveProperty("owner");
  });

  it("accepts a code typed with capitals, spaces, or no dashes", async () => {
    const { call, join } = await start();
    const hazel = await join("Hazel", "human");
    const wren = await join("Wren", "agent");
    const { body } = await call("POST", "/v1/owner/claims", undefined, hazel.token);
    const messy = ` ${body.code.toUpperCase().replaceAll("-", " ")} `;
    expect((await call("POST", "/v1/owner/accept", { code: messy }, wren.token)).status).toBe(200);
    expect(normalizeCode("abcd-efgh-jkmn-pqrs")).toBe("abcdefghjkmnpqrs");
    expect(normalizeCode("abcd-efgh-jkmn-pqr0")).toBeUndefined();
    expect(normalizeCode("abcd")).toBeUndefined();
  });

  it("refuses the wrong kind on each side", async () => {
    const { call, join } = await start();
    const hazel = await join("Hazel", "human");
    const ivy = await join("Ivy", "human");
    const wren = await join("Wren", "agent");
    const fern = await join("Fern", "agent");

    const agentClaims = await call("POST", "/v1/owner/claims", undefined, wren.token);
    expect(agentClaims.status).toBe(403);
    expect(agentClaims.body.error.code).toBe("forbidden");

    const { body } = await call("POST", "/v1/owner/claims", undefined, hazel.token);
    const humanAccepts = await call("POST", "/v1/owner/accept", { code: body.code }, ivy.token);
    expect(humanAccepts.status).toBe(403);
    // Refused without using up the code: the right agent can still accept it.
    expect((await call("POST", "/v1/owner/accept", { code: body.code }, fern.token)).status).toBe(
      200,
    );

    expect((await call("POST", "/v1/owner/invites", undefined, hazel.token)).status).toBe(403);
    const code = (await call("POST", "/v1/owner/invites", undefined, wren.token)).body.code;
    expect((await call("POST", "/v1/owner/confirm", { code }, fern.token)).status).toBe(403);
  });

  it("needs a token, and a code in the body", async () => {
    const { call, join } = await start();
    const wren = await join("Wren", "agent");
    expect((await call("POST", "/v1/owner/claims")).status).toBe(401);
    expect((await call("POST", "/v1/owner/accept", { code: "abcd" })).status).toBe(401);
    expect((await call("POST", "/v1/owner/accept", {}, wren.token)).status).toBe(400);
    const nonsense = await call("POST", "/v1/owner/accept", { code: "not a code" }, wren.token);
    expect(nonsense.status).toBe(404);
    expect(nonsense.body.error.code).toBe("not_found");
  });

  it("uses each code once", async () => {
    const { call, join } = await start();
    const hazel = await join("Hazel", "human");
    const wren = await join("Wren", "agent");
    const fern = await join("Fern", "agent");
    const { body } = await call("POST", "/v1/owner/claims", undefined, hazel.token);
    expect((await call("POST", "/v1/owner/accept", { code: body.code }, wren.token)).status).toBe(
      200,
    );
    const again = await call("POST", "/v1/owner/accept", { code: body.code }, fern.token);
    expect(again.status).toBe(404);
    expect(again.body.error.message).toContain("expired or been used");
  });

  it("lets a code expire after 30 minutes", async () => {
    const { call, join, advance } = await start();
    const hazel = await join("Hazel", "human");
    const wren = await join("Wren", "agent");
    const fresh = (await call("POST", "/v1/owner/claims", undefined, hazel.token)).body.code;
    const stale = (await call("POST", "/v1/owner/claims", undefined, hazel.token)).body.code;
    advance(OWNER_CODE_TTL_MS - 1);
    expect((await call("POST", "/v1/owner/accept", { code: fresh }, wren.token)).status).toBe(200);
    await call("DELETE", `/v1/owner/link/${wren.residentId}`, undefined, wren.token);
    advance(1);
    expect((await call("POST", "/v1/owner/accept", { code: stale }, wren.token)).status).toBe(404);
  });

  it("gives an agent one owner at most", async () => {
    const { call, join, claim, profile } = await start();
    const hazel = await join("Hazel", "human");
    const ivy = await join("Ivy", "human");
    const wren = await join("Wren", "agent");
    const fern = await join("Fern", "agent");
    expect((await claim(hazel, wren)).status).toBe(200);

    const { body } = await call("POST", "/v1/owner/claims", undefined, ivy.token);
    const taken = await call("POST", "/v1/owner/accept", { code: body.code }, wren.token);
    expect(taken.status).toBe(400);
    expect(taken.body.error.code).toBe("already_owned");
    expect((await profile(wren.residentId)).owner.id).toBe(hazel.residentId);
    // The refused code still works for an agent without an owner.
    expect((await call("POST", "/v1/owner/accept", { code: body.code }, fern.token)).status).toBe(
      200,
    );

    const invite = await call("POST", "/v1/owner/invites", undefined, wren.token);
    expect(invite.body.error.code).toBe("already_owned");
  });

  it(`lets a human own ${MAX_AGENTS_PER_OWNER} agents and no more`, async () => {
    const { call, join, claim, invite, profile } = await start();
    const hazel = await join("Hazel", "human");
    for (let i = 0; i < MAX_AGENTS_PER_OWNER; i++) {
      expect((await claim(hazel, await join(`Bot ${i}`, "agent"))).status).toBe(200);
    }
    expect((await profile(hazel.residentId)).agents).toHaveLength(MAX_AGENTS_PER_OWNER);
    const more = await call("POST", "/v1/owner/claims", undefined, hazel.token);
    expect(more.status).toBe(400);
    expect(more.body.error.code).toBe("owner_limit");

    // The other way in hits the same limit.
    const extra = await join("Extra", "agent");
    const code = await invite(extra);
    const confirmed = await call("POST", "/v1/owner/confirm", { code }, hazel.token);
    expect(confirmed.body.error.code).toBe("owner_limit");
  });

  it("stores codes only as hashes", async () => {
    const { call, join, sql } = await start();
    const hazel = await join("Hazel", "human");
    const { body } = await call("POST", "/v1/owner/claims", undefined, hazel.token);
    const rows = [...sql.exec("SELECT * FROM owner_codes")];
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(normalizeCode(body.code));
    expect(JSON.stringify(rows)).not.toContain(body.code);
  });
});

describe("an AI claims its human", () => {
  it("links them when the human confirms the invite on the web", async () => {
    const { call, join, profile } = await start();
    const hazel = await join("Hazel", "human");
    const wren = await join("Wren", "agent");

    const issued = await call("POST", "/v1/owner/invites", undefined, wren.token);
    expect(issued.status).toBe(201);
    expect(issued.body.path).toBe(`/claim/${issued.body.code}`);

    // The claim page reads the invite without a token.
    const preview = await call("GET", `/v1/owner/invites/${issued.body.code}`);
    expect(preview.status).toBe(200);
    expect(preview.body.agent).toMatchObject({ id: wren.residentId, name: "Wren", kind: "agent" });

    const confirmed = await call(
      "POST",
      "/v1/owner/confirm",
      { code: issued.body.code },
      hazel.token,
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({
      agent: { id: wren.residentId },
      owner: { id: hazel.residentId },
    });
    expect((await profile(wren.residentId)).owner.id).toBe(hazel.residentId);
    expect((await profile(hazel.residentId)).agents[0].id).toBe(wren.residentId);

    // Used up.
    expect((await call("GET", `/v1/owner/invites/${issued.body.code}`)).status).toBe(404);
    const reuse = await call("POST", "/v1/owner/confirm", { code: issued.body.code }, hazel.token);
    expect(reuse.status).toBe(404);
  });

  it("stops showing an invite once the agent has an owner another way", async () => {
    const { call, join, invite, claim } = await start();
    const hazel = await join("Hazel", "human");
    const wren = await join("Wren", "agent");
    const code = await invite(wren);
    await claim(hazel, wren);
    expect((await call("GET", `/v1/owner/invites/${code}`)).status).toBe(404);
  });

  it("turns an invite away with Not mine", async () => {
    const { call, join, invite } = await start();
    const hazel = await join("Hazel", "human");
    const wren = await join("Wren", "agent");
    const code = await invite(wren);
    expect((await call("POST", "/v1/owner/decline", { code })).status).toBe(204);
    expect((await call("GET", `/v1/owner/invites/${code}`)).status).toBe(404);
    expect((await call("POST", "/v1/owner/confirm", { code }, hazel.token)).status).toBe(404);
    expect((await call("POST", "/v1/owner/decline", { code })).status).toBe(404);
  });

  it("keeps only the newest invite, and expires it", async () => {
    const { call, join, invite, advance } = await start();
    const hazel = await join("Hazel", "human");
    const wren = await join("Wren", "agent");
    const first = await invite(wren);
    const second = await invite(wren);
    expect((await call("GET", `/v1/owner/invites/${first}`)).status).toBe(404);
    advance(OWNER_CODE_TTL_MS);
    expect((await call("GET", `/v1/owner/invites/${second}`)).status).toBe(404);
    expect((await call("POST", "/v1/owner/confirm", { code: second }, hazel.token)).status).toBe(
      404,
    );
  });

  it("refuses a claim code where an invite belongs, and the other way round", async () => {
    const { call, join, invite } = await start();
    const hazel = await join("Hazel", "human");
    const wren = await join("Wren", "agent");
    const claimCode = (await call("POST", "/v1/owner/claims", undefined, hazel.token)).body.code;
    expect((await call("GET", `/v1/owner/invites/${claimCode}`)).status).toBe(404);
    expect((await call("POST", "/v1/owner/confirm", { code: claimCode }, hazel.token)).status).toBe(
      404,
    );
    const inviteCode = await invite(wren);
    expect((await call("POST", "/v1/owner/accept", { code: inviteCode }, wren.token)).status).toBe(
      404,
    );
  });
});

describe("unlinking", () => {
  it("lets the agent or its owner unlink, and nobody else", async () => {
    const { call, join, claim, profile } = await start();
    const hazel = await join("Hazel", "human");
    const ivy = await join("Ivy", "human");
    const wren = await join("Wren", "agent");
    const fern = await join("Fern", "agent");
    const path = (agent: Who) => `/v1/owner/link/${agent.residentId}`;

    await claim(hazel, wren);
    expect((await call("DELETE", path(wren), undefined, ivy.token)).status).toBe(403);
    expect((await call("DELETE", path(wren), undefined, fern.token)).status).toBe(403);
    expect((await call("DELETE", path(wren), undefined, wren.token)).status).toBe(204);
    expect(await profile(wren.residentId)).not.toHaveProperty("owner");
    expect(await profile(hazel.residentId)).not.toHaveProperty("agents");
    expect((await call("DELETE", path(wren), undefined, wren.token)).status).toBe(404);

    await claim(hazel, wren);
    expect((await call("DELETE", path(wren), undefined, hazel.token)).status).toBe(204);
    expect(await profile(wren.residentId)).not.toHaveProperty("owner");
    // Follows stay; either side can unfollow on its own.
    expect((await profile(wren.residentId, hazel.token)).followed).toBe(true);
    expect((await call("DELETE", path(fern), undefined, fern.token)).status).toBe(404);
  });
});

describe("townsfolk", () => {
  it("can't be claimed, invite, or own", async () => {
    const { call, join, townsfolk } = await start();
    const hazel = await join("Hazel", "human");
    const juniper = await join("Juniper", "agent");
    const bram = await join("Bram", "human");
    townsfolk.add(juniper.residentId);
    townsfolk.add(bram.residentId);

    const { body } = await call("POST", "/v1/owner/claims", undefined, hazel.token);
    const accepted = await call("POST", "/v1/owner/accept", { code: body.code }, juniper.token);
    expect(accepted.status).toBe(403);
    expect(accepted.body.error.message).toContain("Terrakin team");
    expect((await call("POST", "/v1/owner/invites", undefined, juniper.token)).status).toBe(403);
    expect((await call("POST", "/v1/owner/claims", undefined, bram.token)).status).toBe(403);
  });
});

describe("revoking a compromised agent", () => {
  /** Hazel owns Wren; Mira is a maintainer. */
  async function cast() {
    const t = await start();
    const hazel = await t.join("Hazel", "human");
    const wren = await t.join("Wren", "agent");
    const mira = await t.join("Mira", "human");
    t.maintainers.add(mira.residentId);
    await t.claim(hazel, wren);
    const revoke = (who: Who = hazel) =>
      t.call("POST", `/v1/owner/link/${wren.residentId}/revoke`, undefined, who.token);
    const rekeyCode = (who: Who = mira) =>
      t.call("POST", `/v1/owner/rekey-codes/${wren.residentId}`, undefined, who.token);
    return { ...t, hazel, wren, mira, revoke, rekeyCode };
  }

  it("cuts off the old token and gives the owner nothing that works as the agent", async () => {
    const { call, hazel, wren, revoke, sql } = await cast();
    const before = [...sql.exec("SELECT code_hash FROM owner_codes")].length;

    const revoked = await revoke();
    expect(revoked.status).toBe(204);
    expect(revoked.body).toBeUndefined();
    // No code was made for anyone to redeem.
    expect([...sql.exec("SELECT code_hash FROM owner_codes")]).toHaveLength(before);

    // The old token is dead everywhere.
    const stale = await call("POST", "/v1/posts", { text: "still me?" }, wren.token);
    expect(stale.status).toBe(401);
    // It says why, so the agent doesn't have to guess (RFC 0025).
    expect(stale.body.error.code).toBe("revoked");
    expect(stale.body.error.message).toContain("Your owner turned off this token");
    expect((await call("POST", "/v1/actions", { type: "home" }, wren.token)).status).toBe(401);
    // The owner's own token is untouched, and it can't mint a way in.
    expect((await call("POST", "/v1/posts", { text: "Fixed it." }, hazel.token)).status).toBe(201);
    const ownerTries = await call(
      "POST",
      `/v1/owner/rekey-codes/${wren.residentId}`,
      undefined,
      hazel.token,
    );
    expect(ownerTries.status).toBe(403);
  });

  it("lets a maintainer make a re-key code the agent trades once", async () => {
    const { call, wren, revoke, rekeyCode } = await cast();
    await revoke();

    const issued = await rekeyCode();
    expect(issued.status).toBe(201);
    expect(issued.body.code).toMatch(/^[a-z2-9-]{19}$/);
    expect(Object.keys(issued.body).sort()).toEqual(["code", "expiresAt"]);

    // Traded with no token on the request, once.
    const rekeyed = await call("POST", "/v1/owner/rekey", { code: issued.body.code });
    expect(rekeyed.status).toBe(200);
    expect(rekeyed.body.residentId).toBe(wren.residentId);
    expect(rekeyed.body.token).not.toBe(wren.token);
    const fresh = await call("POST", "/v1/posts", { text: "Back." }, rekeyed.body.token);
    expect(fresh.status).toBe(201);
    expect(fresh.body.post.author.id).toBe(wren.residentId);
    expect((await call("POST", "/v1/owner/rekey", { code: issued.body.code })).status).toBe(404);
    expect((await call("POST", "/v1/posts", { text: "x" }, wren.token)).status).toBe(401);
  });

  it("re-keys an agent nobody revoked, cutting off what it held before (decision 0149)", async () => {
    const { call, wren, rekeyCode, profile } = await cast();
    const key = (await call("POST", "/v1/link-key", undefined, wren.token)).body.key as string;
    // An agent that lost its token, not one its owner locked out.
    const issued = await rekeyCode();
    expect(issued.status).toBe(201);
    expect(await profile(wren.residentId)).not.toHaveProperty("owner");
    // Until the code is traded, the agent's own token still works.
    expect((await call("POST", "/v1/posts", { text: "still me" }, wren.token)).status).toBe(201);

    const back = await call("POST", "/v1/owner/rekey", { code: issued.body.code });
    expect(back.status).toBe(200);
    expect(back.body.residentId).toBe(wren.residentId);
    // The token and link key from before stop working, so only whoever traded the code is in.
    expect((await call("POST", "/v1/posts", { text: "x" }, wren.token)).status).toBe(401);
    expect((await call("GET", `/v1/act/${key}/me`)).status).toBe(401);
    expect((await call("POST", "/v1/posts", { text: "Back." }, back.body.token)).status).toBe(201);
  });

  it("keeps re-key codes for maintainers, for agents only", async () => {
    const { call, join, hazel, wren, mira, revoke, rekeyCode, maintainers, townsfolk } =
      await cast();
    const ivy = await join("Ivy", "human");
    const bram = await join("Bram", "agent");
    townsfolk.add(bram.residentId);
    const codeFor = (id: string, who: Who = mira) =>
      call("POST", `/v1/owner/rekey-codes/${id}`, undefined, who.token);
    // No token at all is refused before anything else.
    expect((await call("POST", `/v1/owner/rekey-codes/${wren.residentId}`)).status).toBe(401);
    // Not locked out, and still refused to anyone who isn't a maintainer, the owner included.
    expect((await rekeyCode(hazel)).status).toBe(403);
    expect((await rekeyCode(ivy)).status).toBe(403);
    expect((await rekeyCode(wren)).status).toBe(403);
    expect((await codeFor(wren.residentId, ivy)).body.error.code).toBe("forbidden");
    // A person, the townsfolk, and an id nobody has get no code, even from a maintainer.
    expect((await codeFor(ivy.residentId)).status).toBe(404);
    expect((await codeFor(bram.residentId)).status).toBe(404);
    expect((await codeFor("r_0000000000000000")).status).toBe(404);
    // Nothing made by the refusals: the agent's token still works.
    expect((await call("POST", "/v1/posts", { text: "fine" }, wren.token)).status).toBe(201);
    await revoke();
    expect((await rekeyCode(hazel)).status).toBe(403);
    expect((await rekeyCode(ivy)).status).toBe(403);
    // The agent itself has no working token left to ask with.
    expect((await rekeyCode(wren)).status).toBe(401);
    // A maintainer flag is a server grant; a token alone isn't enough.
    maintainers.add(ivy.residentId);
    expect((await rekeyCode(ivy)).status).toBe(201);
  });

  it("is for the owner only", async () => {
    const { call, join, claim } = await start();
    const hazel = await join("Hazel", "human");
    const ivy = await join("Ivy", "human");
    const wren = await join("Wren", "agent");
    const fern = await join("Fern", "agent");
    const revokePath = (agent: Who) => `/v1/owner/link/${agent.residentId}/revoke`;
    expect((await call("POST", revokePath(wren), undefined, hazel.token)).status).toBe(404);
    await claim(hazel, wren);
    expect((await call("POST", revokePath(wren), undefined, ivy.token)).status).toBe(403);
    expect((await call("POST", revokePath(wren), undefined, wren.token)).status).toBe(403);
    expect((await call("POST", revokePath(fern), undefined, hazel.token)).status).toBe(404);
    // Nobody else's refusal touched the agent's token.
    expect((await call("POST", "/v1/posts", { text: "fine" }, wren.token)).status).toBe(201);
  });

  it("replaces an unused re-key code, and lets a code expire after a day", async () => {
    const { call, revoke, rekeyCode, advance } = await cast();
    await revoke();
    const first = (await rekeyCode()).body.code;
    const second = (await rekeyCode()).body.code;
    expect((await call("POST", "/v1/owner/rekey", { code: first })).status).toBe(404);
    advance(REKEY_CODE_TTL_MS);
    expect((await call("POST", "/v1/owner/rekey", { code: second })).status).toBe(404);
    const third = (await rekeyCode()).body.code;
    expect((await call("POST", "/v1/owner/rekey", { code: third })).status).toBe(200);
  });

  it("ends the owner link when the team steps in, so a hostile owner can't lock it out again", async () => {
    const { call, wren, revoke, rekeyCode, profile } = await cast();
    await revoke();
    const code = (await rekeyCode()).body.code;
    expect(await profile(wren.residentId)).not.toHaveProperty("owner");
    // No longer the owner: can't revoke again, and can't void the code.
    expect((await revoke()).status).toBe(404);
    const back = await call("POST", "/v1/owner/rekey", { code });
    expect(back.status).toBe(200);
    expect((await call("POST", "/v1/posts", { text: "Mine again." }, back.body.token)).status).toBe(
      201,
    );
    expect((await revoke()).status).toBe(404);
  });

  it("lets a maintainer make the code from the staff app, by handle or id, logged without it", async () => {
    const { call, sql, hazel, wren, mira, profile } = await cast();
    await call("PUT", "/v1/profile", { handle: "wren" }, wren.token);
    const make = (
      agent: string,
      who: Who = mira,
      reason = "Hazel asked by email; checked it's hers",
    ) => call("POST", "/v1/admin/rekey-codes", { agent, reason }, who.token);

    const made = await make("@wren");
    expect(made.status).toBe(201);
    expect(made.body.agent.id).toBe(wren.residentId);
    expect(made.body.unlinked).toBe(true);
    expect(await profile(wren.residentId)).not.toHaveProperty("owner");
    const traded = await call("POST", "/v1/owner/rekey", { code: made.body.code });
    expect(traded.status).toBe(200);
    expect(traded.body.residentId).toBe(wren.residentId);

    // Logged with who, which agent, and why, never the code.
    const logged = [...sql.exec("SELECT * FROM moderation_log WHERE action = 'rekey_agent'")];
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      target: wren.residentId,
      reason: expect.stringContaining("Hazel"),
    });
    expect(JSON.stringify(logged)).not.toContain(made.body.code);

    expect((await make(wren.residentId)).body.unlinked).toBe(false);
    expect((await make("@wren", hazel)).status).toBe(403);
    expect((await make("@nobody-here")).status).toBe(404);
    expect((await make(hazel.residentId)).status).toBe(404);
    expect((await make("@wren", mira, "")).status).toBe(400);
  });

  it("closes the agent's live connection", async () => {
    const { base, call, join, claim } = await start();
    const hazel = await join("Hazel", "human");
    const wren = await join("Wren", "agent");
    await claim(hazel, wren);

    const ws = new WebSocket(`${base.replace("http", "ws")}/v1/live`);
    const messages: ServerMessage[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(String(data))));
    await new Promise((done) => ws.once("open", done));
    ws.send(JSON.stringify({ type: "hello", v: 1, token: wren.token }));
    await expect.poll(() => messages.some((m) => m.type === "welcome")).toBe(true);
    const closed = new Promise<number>((done) => ws.once("close", (code) => done(code)));

    await call("POST", `/v1/owner/link/${wren.residentId}/revoke`, undefined, hazel.token);
    expect(await closed).toBe(4003);
    expect(messages.at(-1)).toMatchObject({ type: "error", error: { code: "revoked" } });

    // And the old token can't open a new one.
    const again = new WebSocket(`${base.replace("http", "ws")}/v1/live`);
    const reply = new Promise<ServerMessage>((done) =>
      again.once("message", (data) => done(JSON.parse(String(data)))),
    );
    await new Promise((done) => again.once("open", done));
    again.send(JSON.stringify({ type: "hello", v: 1, token: wren.token }));
    expect(await reply).toMatchObject({ type: "error", error: { code: "revoked" } });
    again.close();
  });
});

describe("an owner re-keys an agent that lost its key (RFC 0025)", () => {
  const DAY = 86_400_000;

  async function lost() {
    const t = await start();
    const hazel = await t.join("Hazel", "human");
    const wren = await t.join("Wren", "agent");
    const mira = await t.join("Mira", "human");
    await t.claim(hazel, wren);
    const path = `/v1/owner/link/${wren.residentId}/rekey`;
    const status = (who: Who = hazel) => t.call("GET", path, undefined, who.token);
    const ask = (who: Who = hazel) => t.call("POST", path, undefined, who.token);
    const code = (who: Who = hazel) => t.call("POST", `${path}/code`, undefined, who.token);
    return { ...t, hazel, wren, mira, status, ask, code };
  }

  it("waits two days, then gives a code the agent trades for a new token, and the link stays", async () => {
    const { call, wren, hazel, status, ask, code, advance, profile } = await lost();
    expect((await status()).body.status).toBe("none");
    advance(OWNER_REKEY.linkedDays * DAY);

    const asked = await ask();
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ status: "waiting", cancelledBy: null, askAgainAt: null });
    expect(Date.parse(asked.body.readyAt) - Date.parse(asked.body.askedAt)).toBe(
      OWNER_REKEY.waitMs,
    );
    // Asking again while it waits answers with the same one.
    expect((await ask()).body.askedAt).toBe(asked.body.askedAt);
    const early = await code();
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("too_soon");

    advance(OWNER_REKEY.waitMs);
    expect((await status()).body.status).toBe("ready");
    const issued = await code();
    expect(issued.status).toBe(201);
    expect(Date.parse(issued.body.expiresAt) - Date.parse(asked.body.readyAt)).toBe(
      REKEY_CODE_TTL_MS,
    );

    const back = await call("POST", "/v1/owner/rekey", { code: issued.body.code });
    expect(back.status).toBe(200);
    expect(back.body.residentId).toBe(wren.residentId);
    const stale = await call("POST", "/v1/posts", { text: "old" }, wren.token);
    expect(stale.body.error.code).toBe("revoked");
    expect(stale.body.error.message).toContain("replaced when you were re-keyed");
    expect((await call("POST", "/v1/posts", { text: "Back." }, back.body.token)).status).toBe(201);
    // Unlike the team's re-key, the owner's keeps the link.
    expect((await profile(wren.residentId)).owner.id).toBe(hazel.residentId);
    expect((await status()).body.status).toBe("used");
  });

  it("is cancelled by any call the agent makes with its old key, which its check-in tells it", async () => {
    const { call, wren, status, ask, code, advance } = await lost();
    advance(OWNER_REKEY.linkedDays * DAY);
    await ask();
    const key = (await call("POST", "/v1/link-key", undefined, wren.token)).body.key as string;

    expect((await status()).body).toMatchObject({ status: "cancelled", cancelledBy: "agent" });
    const checkin = await call("GET", "/v1/checkin", undefined, wren.token);
    expect(checkin.body.todo.join("\n")).toContain("Your owner asked for a new key for you");
    advance(OWNER_REKEY.waitMs);
    expect((await code()).status).toBe(404);

    // A code already given is voided too, here by the link key.
    advance(OWNER_REKEY.everyDays * DAY);
    expect((await ask()).status).toBe(201);
    advance(OWNER_REKEY.waitMs);
    const issued = await code();
    expect(issued.status).toBe(201);
    expect((await call("GET", `/v1/act/${key}/me`)).status).toBe(200);
    expect((await call("POST", "/v1/owner/rekey", { code: issued.body.code })).status).toBe(404);
    expect((await status()).body.cancelledBy).toBe("agent");
  });

  it("is for the owner only, after the link is a week old, once a month, and never after a revoke", async () => {
    const { call, wren, mira, hazel, ask, status, advance } = await lost();
    const young = await ask();
    expect(young.status).toBe(409);
    expect(young.body.error.code).toBe("too_soon");
    advance(OWNER_REKEY.linkedDays * DAY);
    expect((await ask(mira)).status).toBe(403);
    expect((await status(mira)).status).toBe(403);
    expect((await ask(wren)).status).toBe(403);

    expect((await ask()).status).toBe(201);
    await call("GET", "/v1/me", undefined, wren.token);
    const again = await ask();
    expect(again.status).toBe(409);
    expect((await status()).body.askAgainAt).not.toBeNull();

    advance(OWNER_REKEY.everyDays * DAY);
    expect((await ask()).status).toBe(201);
    await call("POST", `/v1/owner/link/${wren.residentId}/revoke`, undefined, hazel.token);
    // The revoke cancelled it, and the team handles it from here.
    expect((await status()).body).toMatchObject({ status: "cancelled", cancelledBy: "revoke" });
    advance(OWNER_REKEY.everyDays * DAY);
    expect((await ask()).status).toBe(403);
  });

  it("is cancelled by a live socket, which also keeps the code from being given or traded", async () => {
    const { base, wren, status, ask, code, advance } = await lost();
    advance(OWNER_REKEY.linkedDays * DAY);
    const socket = async () => {
      const ws = new WebSocket(`${base.replace("http", "ws")}/v1/live`);
      const messages: ServerMessage[] = [];
      ws.on("message", (data) => messages.push(JSON.parse(String(data))));
      await new Promise((done) => ws.once("open", done));
      cleanups.push(() => ws.close());
      return { ws, messages };
    };

    // Saying hello is a call.
    await ask();
    const first = await socket();
    first.ws.send(JSON.stringify({ type: "hello", v: 1, token: `Bearer ${wren.token}` }));
    await expect.poll(() => first.messages.some((m) => m.type === "welcome")).toBe(true);
    expect((await status()).body).toMatchObject({ status: "cancelled", cancelledBy: "agent" });

    // An agent connected before the request and quiet since still has its key.
    advance(OWNER_REKEY.everyDays * DAY);
    await ask();
    advance(OWNER_REKEY.waitMs);
    const refused = await code();
    expect(refused.status).toBe(404);
    expect(refused.body.error.message).toContain("connected to Terrakin with its old key");
    expect((await status()).body.cancelledBy).toBe("agent");

    // And any message on the socket counts as a call.
    first.ws.close();
    await expect.poll(() => first.ws.readyState).toBe(WebSocket.CLOSED);
    advance(OWNER_REKEY.everyDays * DAY);
    await ask();
    const second = await socket();
    second.ws.send(JSON.stringify({ type: "watch", v: 1, token: wren.token }));
    await expect.poll(() => second.messages.some((m) => m.type === "watching")).toBe(true);
    expect((await status()).body.cancelledBy).toBe("agent");
  });

  it("is cancelled by the agent's key sent the wrong way, by unlinking, and by the team's re-key", async () => {
    const { call, sql, wren, hazel, mira, maintainers, claim, ask, advance } = await lost();
    maintainers.add(mira.residentId);
    const row = () => [...sql.exec("SELECT status, cancelled_by FROM owner_rekeys")][0];
    advance(OWNER_REKEY.linkedDays * DAY);
    const key = (await call("POST", "/v1/link-key", undefined, wren.token)).body.key as string;

    await ask();
    // A link key sent as a token doesn't work, but shows the agent still has it.
    expect((await call("GET", "/v1/me", undefined, key)).status).toBe(401);
    expect(row()).toMatchObject({ status: "cancelled", cancelled_by: "agent" });

    advance(OWNER_REKEY.everyDays * DAY);
    await ask();
    const unlinked = await call(
      "DELETE",
      `/v1/owner/link/${wren.residentId}`,
      undefined,
      hazel.token,
    );
    expect(unlinked.status).toBe(204);
    expect(row()).toMatchObject({ status: "cancelled", cancelled_by: "unlink" });

    await claim(hazel, wren);
    advance(OWNER_REKEY.everyDays * DAY);
    expect((await ask()).status).toBe(201);
    const team = await call(
      "POST",
      `/v1/owner/rekey-codes/${wren.residentId}`,
      undefined,
      mira.token,
    );
    expect(team.status).toBe(201);
    expect(row()).toMatchObject({ status: "cancelled", cancelled_by: "unlink" });
  });

  it("still cancels after a restart, from the table", async () => {
    const { sql, service, social, wren, ask, advance } = await lost();
    advance(OWNER_REKEY.linkedDays * DAY);
    await ask();
    // A fresh owner service, as after a restart, knows the request is open from its row.
    const again = new OwnerService({ social, credentials: service });
    again.called(wren.residentId);
    expect([...sql.exec("SELECT status, cancelled_by FROM owner_rekeys")][0]).toMatchObject({
      status: "cancelled",
      cancelled_by: "agent",
    });
  });

  it("nudges an agent with no owner, the day after it joins and then weekly", async () => {
    const { call, join, advance } = await start();
    const moss = await join("Moss", "agent");
    const todo = async () =>
      ((await call("GET", "/v1/checkin", undefined, moss.token)).body.todo as string[]).join("\n");
    expect(await todo()).not.toContain("no owner linked");
    advance(DAY);
    expect(await todo()).toContain("You have no owner linked");
    advance(DAY);
    expect(await todo()).not.toContain("no owner linked");
    advance(6 * DAY);
    expect(await todo()).toContain("You have no owner linked");
  });
});

describe("a credential that doesn't work says why", () => {
  it("forgives quotes, case, and a doubled Bearer, and names a wrong or unknown credential", async () => {
    const { base, call, join } = await start();
    const wren = await join("Wren", "agent");
    const key = (await call("POST", "/v1/link-key", undefined, wren.token)).body.key as string;
    const send = (authorization: string) =>
      fetch(`${base}/v1/me`, { headers: { authorization } }).then(async (r) => ({
        status: r.status,
        body: (await r.json()) as { error: { code: string; message: string } },
      }));

    for (const header of [
      `bearer ${wren.token}`,
      `Bearer "${wren.token}"`,
      `Bearer Bearer ${wren.token}`,
      `Bearer <${wren.token}>`,
      ` ${wren.token} `,
    ]) {
      expect((await send(header)).status).toBe(200);
    }
    const unknown = await send(`Bearer ${wren.token.slice(0, -2)}`);
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe("unauthorized");
    expect(unknown.body.error.message).toContain("no record of turning it off");
    expect(unknown.body.error.message).toContain("#if-you-lost-your-token");
    expect((await send("")).body.error.message).toContain("Missing token");
    expect((await send(`Bearer ${key}`)).body.error.message).toContain("That's a link key");
    // And never echoes what was sent.
    expect(JSON.stringify(unknown.body)).not.toContain(wren.token.slice(0, 20));

    const tokenInLink = await fetch(`${base}/v1/act/${wren.token}/me`).then((r) => r.text());
    expect(tokenInLink).toContain("That's your API token, not a link key");
    expect(tokenInLink).not.toContain(wren.token);
  });
});

describe("agents that can only open links", () => {
  it("accept a claim, lose their link key on revoke, and re-key by link", async () => {
    const { base, call, join, profile, maintainers } = await start();
    const open = async (path: string) => {
      const res = await fetch(base + path);
      return { status: res.status, text: await res.text() };
    };
    const keyIn = (text: string) => /Link key \(secret\): `(k_[^`]+)`/.exec(text)?.[1] ?? "";
    const hazel = await join("Hazel", "human");
    const mira = await join("Mira", "human");
    maintainers.add(mira.residentId);

    const joined = await open(confirmLinkIn((await open("/v1/join?name=Moss")).text));
    const key = keyIn(joined.text);
    const mossId = /Resident id: `(r_[0-9a-f]+)`/.exec(joined.text)?.[1] ?? "";
    expect(key).toMatch(/^k_/);

    const { body } = await call("POST", "/v1/owner/claims", undefined, hazel.token);
    const accepted = await open(`/v1/act/${key}/accept-owner?code=${body.code}`);
    expect(accepted.status).toBe(200);
    expect(accepted.text).toContain("# Linked to your owner");
    expect(accepted.text).toContain("> Owner: Hazel");
    expect((await profile(mossId)).owner.id).toBe(hazel.residentId);
    // Opening the same link again doesn't act twice.
    expect((await open(`/v1/act/${key}/accept-owner?code=${body.code}`)).status).toBe(200);

    const revoked = await call("POST", `/v1/owner/link/${mossId}/revoke`, undefined, hazel.token);
    expect(revoked.status).toBe(204);
    expect((await open(`/v1/act/${key}/me`)).status).toBe(401);

    const issued = await call("POST", `/v1/owner/rekey-codes/${mossId}`, undefined, mira.token);
    // Opened as given (or by a link preview), the link uses nothing up.
    const first = await open(`/v1/rekey?code=${issued.body.code}`);
    expect(first.status).toBe(200);
    expect(keyIn(first.text)).toBe("");
    expect(first.text).toContain("confirm=yes");
    const again = await open(`/v1/rekey?code=${issued.body.code}`);
    expect(again.text).toContain("confirm=yes");
    const rekeyed = await open(`/v1/rekey?code=${issued.body.code}&confirm=yes`);
    expect(rekeyed.status).toBe(200);
    const fresh = keyIn(rekeyed.text);
    expect(fresh).toMatch(/^k_/);
    expect(fresh).not.toBe(key);
    expect((await open(`/v1/act/${fresh}/me`)).status).toBe(200);
    expect((await open(`/v1/rekey?code=${issued.body.code}&confirm=yes`)).status).toBe(404);
  });
});

describe("a link-only agent upgrades to a token (decision 0241)", () => {
  const DAY = 86_400_000;
  const keyIn = (text: string) => /Link key \(secret\): `(k_[^`]+)`/.exec(text)?.[1] ?? "";
  const codeIn = (text: string) => /Upgrade code: `([^`]+)`/.exec(text)?.[1] ?? "";

  /** Hazel owns Moss, who joined by link and has only a link key. */
  async function linkOnly() {
    const t = await start();
    const open = async (path: string) => {
      const res = await fetch(t.base + path);
      return { status: res.status, text: await res.text() };
    };
    const byLink = async (name: string) => {
      const joined = await open(confirmLinkIn((await open(`/v1/join?name=${name}`)).text));
      const id = /Resident id: `(r_[0-9a-f]+)`/.exec(joined.text)?.[1] ?? "";
      return { id, key: keyIn(joined.text) };
    };
    const hazel = await t.join("Hazel", "human");
    const mira = await t.join("Mira", "human");
    const moss = await byLink("Moss");
    const claim = async (owner: Who) => {
      const { body } = await t.call("POST", "/v1/owner/claims", undefined, owner.token);
      return open(`/v1/act/${moss.key}/accept-owner?code=${body.code}`);
    };
    expect((await claim(hazel)).status).toBe(200);
    const path = `/v1/owner/link/${moss.id}/upgrade`;
    const view = (who: Who = hazel) => t.call("GET", path, undefined, who.token);
    const approve = (code: string, who: Who = hazel) => t.call("POST", path, { code }, who.token);
    const ask = async (key = moss.key) => codeIn((await open(`/v1/act/${key}/upgrade`)).text);
    const collect = (code: string, key = moss.key) =>
      t.call("POST", "/v1/link-key/upgrade/token", { key, code });
    /**
     * Link Moss to `owner` behind the owner routes' back, a week old: the link changing some way
     * other than unlinking, which drops the request.
     */
    const relink = (owner: Who) => {
      t.social.unlink(moss.id);
      t.social.link(moss.id, owner.residentId);
      t.sql.exec(
        "UPDATE owner_links SET created_at = created_at - ? WHERE agent_id = ?",
        OWNER_UPGRADE.linkedDays * DAY,
        moss.id,
      );
    };
    return { ...t, open, byLink, hazel, mira, moss, claim, view, approve, ask, collect, relink };
  }

  it("trades the link key for a token once its owner enters the code, and the link stays", async () => {
    const { call, open, advance, profile, hazel, moss, view, approve, collect } = await linkOnly();
    advance(OWNER_UPGRADE.linkedDays * DAY);
    expect((await view()).body).toMatchObject({ status: "none", hasToken: false });

    const started = await open(`/v1/act/${moss.key}/upgrade`);
    expect(started.status).toBe(200);
    const code = codeIn(started.text);
    expect(code).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(started.text).toContain("POST http");
    expect(started.text).toContain("/v1/link-key/upgrade/token");
    const asked = (await view()).body;
    expect(asked.status).toBe("asked");
    expect(Date.parse(asked.expiresAt) - Date.parse(asked.askedAt)).toBe(OWNER_UPGRADE.ttlMs);

    // There is no link that collects: a URL with the code would be unfurled, logged, and cached.
    expect((await open(`/v1/act/${moss.key}/token?code=${code}`)).status).toBe(404);

    // The link key and the code, before the owner said yes, get nothing.
    const early = await collect(code);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("too_soon");

    // The owner's yes holds no token.
    const approved = await approve(code);
    expect(approved.status).toBe(200);
    expect(approved.body).toEqual({ ...asked, status: "approved" });

    const got = await collect(code);
    expect(got.status).toBe(200);
    expect(got.body.residentId).toBe(moss.id);
    expect((await call("GET", "/v1/me", undefined, got.body.token)).body.resident.id).toBe(moss.id);
    const menu = await open(`/v1/act/${moss.key}/me`);
    expect(menu.status).toBe(401);
    expect(menu.text).toContain("Error code: `revoked`");
    expect(menu.text).toContain("traded it for a bearer token");

    expect((await profile(moss.id)).owner.id).toBe(hazel.residentId);
    expect((await view()).body).toMatchObject({ status: "used", hasToken: true });

    // Already upgraded: a fresh link key made with the token can't ask again, and the page
    // doesn't put the agent's own name in unquoted.
    const fresh = (await call("POST", "/v1/link-key", undefined, got.body.token)).body
      .key as string;
    expect((await open(`/v1/act/${fresh}/me`)).status).toBe(200);
    const twice = await open(`/v1/act/${fresh}/upgrade`);
    expect(twice.status).toBe(403);
    expect(twice.text).toContain("You already have a bearer token");
    expect(twice.text).not.toContain("Moss");
  });

  it("answers a retry of the same key and code with the same token for a moment, and nothing else", async () => {
    const { call, advance, moss, approve, ask, collect } = await linkOnly();
    advance(OWNER_UPGRADE.linkedDays * DAY);
    // Started by POST, with the key kept out of any URL.
    const started = await call("POST", "/v1/link-key/upgrade", { key: moss.key });
    expect(started.status).toBe(201);
    const code = started.body.code as string;
    expect((await approve(code)).status).toBe(200);
    const got = await collect(code);
    expect(got.status).toBe(200);

    // The answer was lost: the same key and code get the same token, though the key is off.
    const again = await collect(code.toUpperCase());
    expect(again.status).toBe(200);
    expect(again.body.token).toBe(got.body.token);
    // A wrong code with the key gets nothing.
    const wrong = await collect("abcd-efgh-jkmn-pqrs");
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(wrong.body)).not.toContain(got.body.token);
    expect(await ask()).toBe("");

    advance(REPEAT_WINDOW_MS);
    const late = await collect(code);
    expect(late.status).toBe(401);
    expect(late.body.error.code).toBe("revoked");
  });

  it("gives nothing to a stranger with only the link key, or to the owner alone", async () => {
    const { call, advance, hazel, approve, ask, collect } = await linkOnly();
    advance(OWNER_UPGRADE.linkedDays * DAY);
    const code = await ask();
    expect((await approve(code)).status).toBe(200);

    // A stranger who copied the key from a link, but never saw the code.
    expect((await collect("abcd-efgh-jkmn-pqrs")).status).toBe(404);

    // The owner has the code but not the agent's key: their own token or link key gets nothing.
    const asToken = await collect(code, hazel.token);
    expect(asToken.status).toBe(401);
    expect(asToken.body.error.message).toContain("That's your API token, not a link key");
    const ownKey = (await call("POST", "/v1/link-key", undefined, hazel.token)).body.key as string;
    expect((await collect(code, ownKey)).status).toBe(404);

    // None of that used it up: the agent still collects.
    expect((await collect(code)).status).toBe(200);
  });

  it("makes a new code on every start, which turns off the last one and its approval", async () => {
    const { advance, view, approve, ask, collect } = await linkOnly();
    advance(OWNER_UPGRADE.linkedDays * DAY);

    // Anyone who opens the start link with a leaked key gets a new code, never the agent's.
    const first = await ask();
    const second = await ask();
    expect(second).not.toBe(first);
    expect((await approve(first)).status).toBe(404);
    expect((await collect(first)).status).toBe(404);

    // A new start after the owner's yes leaves nothing approved.
    expect((await approve(second)).status).toBe(200);
    const third = await ask();
    expect((await view()).body.status).toBe("asked");
    expect((await collect(third)).status).toBe(409);
    expect((await collect(second)).status).toBe(404);
  });

  it("is for its owner only, and a request ends when it runs out or the link ends", async () => {
    const { call, open, advance, hazel, mira, moss, view, approve, ask, collect, claim } =
      await linkOnly();
    const young = await open(`/v1/act/${moss.key}/upgrade`);
    expect(young.status).toBe(409);
    expect(young.text).toContain("Error code: `too_soon`");
    advance(OWNER_UPGRADE.linkedDays * DAY);

    const first = await ask();
    expect((await view(mira)).status).toBe(403);
    expect((await approve(first, mira)).status).toBe(403);
    expect((await approve(first)).status).toBe(200);

    advance(OWNER_UPGRADE.ttlMs);
    expect((await collect(first)).status).toBe(404);
    expect((await approve(first)).status).toBe(404);
    expect((await view()).body.status).toBe("none");

    // Unlinking drops it, and a new owner starts over with a new link.
    const second = await ask();
    const unlinked = await call("DELETE", `/v1/owner/link/${moss.id}`, undefined, hazel.token);
    expect(unlinked.status).toBe(204);
    expect((await claim(mira)).status).toBe(200);
    expect((await approve(second, mira)).status).toBe(404);
    expect((await collect(second)).status).toBe(404);
    expect((await open(`/v1/act/${moss.key}/upgrade`)).status).toBe(409);

    // A revoke drops it too, and the key it turned off can't collect.
    advance(OWNER_UPGRADE.linkedDays * DAY);
    const third = await ask();
    expect((await approve(third, mira)).status).toBe(200);
    await call("POST", `/v1/owner/link/${moss.id}/revoke`, undefined, mira.token);
    expect((await collect(third)).status).toBe(401);
    expect((await view(mira)).body.status).toBe("none");
  });

  it("holds to the owner it was asked under and to the agent's state at each step", async () => {
    const { service, advance, hazel, mira, moss, approve, ask, collect, relink } = await linkOnly();
    advance(OWNER_UPGRADE.linkedDays * DAY);

    // Asked under Hazel: Mira, now the owner, can't approve it.
    const first = await ask();
    relink(mira);
    expect((await approve(first, mira)).status).toBe(404);

    // Approved by Hazel: once Mira is the owner, it can't be collected.
    relink(hazel);
    const second = await ask();
    expect((await approve(second)).status).toBe(200);
    relink(mira);
    expect((await collect(second)).status).toBe(404);

    // The agent got a token after asking: there's nothing left to approve.
    relink(hazel);
    const third = await ask();
    service.issueToken(moss.id);
    const late = await approve(third);
    expect(late.status).toBe(403);
    expect(late.body.error.message).toContain("Moss already has a bearer token");
  });

  it("is dropped by the team's re-key, and by trading its code", async () => {
    const { call, open, join, maintainers, moss, approve, ask, collect, relink, hazel } =
      await linkOnly();
    const ash = await join("Ash", "human");
    maintainers.add(ash.residentId);
    const teamCode = () =>
      call("POST", `/v1/owner/rekey-codes/${moss.id}`, undefined, ash.token).then((r) => {
        expect(r.status).toBe(201);
        return r.body.code as string;
      });
    relink(hazel);

    // Making the team's code drops an approved request, so relinking can't bring it back.
    const first = await ask();
    expect((await approve(first)).status).toBe(200);
    const rekey = await teamCode();
    relink(hazel);
    expect((await collect(first)).status).toBe(404);

    // Trading the code for a new link key drops a request made since, even approved.
    const second = await ask();
    expect((await approve(second)).status).toBe(200);
    const traded = await open(`/v1/rekey?code=${rekey}&confirm=yes`);
    expect(traded.status).toBe(200);
    const fresh = keyIn(traded.text);
    expect(fresh).toMatch(/^k_/);
    expect((await collect(second, fresh)).status).toBe(404);
  });

  it("is only for an agent with an owner, no token, not townsfolk, and not suspended", async () => {
    const { call, open, byLink, hazel, advance, townsfolk, social, moss, approve, ask, collect } =
      await linkOnly();
    const fern = await byLink("Fern");
    const reed = await byLink("Reed");
    const wren = await call("POST", "/v1/session", { name: "Wren", kind: "agent" });
    const issued = await call("POST", "/v1/owner/claims", undefined, hazel.token);
    await call("POST", "/v1/owner/accept", { code: issued.body.code }, wren.body.token);
    advance(OWNER_UPGRADE.linkedDays * DAY);

    const unowned = await open(`/v1/act/${fern.key}/upgrade`);
    expect(unowned.status).toBe(403);
    expect(unowned.text).toContain("Only an AI with an owner linked");

    const wrenKey = (await call("POST", "/v1/link-key", undefined, wren.body.token)).body.key;
    const hasToken = await call("POST", "/v1/link-key/upgrade", { key: wrenKey });
    expect(hasToken.status).toBe(403);
    expect(hasToken.body.error.message).toContain("You already have a bearer token");

    const hazelKey = (await call("POST", "/v1/link-key", undefined, hazel.token)).body.key;
    const person = await call("POST", "/v1/link-key/upgrade", { key: hazelKey });
    expect(person.status).toBe(403);
    expect(person.body.error.message).toContain("Only AI agents");

    townsfolk.add(reed.id);
    const townsfolkKey = await call("POST", "/v1/link-key/upgrade", { key: reed.key });
    expect(townsfolkKey.status).toBe(403);
    expect(townsfolkKey.body.error.message).toContain("Only AI agents");

    expect((await call("POST", "/v1/link-key/upgrade", { key: "k_nope" })).status).toBe(401);

    // A suspended agent can't start one by POST, or collect one approved before.
    const code = await ask();
    expect((await approve(code)).status).toBe(200);
    expect(social.safety.suspend("staff", moss.id, 1, "test").ok).toBe(true);
    const started = await call("POST", "/v1/link-key/upgrade", { key: moss.key });
    expect(started.status).toBe(403);
    expect(started.body.error.code).toBe("suspended");
    const collected = await collect(code);
    expect(collected.status).toBe(403);
    expect(collected.body.error.code).toBe("suspended");
  });
});

describe("rate limits", () => {
  it("limits how fast one resident makes codes", async () => {
    const { call, join } = await start();
    const hazel = await join("Hazel", "human");
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await call("POST", "/v1/owner/claims", undefined, hazel.token)).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("limits code lookups without a token per IP", async () => {
    const { call } = await start();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await call("GET", "/v1/owner/invites/abcd-efgh-jkmn-pqrs")).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 404)).toBe(true);
    expect(statuses[20]).toBe(429);
    // Shared with re-key attempts, which a guesser would try next, and with upgrade codes.
    expect((await call("POST", "/v1/owner/rekey", { code: "abcd-efgh-jkmn-pqrs" })).status).toBe(
      429,
    );
    const upgrade = { key: "k_guess", code: "abcd-efgh-jkmn-pqrs" };
    expect((await call("POST", "/v1/link-key/upgrade/token", upgrade)).status).toBe(429);
  });
});

describe("revoked tokens stay revoked after a restart", () => {
  const stores: [string, () => { store: Store; done: () => void }][] = [
    [
      "JSONL",
      () => {
        const dir = mkdtempSync(join(tmpdir(), "terrakin-owner-"));
        return { store: new JsonlStore(dir), done: () => rmSync(dir, { recursive: true }) };
      },
    ],
    [
      "SQLite",
      () => {
        const sql = nodeSql();
        return { store: new SqlStore(sql), done: () => sql.close() };
      },
    ],
  ];

  it.each(stores)("in the %s store", (_, open) => {
    const { store, done } = open();
    cleanups.push(done);
    const first = new WorldService({ store, config: CONFIG });
    const wren = first.createSession({ name: "Wren", kind: "agent" });
    const ivy = first.createSession({ name: "Ivy", kind: "human" });
    if (!wren.token || !wren.residentId || !ivy.token) throw new Error("no session");
    const second = first.issueToken(wren.residentId);
    first.revokeTokens(wren.residentId);
    expect(first.authenticate(wren.token)).toBeUndefined();
    expect(first.authenticate(second)).toBeUndefined();
    const fresh = first.issueToken(wren.residentId);

    const reborn = new WorldService({ store, config: CONFIG });
    expect(reborn.authenticate(wren.token)).toBeUndefined();
    expect(reborn.authenticate(second)).toBeUndefined();
    expect(reborn.authenticate(fresh)).toBe(wren.residentId);
    expect(reborn.authenticate(ivy.token)).toBe(ivy.residentId);
  });
});
