/**
 * `/inventory`: your things (RFC 0005). Private to you: your garden, what you made or were given,
 * and your seeds, produce, sugar, and jars. Labels and makers' names are other residents' words:
 * textContent only.
 */
import type { GiftView, GoodView, InventoryResponse } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { itemArt, thingPicture } from "@terrakin/ui/item-art";
import { personLink } from "@terrakin/ui/people";
import { confirmTwice, itemRow, itemRows, stateCard, toast, whileBusy } from "@terrakin/ui/ui";
import { actProblem, api, uploadMedia } from "./api";
import { savedToken } from "./net";
import { comeHomeButton } from "./purse-view";
import { growthLine, sendBackLine, stackCount, thingCount, thingName } from "./things";
import { errorCard, type View, type ViewContext } from "./view";

function goodItem(g: GoodView): HTMLLIElement {
  return itemRow({
    className: "things-good",
    attrs: { "data-item": g.id },
    lead: thingPicture(g, { size: 32 }),
    name: thingName(g.kind),
    lines: [
      g.label ? `“${g.label}”` : null,
      h(
        "span",
        { class: "things-good-maker" },
        h("span", { text: "Made by " }),
        g.maker ? personLink(g.maker) : h("span", { text: "a former resident" }),
      ),
    ],
  });
}

/**
 * A gift you can still send back, with a Send back button that asks once more before it goes.
 * The giver's name is a link; nothing they wrote shows here.
 */
function giftItem(g: GiftView, today: number, sent: () => void): HTMLLIElement {
  const back = h("button", {
    class: "pill-button small",
    attrs: { type: "button" },
    text: "Send back",
  });
  confirmTwice(back, "Send it back?", () =>
    whileBusy(back, async () => {
      const res = await api.act({ type: "decline_gift", gift: g.id });
      const problem = actProblem(res);
      if (problem) return toast(problem);
      toast(`Sent back to ${g.from?.name ?? "its giver"}`);
      sent();
    }),
  );
  return itemRow({
    className: "things-gift",
    attrs: { "data-gift": g.id },
    lead: itemArt(g.kind, { size: 32 }),
    name: g.count === 1 ? thingName(g.kind) : thingCount(g.kind, g.count),
    lines: [
      h(
        "span",
        { class: "things-good-maker" },
        h("span", { text: "From " }),
        g.from ? personLink(g.from) : h("span", { text: "a former resident" }),
      ),
      sendBackLine(g.lastDay, today),
    ],
    trail: back,
  });
}

/** What a piece of art may show: your own picture, or a `.glb` model. */
const PIECE_TYPES = "image/png,image/jpeg,image/webp,model/gltf-binary,.glb";

/**
 * Make a piece of art (RFC 0005 step 3): pick one of your own pictures (or a `.glb` model), give it
 * a title, and it's a made thing you can hang in a frame or stand on a pedestal. `made` runs after.
 */
