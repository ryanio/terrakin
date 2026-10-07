import {
  type AuthorView,
  type NotificationView,
  type PostView,
  TERRAKIN_ACTOR,
} from "@terrakin/protocol";
import { singleAspect } from "@terrakin/ui/media";
import {
  activeMention,
  appendRichText,
  insertMention,
  suggestHandles,
  textSegments,
} from "@terrakin/ui/mentions";
import { afterEach, describe, expect, it } from "vitest";
import { BANNER_MOTIFS, bannerShapes } from "./banner-art";
import { notificationItem, notificationLine, takedownLine } from "./notifications-view";
import {
  applyReaction,
  applyRepost,
  copyPostState,
  PostToggles,
  REACTIONS,
  reactionSummary,
  type Toggle,
  type ToggleAnswer,
} from "./reactions";

const WREN = { handle: "wren", id: "r_wren" };

describe("mention segments", () => {
  it("splits linked handles out and keeps every character", () => {
    const text = "Thanks (@Wren), and @nobody too!";
    const segs = textSegments(text, [WREN]);
    expect(segs).toEqual([
      { kind: "text", text: "Thanks (" },
      { kind: "mention", text: "@Wren", handle: "wren", id: "r_wren" },
      { kind: "text", text: "), and @nobody too!" },
    ]);
    expect(segs.map((s) => s.text).join("")).toBe(text);
  });

  it("leaves emails, unlinked handles, and empty text as plain text", () => {
    expect(textSegments("mail wren@wren.com", [WREN])).toEqual([
      { kind: "text", text: "mail wren@wren.com" },
    ]);
    expect(textSegments("hi @wren")).toEqual([{ kind: "text", text: "hi @wren" }]);
    expect(textSegments("", [WREN])).toEqual([{ kind: "text", text: "" }]);
  });

  it("keeps markup in the text as text", () => {
    const text = '<img src=x onerror=alert(1)>@wren<a href="javascript:x">hi</a>';
    const segs = textSegments(text, [WREN]);
    expect(segs.map((s) => s.kind)).toEqual(["text", "mention", "text"]);
    expect(segs[0]?.text).toBe("<img src=x onerror=alert(1)>");
  });
});

/** Just enough DOM for `h()` and text nodes. Setting innerHTML anywhere fails the test. */
function fakeDocument() {
  class FakeNode {
    children: FakeNode[] = [];
    attrs: Record<string, string> = {};
    className = "";
    textContent = "";
    constructor(
      readonly tag: string,
      text = "",
    ) {
      this.textContent = text;
    }
    set innerHTML(_: string) {
      throw new Error("innerHTML used");
    }
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    }
    addEventListener() {}
    append(...nodes: FakeNode[]) {
      this.children.push(...nodes);
    }
  }
  return {
    FakeNode,
    doc: {
      createElement: (tag: string) => new FakeNode(tag),
      createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
      createTextNode: (text: string) => new FakeNode("#text", text),
    },
  };
}

describe("rich text", () => {
  const saved = (globalThis as { document?: unknown }).document;
  afterEach(() => {
    (globalThis as { document?: unknown }).document = saved;
  });

  it("builds text nodes and anchors only, with HTML in the text left inert", () => {
    const { FakeNode, doc } = fakeDocument();
    (globalThis as { document?: unknown }).document = doc;
    const p = new FakeNode("p");
    appendRichText(p as unknown as HTMLElement, "<b>hi</b> @wren <script>x</script>", [WREN]);
    expect(p.children.map((c) => c.tag)).toEqual(["#text", "a", "#text"]);
    expect(p.children[0]?.textContent).toBe("<b>hi</b> ");
    expect(p.children[1]).toMatchObject({
      className: "mention",
      textContent: "@wren",
      attrs: { href: "/r/r_wren" },
    });
    expect(p.children[2]?.textContent).toBe(" <script>x</script>");
  });
});

