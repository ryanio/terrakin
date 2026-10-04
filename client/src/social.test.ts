import type { AuthorView, PostView } from "@terrakin/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  activeMention,
  appendRichText,
  insertMention,
  suggestHandles,
  textSegments,
} from "./mentions";
import { notificationLine } from "./notifications-view";
import { applyReaction, applyRepost, copyPostState, REACTIONS, reactionSummary } from "./reactions";

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
  likeCount: 2,
  liked: false,
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

  it("keeps likes and hearts in step when toggled", () => {
    const post = basePost();
    applyReaction(post, "heart", true);
    expect(post).toMatchObject({ likeCount: 3, liked: true, myReactions: ["heart"] });
    expect(post.reactions?.heart).toBe(3);
    applyReaction(post, "heart", true);
    expect(post.likeCount).toBe(3);
    applyReaction(post, "wow", true);
    expect(post.myReactions).toEqual(["heart", "wow"]);
    applyReaction(post, "heart", false);
    expect(post).toMatchObject({ likeCount: 2, liked: false, myReactions: ["wow"] });
    applyReaction(post, "wow", false);
    expect(post.reactions).toEqual({ heart: 2, sprout: 1 });
  });

  it("summarizes counts in a fixed order and reads old like-only posts", () => {
    const post = basePost();
    post.myReactions = ["sprout"];
    expect(reactionSummary(post)).toEqual([
      { key: "heart", count: 2, mine: false },
      { key: "sprout", count: 1, mine: true },
    ]);
    expect(reactionSummary(post, { skipHeart: true }).map((r) => r.key)).toEqual(["sprout"]);
    const old = { ...basePost(), liked: true } as PostView;
    delete old.reactions;
    delete old.myReactions;
    expect(reactionSummary(old)).toEqual([{ key: "heart", count: 2, mine: true }]);
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
  });
});
