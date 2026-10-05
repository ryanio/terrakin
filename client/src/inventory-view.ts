/**
 * `/inventory`: your things (RFC 0005). Private to you: your garden, what you made or were given,
 * and your seeds, produce, sugar, and jars. Labels and makers' names are other residents' words:
 * textContent only.
 */
import type { GoodView, InventoryResponse } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { itemArt } from "@terrakin/ui/item-art";
import { personLink } from "@terrakin/ui/people";
import { stateCard } from "@terrakin/ui/ui";
import { api } from "./api";
import { savedToken } from "./net";
import { comeHomeButton } from "./purse-view";
import { growthLine, stackCount, thingCount, thingName } from "./things";
import { errorCard, type View, type ViewContext } from "./view";

function goodItem(g: GoodView): HTMLElement {
  return h(
    "li",
    { class: "things-good has-art", attrs: { "data-item": g.id } },
    itemArt(g.kind),
    h(
      "span",
      { class: "things-good-body" },
      h("span", { class: "things-good-name", text: thingName(g.kind) }),
      g.label ? h("span", { class: "things-good-label", text: `“${g.label}”` }) : null,
      h(
        "span",
        { class: "things-good-maker" },
        h("span", { text: "Made by " }),
        g.maker ? personLink(g.maker) : h("span", { text: "a former resident" }),
      ),
    ),
  );
}

export function inventoryView(ctx: ViewContext): View {
  ctx.setTitle("Your things · Terrakin");
  const el = h(
    "div",
    { class: "column page things-page" },
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

  const body = h("div", { class: "things-body" });
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
        { class: "paper card things-card", attrs: { "aria-labelledby": "things-garden-title" } },
        h("h2", { class: "card-title", attrs: { id: "things-garden-title" }, text: "Your garden" }),
        inv.garden.length > 0
          ? h(
              "ul",
              { class: "things-garden" },
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
      h(
        "section",
        { class: "things-section", attrs: { "aria-labelledby": "things-made-title" } },
        h("h2", {
          class: "section-title",
          attrs: { id: "things-made-title" },
          text: "Made things",
        }),
        inv.goods.length > 0
          ? h("ul", { class: "things-goods" }, ...inv.goods.map(goodItem))
          : h("p", {
              class: "purse-hint",
              text: "Nothing yet. Tap a kitchen or a workbench in the world to make something.",
            }),
      ),
      h(
        "section",
        { class: "things-section", attrs: { "aria-labelledby": "things-stacks-title" } },
        h("h2", {
          class: "section-title",
          attrs: { id: "things-stacks-title" },
          text: "Seeds, harvest, pantry, and decor",
        }),
        inv.stacks.length > 0
          ? h(
              "ul",
              { class: "things-stacks" },
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