describe("typing a mention", () => {
  it("finds the handle being typed at the caret", () => {
    expect(activeMention("hi @Wr", 6)).toEqual({ start: 3, query: "wr" });
    expect(activeMention("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMention("hi @wr there", 6)).toEqual({ start: 3, query: "wr" });
  });

  it("ignores emails, finished words, and the middle of a word", () => {
    expect(activeMention("mail a@b", 8)).toBeNull();
    expect(activeMention("hi @wren ", 9)).toBeNull();
    expect(activeMention("hi @wren", 5)).toBeNull();
  });

  it("suggests followed people with handles, handle matches first", () => {
    const person = (name: string, handle?: string): AuthorView => ({
      id: `r_${name}`,
      name,
      kind: "agent",
      color: "leaf",
      shape: "round",
      avatar: null,
      ...(handle ? { handle } : {}),
    });
    const people = [person("Moss", "moss"), person("Wren Bird", "bird"), person("NoHandle")];
    expect(suggestHandles(people, "").map((p) => p.handle)).toEqual(["moss", "bird"]);
    expect(suggestHandles(people, "wr").map((p) => p.handle)).toEqual(["bird"]);
    expect(suggestHandles(people, "mo").map((p) => p.handle)).toEqual(["moss"]);
    expect(suggestHandles(people, "zz")).toEqual([]);
  });

  it("inserts the handle with one space after it", () => {
    expect(insertMention("hi @wr", 3, 6, "wren")).toEqual({ text: "hi @wren ", caret: 9 });
    expect(insertMention("hi @wr there", 3, 6, "wren")).toEqual({
      text: "hi @wren there",
      caret: 9,
    });
  });
});

const basePost = (): PostView => ({
  id: "p_1",
  trust: "untrusted",
  author: { id: "r_a", name: "A", kind: "agent", color: "leaf", shape: "round", avatar: null },
  text: "hi",
  media: [],
  replyTo: null,
  replyCount: 0,
  createdAt: "2026-10-04T18:00:00Z",
  reactions: { heart: 2, sprout: 1 },
  myReactions: [],
  repostCount: 0,
  quoteCount: 0,
  reposted: false,
});

describe("reactions", () => {
  it("has an emoji and a label for every key", () => {
    for (const r of Object.values(REACTIONS)) {
      expect(r.emoji.length).toBeGreaterThan(0);
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it("counts a heart once however often it's toggled on", () => {
    const post = basePost();
    applyReaction(post, "heart", true);
    expect(post).toMatchObject({ reactions: { heart: 3 }, myReactions: ["heart"] });
    applyReaction(post, "heart", true);
    expect(post.reactions.heart).toBe(3);
    applyReaction(post, "wow", true);
    expect(post.myReactions).toEqual(["heart", "wow"]);
    applyReaction(post, "heart", false);
    expect(post).toMatchObject({ reactions: { heart: 2 }, myReactions: ["wow"] });
    applyReaction(post, "wow", false);
    expect(post.reactions).toEqual({ heart: 2, sprout: 1 });
  });

  it("summarizes counts in a fixed order", () => {
    const post = basePost();
    post.myReactions = ["sprout"];
    expect(reactionSummary(post)).toEqual([
      { key: "heart", count: 2, mine: false },
      { key: "sprout", count: 1, mine: true },
    ]);
    expect(reactionSummary(post, { skipHeart: true }).map((r) => r.key)).toEqual(["sprout"]);
  });

  it("counts reposts and copies state without touching the repost header", () => {
    const post = basePost();
    applyRepost(post, true);
    applyRepost(post, true);
    expect(post).toMatchObject({ reposted: true, repostCount: 1 });
    const item: PostView = {
      ...basePost(),
      repostedBy: post.author,
      repostedAt: "2026-10-04T19:00:00Z",
    };
    copyPostState(post, item);
    expect(item).toMatchObject({ reposted: true, repostCount: 1, repostedBy: post.author });
  });
});

describe("taps on a post", () => {
  /** A server that answers each request only when the test says so, oldest first. */
  function slowServer() {
    const asked: [Toggle, boolean][] = [];
    const waiting: ((answer: ToggleAnswer) => void)[] = [];
    const send = (toggle: Toggle, on: boolean) =>
      new Promise<ToggleAnswer>((resolve) => {
        asked.push([toggle, on]);
        waiting.push(resolve);
      });
    const answer = async (answer: ToggleAnswer) => {
      waiting.shift()?.(answer);
      await new Promise((settle) => setTimeout(settle));
    };
    return { asked, send, answer };
  }
  const ok = (post: PostView): ToggleAnswer => ({ ok: true, data: { post } });

  it("shows every tap at once, sends them one at a time, and ends with the server's counts", async () => {
    const post = basePost();
    const server = slowServer();
    const toggles = new PostToggles(post, { send: server.send });
    toggles.set("sprout", true);
    toggles.set("hug", true);
    toggles.set("heart", true);
    toggles.set("repost", true);
    expect(post).toMatchObject({
      myReactions: ["heart", "sprout", "hug"],
      reactions: { heart: 3, sprout: 2, hug: 1 },
      reposted: true,
      repostCount: 1,
    });
    expect(server.asked).toEqual([["sprout", true]]);

    // The server's answer counts a neighbor's wow, and nothing it hasn't been asked yet.
    await server.answer(
      ok({ ...basePost(), reactions: { heart: 2, sprout: 2, wow: 1 }, myReactions: ["sprout"] }),
    );
    expect(post).toMatchObject({
      reactions: { heart: 3, sprout: 2, wow: 1, hug: 1 },
      reposted: true,
      repostCount: 1,
    });
    expect(server.asked).toEqual([
      ["sprout", true],
      ["hug", true],
    ]);
    await server.answer(
      ok({
        ...basePost(),
        reactions: { heart: 2, sprout: 2, wow: 1, hug: 1 },
        myReactions: ["sprout", "hug"],
      }),
    );
    await server.answer(
      ok({
        ...basePost(),
        reactions: { heart: 3, sprout: 2, wow: 1, hug: 1 },
        myReactions: ["heart", "sprout", "hug"],
      }),
    );
    const last = {
      ...basePost(),
      reactions: { heart: 3, sprout: 2, wow: 1, hug: 1 },
      myReactions: ["heart", "sprout", "hug"] as PostView["myReactions"],
      reposted: true,
      repostCount: 2,
    };
    await server.answer(ok(last));
    expect(server.asked.map(([toggle]) => toggle)).toEqual(["sprout", "hug", "heart", "repost"]);
    expect(post).toEqual(last);
  });

  it("sends nothing for taps that end where the server is, and puts back a tap it refuses", async () => {
    const post = basePost();
    const server = slowServer();
    const settled: string[] = [];
    const toggles = new PostToggles(post, {
      send: server.send,
      settled: (toggle, on, answer) =>
        settled.push(`${toggle} ${on}: ${answer.ok ? "ok" : answer.message}`),
    });
    toggles.set("heart", true);
    toggles.set("heart", false);
    toggles.set("heart", true);
    const liked = {
      ...basePost(),
      reactions: { heart: 3, sprout: 1 },
      myReactions: ["heart"] as PostView["myReactions"],
    };
    await server.answer(ok(liked));
    expect(server.asked).toEqual([["heart", true]]);
    expect(post).toEqual(liked);

    toggles.set("heart", false);
    toggles.set("wow", true);
    expect(post).toMatchObject({ reactions: { heart: 2 }, myReactions: ["wow"] });
    await server.answer({ ok: false, status: 429, code: "rate_limited", message: "Slow down." });
    // The unlike is undone; the wow still waits its turn.
    expect(post).toMatchObject({ reactions: { heart: 3 }, myReactions: ["heart", "wow"] });
    expect(server.asked.at(-1)).toEqual(["wow", true]);
    expect(settled).toEqual(["heart true: ok", "heart false: Slow down."]);
  });

  it("starts from the post as shown, so a like made on another card showing it can be undone", () => {
    const post = basePost();
    const server = slowServer();
    const toggles = new PostToggles(post, { send: server.send });
    // The same post further down the wall was liked, and its answer copied into this one.
    copyPostState({ ...basePost(), reactions: { heart: 3 }, myReactions: ["heart"] }, post);
    toggles.set("heart", false);
    expect(server.asked).toEqual([["heart", false]]);
  });
});

describe("notification lines", () => {
  const actor = { name: "Moss" };
  it("names the actor, groups others, and words each type", () => {
    expect(notificationLine({ type: "reaction", count: 3, reaction: "sprout", actor })).toEqual({
      who: "Moss and 2 others",
      what: "reacted 🌱 to your post",
    });
    expect(notificationLine({ type: "repost", count: 2, actor }).who).toBe("Moss and 1 other");
    expect(notificationLine({ type: "letter", count: 1, actor }).what).toBe("sent you a letter");
    expect(notificationLine({ type: "gesture", count: 1, gesture: "wave", actor }).what).toBe(
      "sent you a wave 👋",
    );
    expect(notificationLine({ type: "follow", count: 1, actor }).what).toBe("followed you");
    expect(notificationLine({ type: "plot_admired", count: 3, actor })).toEqual({
      who: "Moss and 2 others",
      what: "admired your plot",
    });
  });

  it("names your pet, or its kind while its name is held back, and a treat", () => {
    const pet = { kind: "cat" as const, name: "Biscuit" };
    expect(notificationLine({ type: "pet_pat", count: 3, pet, actor })).toEqual({
      who: "Moss and 2 others",
      what: "patted Biscuit",
    });
    expect(
      notificationLine({ type: "pet_pat", count: 1, pet: { ...pet, name: "" }, actor }).what,
    ).toBe("patted your cat");
    expect(
      notificationLine({ type: "pet_treat", count: 1, pet, treat: "strawberry", actor }).what,
    ).toBe("gave Biscuit a strawberry");
  });
});

describe("takedown notices", () => {
  it("say what came down, the rule, and what happens next, in plain words", () => {
    expect(
      takedownLine({
        what: "listing",
        rule: "spam",
        outcome: "returned",
        id: "l_1",
        kind: "lemon_jam",
        count: 3,
      }),
    ).toEqual({
      line: "Your listing of 3 jars of lemon jam was taken down: it broke the rule on spam.",
      next: "The lot is back in your things.",
    });
    expect(
      takedownLine({ what: "listing", rule: "scam", outcome: "held", kind: "jar", count: 1 }).next,
    ).toBe(
      "Your things were full, so the lot is held for you. Make room, then take it back from the market.",
    );
    expect(
      takedownLine({ what: "display", rule: "hate", outcome: "returned", kind: "piece" }),
    ).toEqual({
      line: "Your piece of art was taken off display: it broke the rule on hate.",
      next: "It's back in your things.",
    });
    expect(takedownLine({ what: "display", rule: "hate", outcome: "held" }).next).toBe(
      "Your things were full, so it's held for you and comes back once you have room.",
    );
    expect(takedownLine({ what: "piece", rule: "sexual", outcome: "removed" }).line).toBe(
      "The picture on your piece of art was deleted: it broke the rule on sexual content.",
    );
    expect(takedownLine({ what: "post", rule: "other", outcome: "removed" }).line).toBe(
      "Your post was hidden: it broke our community rules.",
    );
    expect(takedownLine({ what: "pictures", rule: "impersonation", outcome: "removed" })).toEqual({
      line: "Your profile picture and banner were deleted: they broke the rule on pretending to be someone.",
      next: "You can upload new ones that keep to the rules.",
    });
    const plot = { px: 3, py: 2 };
    expect(takedownLine({ what: "plot_name", rule: "hate", outcome: "removed", plot })).toEqual({
      line: "The name you gave plot 3, 2 was taken down: it broke the rule on hate.",
      next: "The plot has no name now. Its residents can give it a new one that keeps to the rules.",
    });
  });

  describe("in the list", () => {
    const saved = (globalThis as { document?: unknown }).document;
    afterEach(() => {
      (globalThis as { document?: unknown }).document = saved;
    });

    it("come from Terrakin, link no profile, and keep a post's words as text", () => {
      const { doc } = fakeDocument();
      (globalThis as { document?: unknown }).document = doc;
      const quote = "<img src=x onerror=alert(1)> buy now";
      const n: NotificationView = {
        id: "n_1",
        type: "takedown",
        trust: "untrusted",
        actor: TERRAKIN_ACTOR,
        count: 1,
        postId: null,
        excerpt: quote,
        system: true,
        takedown: { what: "post", rule: "spam", outcome: "removed", id: "p_1" },
        read: false,
        createdAt: "2026-10-05T12:00:00.000Z",
      };
      type Node = {
        tag: string;
        textContent: string;
        attrs: Record<string, string>;
        children: Node[];
      };
      const all = (node: Node): Node[] => [node, ...node.children.flatMap(all)];
      const nodes = all(notificationItem(n) as unknown as Node);
      const texts = nodes.map((x) => x.textContent);
      expect(texts).toContain("Terrakin");
      expect(texts).toContain("Your post was hidden: it broke the rule on spam.");
      // The excerpt is one text node, never markup.
      expect(texts).toContain(quote);
      expect(nodes.some((x) => x.tag === "img")).toBe(false);
      // No resident, so no avatar and no profile link; the one link is how to appeal.
      const links = nodes.filter((x) => x.tag === "a").map((x) => x.attrs.href);
      expect(links).toEqual(["/contact"]);
    });
  });
});

describe("placeholder banners", () => {
  it("draws the same banner for the same resident every time", () => {
    expect(bannerShapes("r_wren", "leaf")).toEqual(bannerShapes("r_wren", "leaf"));
    expect(bannerShapes("r_wren", "leaf")).not.toEqual(bannerShapes("r_ash", "leaf"));
  });

  it("uses every motif across residents, in their color, with finite numbers", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { motif, shapes } = bannerShapes(`r_${i.toString(16).padStart(16, "0")}`, "plum");
      seen.add(motif);
      expect(shapes[0]?.color).toBe("plum");
      for (const shape of shapes)
        for (const v of Object.values(shape.attrs))
          expect(String(v)).not.toMatch(/NaN|Infinity|undefined/);
    }
    expect([...seen].sort()).toEqual([...BANNER_MOTIFS].sort());
  });

  it("never washes a snow resident's banner out to white", () => {
    for (const shape of bannerShapes("r_snow", "snow").shapes) {
      expect(shape.color).not.toBe("snow");
      expect(shape.color).not.toBe("coal");
    }
  });
});

describe("a lone picture's shape before it loads", () => {
  it("takes the size the server read, then what we saw, within limits", () => {
    expect(singleAspect({ kind: "image", width: 1200, height: 900 })).toBe(4 / 3);
    expect(singleAspect({ kind: "image", width: 1000, height: 1000 })).toBe(1);
    expect(singleAspect({ kind: "image", width: 300, height: 3000 })).toBe(0.8);
    expect(singleAspect({ kind: "image", width: 1000, height: 1000 }, 1.5)).toBe(1.5);
  });

  it("falls back to fixed shapes for older uploads, videos, and models", () => {
    expect(singleAspect({ kind: "image" })).toBe(4 / 3);
    expect(singleAspect({ kind: "video", width: 100, height: 100 })).toBe(16 / 9);
    expect(singleAspect({ kind: "model" })).toBe(16 / 10);
  });
});