function pieceCard(labelMax: number, made: () => void): HTMLElement {
  const file = h("input", {
    class: "visually-hidden",
    attrs: { id: "piece-file", type: "file", accept: PIECE_TYPES },
  });
  const pick = h(
    "label",
    { class: "pill-button small", attrs: { for: "piece-file", id: "piece-pick" } },
    icon("image"),
    h("span", { text: "Choose a picture" }),
  );
  const preview = h("div", { class: "piece-preview", attrs: { hidden: true } });
  const title = h("input", {
    class: "field-input",
    attrs: {
      id: "piece-title",
      maxlength: labelMax,
      placeholder: "Morning light",
      autocomplete: "off",
      enterkeyhint: "done",
    },
  });
  const make = h("button", {
    class: "btn-primary small",
    attrs: { type: "submit", id: "piece-make", disabled: true },
    text: "Make it",
  });
  const status = h("p", {
    class: "field-hint",
    attrs: { id: "piece-status", "aria-live": "polite" },
  });
  let media: { id: string; model: boolean } | undefined;
  const sync = () => {
    make.disabled = !media || title.value.trim() === "";
  };
  title.addEventListener("input", sync);
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    file.value = "";
    if (!chosen) return;
    media = undefined;
    sync();
    preview.hidden = true;
    status.textContent = "Uploading…";
    const up = uploadMedia(chosen, (f) => {
      status.textContent = `Uploading ${Math.round(f * 100)}%`;
    });
    const result = await up.promise;
    if (!result.ok) {
      status.textContent = result.message;
      return;
    }
    const model = result.data.type === "model/gltf-binary";
    const still = ["image/png", "image/jpeg", "image/webp"].includes(result.data.type);
    if (!still && !model) {
      status.textContent = "A piece is a picture (PNG, JPEG, or WebP) or a .glb model.";
      return;
    }
    media = { id: result.data.id, model };
    preview.replaceChildren(
      thingPicture(
        { kind: "piece", media: media.id, ...(model ? { model: true } : {}) },
        {
          size: 96,
        },
      ),
    );
    preview.hidden = false;
    status.textContent = "Now give it a title.";
    sync();
    title.focus();
  });
  const form = h(
    "form",
    { class: "stack tight piece-form", attrs: { id: "piece-form", novalidate: true } },
    h("div", { class: "cluster" }, pick, file, preview),
    h("label", { class: "field-label", attrs: { for: "piece-title" }, text: "Title" }),
    h("div", { class: "gift-row" }, title, make),
    status,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = title.value.trim();
    if (!media || !text || make.disabled) return;
    const chosen = media;
    const res = await whileBusy(make, () =>
      api.act({ type: "make_piece", media: chosen.id, title: text }),
    );
    const problem = actProblem(res);
    if (problem) {
      status.textContent = problem;
      return;
    }
    toast("You made a piece of art");
    made();
  });
  return h(
    "section",
    { class: "stack paper card things-card", attrs: { "aria-labelledby": "things-piece-title" } },
    h("h2", {
      class: "card-title",
      attrs: { id: "things-piece-title" },
      text: "Make a piece of art",
    }),
    h("p", {
      class: "purse-hint",
      text: "Turn one of your own pictures into a piece, signed by you. Hang it in a frame or stand it on a pedestal on your plot for everyone to see.",
    }),
    form,
  );
}

