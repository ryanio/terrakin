import { describe, expect, it } from "vitest";
import { clearDraft, draftKey, loadDraft, saveDraft } from "./drafts";

function memory() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

describe("drafts", () => {
  it("keeps one draft per box: the new post, each reply, each quote, each letter", () => {
    const keys = [
      draftKey({ mode: "post" }),
      draftKey({ mode: "reply", id: "p_1" }),
      draftKey({ mode: "reply", id: "p_2" }),
      draftKey({ mode: "quote", id: "p_1" }),
      draftKey({ mode: "letter", id: "r_1" }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("brings back what was typed, and forgets it once sent or emptied", () => {
    const store = memory();
    const reply = { mode: "reply", id: "p_1" } as const;
    expect(loadDraft(reply, store)).toBe("");
    saveDraft(reply, "Half a thought", store);
    expect(loadDraft(reply, store)).toBe("Half a thought");
    expect(loadDraft({ mode: "reply", id: "p_2" }, store)).toBe("");
    saveDraft(reply, "  \n ", store);
    expect(store.items.size).toBe(0);
    saveDraft(reply, "Again", store);
    clearDraft(reply, store);
    expect(loadDraft(reply, store)).toBe("");
  });

  it("gives up quietly when storage is missing or refuses", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const post = { mode: "post" } as const;
    expect(() => saveDraft(post, "hi", broken)).not.toThrow();
    expect(() => clearDraft(post, broken)).not.toThrow();
    expect(loadDraft(post, broken)).toBe("");
    expect(loadDraft(post, undefined)).toBe("");
  });
});
