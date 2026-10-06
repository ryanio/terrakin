/**
 * Pets on the page (RFC 0019): the Adopt sheet (a kind, a coat, a name, and a big preview that
 * follows every choice), the card a profile shows, and the sheet a pet opens when you tap it in
 * the world, with Pat and Give a treat for someone else's and Rename and New coat for your own.
 * They only send actions and pats; the server decides and says how it went. A pet's name is its
 * owner's words: text only.
 */
import type { ProfileView } from "@terrakin/protocol";
import { PET_COATS, PET_KINDS, PETS, type Pet, type PetCoat, type PetKind } from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { plural } from "@terrakin/ui/format";
import { itemArt } from "@terrakin/ui/item-art";
import { replay } from "@terrakin/ui/motion";
import { profilePath } from "@terrakin/ui/paths";
import { petArt } from "@terrakin/ui/pet-art";
import {
  chips,
  closeOverlay,
  errorLine,
  openOverlay,
  sheet,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import { actFromButton } from "./act";
import { actProblem, api } from "./api";
import { aThing, coatWord, PET_WORDS, petCalled, petLine, TREATS } from "./pets";

/** A pet on a profile, with its count of pats. */
export type ProfilePet = NonNullable<ProfileView["pet"]>;

/** "Patted by 12 residents", "No pats yet". */
export function patsLine(pats: number): string {
  return pats === 0 ? "No pats yet" : `Patted by ${plural(pats, "resident", "residents")}`;
}

/** "Your calico cat", "Tam's golden dog": whose it is and what it is. */
export function whosePet(pet: Pick<Pet, "kind" | "coat">, owner: string | undefined): string {
  const what = petLine(pet).replace(/^an? /, "");
  return owner === undefined ? `Your ${what}` : `${owner}'s ${what}`;
}

// ---------- adopting ----------

export interface AdoptOptions {
  /** After it came home: reload what the page shows. */
  adopted?: () => unknown;
}

/** Choose a kind, a coat, and a name, watching the pet as you go, and bring it home. */
export function openAdoptSheet(o: AdoptOptions = {}) {
  let kind: PetKind = "cat";
  let coat: PetCoat = PET_COATS.cat[0];
  const preview = h("div", { class: "pet-preview", attrs: { "aria-live": "polite" } });
  const caption = h("p", { class: "pet-preview-line" });
  const name = h("input", {
    class: "field-input",
    attrs: {
      id: "pet-name",
      maxlength: PETS.nameMax,
      placeholder: "Biscuit",
      autocomplete: "off",
      enterkeyhint: "done",
    },
  });
  const problem = errorLine("adopt-error");
  const submit = h("button", {
    class: "btn-primary",
    attrs: { type: "button", id: "adopt-submit" },
    text: "Bring it home",
  });
  const coatRow = h("div", { class: "pet-coats" });

  const paint = () => {
    const called = name.value.trim();
    preview.replaceChildren(
      petArt(kind, coat, { size: 140, face: "happy", title: petLine({ kind, coat }) }),
    );
    const what = petLine({ kind, coat });
    caption.textContent = called
      ? `${called}, ${what}`
      : what.charAt(0).toUpperCase() + what.slice(1);
    submit.textContent = called ? `Bring ${called} home` : "Bring it home";
  };
  const paintCoats = () => {
    coatRow.replaceChildren();
    chips(
      PET_COATS[kind],
      coat,
      (c) => [
        petArt(kind, c, { size: 44, className: "pet-chip-art" }),
        h("span", { text: coatWord(c) }),
      ],
      (c) => {
        coat = c;
        paint();
      },
      coatRow,
    );
    coatRow.setAttribute("aria-label", "Coats");
  };
  const kinds = chips(
    PET_KINDS,
    kind,
    (k) => [
      petArt(k, PET_COATS[k][0], { size: 48, className: "pet-chip-art" }),
      h("span", { text: PET_WORDS[k] }),
    ],
    (k) => {
      kind = k;
      // Each kind has its own coats: start on its first.
      coat = PET_COATS[k][0];
      paintCoats();
      paint();
    },
    h("div", { class: "pet-kinds" }),
  );
  kinds.row.setAttribute("aria-label", "Kinds");
  name.addEventListener("input", paint);

  const s = sheet(
    {
      id: "adopt-title",
      title: "Adopt a pet",
      className: "pet-sheet adopt-sheet",
      lede: "It lives at your hearth, follows you around your plot, and sleeps by the fire while you're away. Pets are free, and yours for good.",
    },
    h("div", { class: "pet-stage" }, preview, caption),
    h("p", { class: "field-label", text: "Kind" }),
    kinds.row,
    h("p", { class: "field-label", text: "Coat" }),
    coatRow,
    h("label", { class: "field-label", attrs: { for: "pet-name" }, text: "Name" }),
    name,
    problem,
    h("div", { class: "pet-actions" }, submit),
  );
  submit.addEventListener("click", async () => {
    const called = name.value.trim();
    if (!called) {
      problem.textContent = "Give your pet a name first.";
      name.focus();
      return;
    }
    problem.textContent = "";
    const r = await whileBusy(submit, () =>
      api.act({ type: "adopt_pet", kind, coat, name: called }),
    );
    const why = actProblem(r);
    if (why) {
      problem.textContent = why;
      return;
    }
    closeOverlay(s.dialog);
    toast(`${called} came home with you.`);
    await o.adopted?.();
  });
  paintCoats();
  paint();
  openOverlay(s.dialog);
  return s;
}

// ---------- your own pet ----------

/** Where a sheet says how an action went: the site's toast, or the world's own. */
type Say = (text: string) => void;

/** Rename your pet (free, once a day) or give it a new coat (for coins). */
export function openOwnPetSheet(
  pet: Pick<Pet, "kind" | "coat" | "name">,
  after?: () => unknown,
  say: Say = toast,
) {
  let coat: PetCoat = pet.coat;
  const preview = h("div", { class: "pet-preview" });
  const paint = () =>
    preview.replaceChildren(
      petArt(pet.kind, coat, { size: 140, title: petLine({ ...pet, coat }) }),
    );
  const name = h("input", {
    class: "field-input",
    attrs: { id: "pet-rename", maxlength: PETS.nameMax, autocomplete: "off", enterkeyhint: "done" },
  });
  name.value = pet.name;
  const rename = h("button", {
    class: "pill-button small",
    attrs: { type: "button", id: "pet-rename-save" },
    text: "Rename",
  });
  const coats = chips(
    PET_COATS[pet.kind],
    pet.coat,
    (c) => [
      petArt(pet.kind, c, { size: 44, className: "pet-chip-art" }),
      h("span", { text: coatWord(c) }),
    ],
    (c) => {
      coat = c;
      paint();
      groom.disabled = c === pet.coat;
    },
    h("div", { class: "pet-coats" }),
  );
  coats.row.setAttribute("aria-label", "Coats");
  const groom = h("button", {
    class: "btn-primary small",
    attrs: { type: "button", id: "pet-groom", disabled: true },
    text: `New coat for ${PETS.groomFee} coins`,
  });
  const s = sheet(
    {
      id: "own-pet-title",
      title: petCalled(pet),
      className: "pet-sheet",
      closeOnBackdrop: true,
      lede: "Rename it once a day for free. A new coat costs coins, which leave the world for good.",
    },
    h("div", { class: "pet-stage" }, preview),
    h("label", { class: "field-label", attrs: { for: "pet-rename" }, text: "Name" }),
    h("div", { class: "pet-rename" }, name, rename),
    h("p", { class: "field-label", text: "Coat" }),
    coats.row,
    h("div", { class: "pet-actions" }, groom),
  );
  const done = async (ok: boolean) => {
    if (!ok) return;
    closeOverlay(s.dialog);
    await after?.();
  };
  rename.addEventListener("click", async () => {
    const called = name.value.trim();
    if (!called || called === pet.name) return;
    await done(
      await actFromButton(rename, { type: "rename_pet", name: called }, `Now it's ${called}.`, {
        say,
      }),
    );
  });
  groom.addEventListener("click", async () => {
    await done(
      await actFromButton(groom, { type: "groom_pet", coat }, `A new ${coat} coat.`, { say }),
    );
  });
  paint();
  openOverlay(s.dialog);
  return s;
}

// ---------- someone else's pet ----------

/**
 * Pat a pet. The owner's profile when the server took it, with the pet's new count; its answer, or
 * why not, is said either way.
 */
export async function patPet(
  button: HTMLButtonElement,
  owner: string,
  pet: Pick<Pet, "kind" | "name">,
  say: Say = toast,
): Promise<ProfileView | undefined> {
  const r = await whileBusy(button, () => api.patPet(owner));
  if (!r.ok) {
    say(r.message);
    return undefined;
  }
  say(`You patted ${petCalled(pet, "their")}.`);
  return r.data.resident;
}

/** Pick one of your produce to give a pet, from what you hold. */
export async function openTreatSheet(
  owner: string,
  pet: Pick<Pet, "kind" | "name">,
  after?: () => unknown,
  say: Say = toast,
) {
  const list = h("div", { class: "cluster pet-treats" });
  const hint = h("p", { class: "sheet-lede", text: "Looking in your things…" });
  const s = sheet(
    {
      id: "treat-title",
      title: `A treat for ${petCalled(pet, "their")}`,
      className: "pet-sheet treat-sheet",
      closeOnBackdrop: true,
    },
    hint,
    list,
  );
  openOverlay(s.dialog);
  const inv = await api.inventory();
  if (!inv.ok || !inv.data.inventory) {
    hint.textContent = inv.ok ? "Growing hasn't opened in this world yet." : inv.message;
    return;
  }
  const held = new Map(inv.data.inventory.stacks.map((st) => [st.kind, st.count]));
  const yours = TREATS.filter((k) => (held.get(k) ?? 0) > 0);
  hint.textContent = yours.length
    ? "One treat a day keeps a pet happy until midnight UTC."
    : "Treats are something you grew: a strawberry, a pumpkin. Plant something, and come back once it's ready.";
  for (const kind of yours) {
    const b = h(
      "button",
      { class: "pill-button pet-treat", attrs: { type: "button", "data-kind": kind } },
      itemArt(kind, { size: 28 }),
      h("span", { text: `Give ${aThing(kind)}` }),
    );
    b.addEventListener("click", async () => {
      const ok = await actFromButton(
        b,
        { type: "treat_pet", owner, item: kind },
        `${petCalled(pet, "their")} loved ${aThing(kind)}.`,
        { say },
      );
      if (ok) {
        closeOverlay(s.dialog);
        await after?.();
      }
    });
    list.append(b);
  }
}

// ---------- a pet on a profile ----------

export interface PetCardOptions {
  /** Whose profile it is. */
  owner: Pick<ProfileView, "id" | "name">;
  /** Their pet, or undefined when they have none. */
  pet: ProfilePet | undefined;
  /** It's your own profile. */
  mine: boolean;
  /** You're signed in, so you can pat and treat. */
  signedIn: boolean;
  /** Reload the profile after something changed. */
  refresh: () => unknown;
}

/**
 * The pet card on a profile: the pet, its name, and how many residents have patted it, with Pat and
 * Give a treat on someone else's and Rename and New coat on your own. On your own profile with no
 * pet yet, an invitation to adopt one. Undefined on someone else's profile when they have none.
 */
export function petCard(o: PetCardOptions): HTMLElement | undefined {
  const pet = o.pet;
  if (!pet) {
    if (!o.mine) return undefined;
    const teaser = h(
      "div",
      { class: "pet-teaser", attrs: { "aria-hidden": "true" } },
      ...(["cat", "dog", "rabbit", "fox"] as const).map((k) =>
        petArt(k, PET_COATS[k][0], { size: 52 }),
      ),
    );
    const adopt = h("button", {
      class: "btn-primary small",
      attrs: { type: "button", id: "adopt-pet" },
      text: "Adopt a pet",
      on: { click: () => openAdoptSheet({ adopted: o.refresh }) },
    });
    return h(
      "section",
      {
        class: "stack paper card pet-card adopt-card",
        attrs: { "aria-labelledby": "pet-card-title" },
      },
      h("h2", {
        class: "section-title",
        attrs: { id: "pet-card-title" },
        text: "A pet of your own",
      }),
      teaser,
      h("p", {
        class: "pet-card-line",
        text: "A cat, a dog, a hedgehog, or a tortoise to keep your hearth company. Your neighbors can pat it.",
      }),
      h("div", { class: "pet-actions" }, adopt),
    );
  }
  const called = petCalled(pet, o.mine ? "your" : "their");
  const count = h("p", { class: "pet-card-pats", text: patsLine(pet.pats) });
  let art = petArt(pet.kind, pet.coat, { size: 96, title: petLine(pet) });
  const actions = h("div", { class: "cluster pet-actions" });
  if (o.mine) {
    actions.append(
      h("button", {
        class: "pill-button small",
        attrs: { type: "button", id: "pet-change" },
        text: "Rename or new coat",
        on: { click: () => openOwnPetSheet(pet, o.refresh) },
      }),
    );
  } else if (o.signedIn) {
    const pat = h("button", {
      class: "pill-button small pet-pat",
      attrs: { type: "button", "aria-pressed": String(pet.pattedToday === true) },
      text: pet.pattedToday ? "Patted today" : "Pat",
    });
    pat.addEventListener("click", async () => {
      if (pet.pattedToday) {
        toast(`You patted ${called} today. You can again tomorrow.`);
        return;
      }
      const after = await patPet(pat, o.owner.id, pet);
      const now = after?.pet;
      if (!now) return;
      pet.pats = now.pats;
      if (now.pattedToday) pet.pattedToday = true;
      count.textContent = patsLine(pet.pats);
      pat.textContent = "Patted today";
      pat.setAttribute("aria-pressed", "true");
      // It looks happy, and a heart floats up.
      const happy = petArt(pet.kind, pet.coat, { size: 96, face: "happy", title: petLine(pet) });
      art.replaceWith(happy);
      art = happy;
      replay(card, "happy");
    });
    const treat = h("button", {
      class: "pill-button small",
      attrs: { type: "button" },
      text: "Give a treat",
      on: { click: () => void openTreatSheet(o.owner.id, pet, o.refresh) },
    });
    actions.append(pat, treat);
  }
  const card = h(
    "section",
    { class: "stack paper card pet-card", attrs: { "aria-labelledby": "pet-card-title" } },
    h(
      "div",
      { class: "pet-card-body" },
      h(
        "div",
        { class: "pet-card-art" },
        art,
        h("span", { class: "pet-heart", attrs: { "aria-hidden": "true" } }),
      ),
      h(
        "div",
        { class: "stack tight pet-card-text" },
        h("h2", { class: "pet-card-name", attrs: { id: "pet-card-title" }, text: called }),
        h("p", { class: "pet-card-line", text: whosePet(pet, o.mine ? undefined : o.owner.name) }),
        count,
      ),
    ),
    actions.childElementCount ? actions : null,
  );
  return card;
}

// ---------- a pet in the world ----------

export interface WorldPetOptions {
  owner: { id: string; name: string };
  pet: Pick<Pet, "kind" | "coat" | "name">;
  /** You patted it today already. */
  pattedToday: boolean;
  /** After a pat went through: the pet looks happy in the world. */
  patted?: () => void;
  /** The world's own toast, since the site's isn't shown there. */
  say: Say;
}

/** The sheet someone else's pet opens when you tap it in the world. */
export function openWorldPetSheet(o: WorldPetOptions) {
  const called = petCalled(o.pet, "their");
  const pat = h("button", {
    class: "btn-primary small pet-pat",
    attrs: { type: "button", id: "world-pet-pat", "aria-pressed": String(o.pattedToday) },
    text: o.pattedToday ? "Patted today" : `Pat ${called}`,
  });
  const treat = h("button", {
    class: "pill-button small",
    attrs: { type: "button" },
    text: "Give a treat",
  });
  const s = sheet(
    {
      id: "world-pet-title",
      title: called,
      className: "pet-sheet world-pet-sheet",
      closeOnBackdrop: true,
    },
    h(
      "div",
      { class: "pet-card-body" },
      h(
        "div",
        { class: "pet-card-art" },
        petArt(o.pet.kind, o.pet.coat, { size: 88, title: petLine(o.pet) }),
      ),
      h(
        "div",
        { class: "stack tight pet-card-text" },
        h("p", { class: "pet-card-line", text: whosePet(o.pet, o.owner.name) }),
        h("a", {
          class: "text-link",
          attrs: { href: profilePath(o.owner.id) },
          text: `${o.owner.name}'s profile`,
        }),
      ),
    ),
    h("div", { class: "cluster pet-actions" }, pat, treat),
  );
  pat.addEventListener("click", async () => {
    if (o.pattedToday) {
      o.say(`You patted ${called} today. You can again tomorrow.`);
      return;
    }
    if (await patPet(pat, o.owner.id, o.pet, o.say)) {
      o.patted?.();
      closeOverlay(s.dialog);
    }
  });
  treat.addEventListener("click", () => {
    closeOverlay(s.dialog);
    void openTreatSheet(o.owner.id, o.pet, undefined, o.say);
  });
  openOverlay(s.dialog);
  return s;
}