export function inventoryView(ctx: ViewContext): View {
  ctx.setTitle("Your things · Terrakin");
  const el = h(
    "div",
    { class: "column stack cards page things-page" },
    h("h1", { class: "page-title", text: "Your things" }),
  );
  let destroyed = false;

  if (!savedToken()) {
    el.append(
      stateCard({
        title: "Join to grow and make things",
        body: "Residents grow lemons and herbs on their plots, make jam and bouquets, and give them to friends.",
        actions: [
          h(
            "a",
            { class: "btn-primary", attrs: { href: "/#join" } },
            h("span", { text: "Join" }),
            icon("arrow"),
          ),
        ],
      }),
    );
    return { el, ready: Promise.resolve(), destroy() {} };
  }

  const body = h("div", { class: "stack cards things-body" });
  el.append(body);

  function paint(data: InventoryResponse) {
    const { inventory: inv, rules } = data;
    if (!inv) {
      body.replaceChildren(
        stateCard({ title: "Growing and making aren't open yet", body: "Check back soon." }),
      );
      return;
    }
    const held = (kind: string) => stackCount(inv.stacks, kind);
    const staplesFull = held("sugar") >= rules.stapleMax && held("jar") >= rules.stapleMax;
    // Today's pantry waits at home: the same "come home" the purse page has.
    const pantryDue = inv.hasHearth && !inv.pantryToday && !staplesFull;
    body.replaceChildren(
      h(
        "section",
        {
          class: "stack paper card things-card",
          attrs: { "aria-labelledby": "things-garden-title" },
        },
        h("h2", { class: "card-title", attrs: { id: "things-garden-title" }, text: "Your garden" }),
        inv.garden.length > 0
          ? h(
              "ul",
              { class: "stack tight things-garden" },
              ...inv.garden.map((c) =>
                h(
                  "li",
                  { class: `things-crop${c.ready ? " ready" : ""}` },
                  itemArt(c.crop),
                  h("span", { class: "things-crop-name", text: thingName(c.crop) }),
                  h("span", { class: "things-crop-when", text: growthLine(c.readyDay, inv.day) }),
                ),
              ),
            )
          : h("p", {
              class: "purse-hint",
              text: "Nothing growing. Place a planter on your plot in the world, then tap it to plant.",
            }),
        h("p", {
          class: "purse-hint",
          text: inv.pantryToday
            ? "You've had today's pantry. See you tomorrow."
            : staplesFull
              ? "Your sugar and jars are full. The pantry tops them up as you use them."
              : inv.hasHearth
                ? `Come home today for ${thingCount("sugar", rules.pantrySugar)} and ${thingCount("jar", rules.pantryJars)}.`
                : "Build a home on your plot to get a pantry each day.",
        }),
        pantryDue
          ? comeHomeButton("Come home for the pantry", () => {
              if (!destroyed) void load();
            })
          : null,
      ),
      ...(inv.gifts.length > 0
        ? [
            h(
              "section",
              { class: "stack things-section", attrs: { "aria-labelledby": "things-gifts-title" } },
              h("h2", {
                class: "section-title",
                attrs: { id: "things-gifts-title" },
                text: "Gifts you got",
              }),
              itemRows(
                inv.gifts.map((g) =>
                  giftItem(g, inv.day, () => {
                    if (!destroyed) void load();
                  }),
                ),
                { className: "things-gifts" },
              ),
              h("p", {
                class: "purse-hint",
                text: `Don't want one? Send it back within ${rules.declineDays} days, while you still have all of it. Only the two of you see it.`,
              }),
            ),
          ]
        : []),
      h(
        "section",
        { class: "stack things-section", attrs: { "aria-labelledby": "things-made-title" } },
        h("h2", {
          class: "section-title",
          attrs: { id: "things-made-title" },
          text: "Made things",
        }),
        inv.goods.length > 0
          ? itemRows(inv.goods.map(goodItem), { className: "things-goods" })
          : h("p", {
              class: "purse-hint",
              text: "Nothing yet. Tap a kitchen or a workbench in the world to make something.",
            }),
      ),
      pieceCard(rules.labelMax, () => {
        if (!destroyed) void load();
      }),
      h(
        "section",
        { class: "stack things-section", attrs: { "aria-labelledby": "things-stacks-title" } },
        h("h2", {
          class: "section-title",
          attrs: { id: "things-stacks-title" },
          text: "Seeds, harvest, pantry, and decor",
        }),
        inv.stacks.length > 0
          ? h(
              "ul",
              { class: "cluster plain-list things-stacks" },
              ...inv.stacks.map((s) =>
                h(
                  "li",
                  { class: "pill things-stack has-art" },
                  itemArt(s.kind, { size: 24 }),
                  h("span", { text: thingCount(s.kind, s.count) }),
                ),
              ),
            )
          : h("p", {
              class: "purse-hint",
              text: !inv.hasHearth
                ? "Empty. Build a home on your plot, then come home to it for the pantry."
                : inv.pantryToday
                  ? "Empty. The pantry tops you up again tomorrow."
                  : "Empty. Come home to your hearth for today's pantry.",
            }),
        h("p", {
          class: "purse-hint",
          text: `${inv.size} of ${rules.inventoryMax} things. Give from someone's profile: up to ${rules.giveCap} a day. Only you see this page.`,
        }),
        h(
          "a",
          { class: "pill-button small", attrs: { href: "/market", id: "things-market" } },
          "Sell in the market",
        ),
      ),
    );
  }

  async function load(): Promise<void> {
    const r = await api.inventory();
    if (destroyed) return;
    if (!r.ok) {
      body.replaceChildren(errorCard(r.message, () => void load()));
      return;
    }
    paint(r.data);
  }

  return {
    el,
    ready: load(),
    destroy() {
      destroyed = true;
    },
  };
}
