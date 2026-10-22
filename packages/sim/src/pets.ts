/**
 * Pets (RFC 0019): every resident may adopt one pet, for good. It lives on its owner's resident
 * record as `pet`, absent until `adopt_pet`, so every log from before pets hashes as it did.
 *
 * Only what a pet is lives here: its kind, its coat, its name, and today's treat. Where it is and
 * what it's doing (following its owner, napping, asleep by the hearth) is drawn by each client
 * from what it already has, like facing and motion (decision 0067), and patting is a social row on
 * the server, like praise (decision 0047). Nothing about a pet earns coins or karma.
 *
 * Once a day a pet can go out on the green in the middle of a town square (RFC 0045), where it
 * meets the other pets out there. The first meeting of its day with a pet from another household
 * earns both owners a few Hosting points.
 */

import { coinCount, refuse } from "./check";
import { nearestPark, notAtDoor } from "./doors";
import { isTownsfolk, movePurse, sameHousehold } from "./economy";
import { standingFloor } from "./floors";
import {
  addStack,
  CROPS,
  type Crop,
  closed,
  held,
  ITEM_INFO,
  inventory,
  inventoryEvent,
  isCrop,
} from "./items";
import { earned, petMeetEarns } from "./levels";
import { residentById } from "./own";
import type {
  Command,
  ItemsState,
  Rejection,
  Resident,
  ResidentId,
  WorldEvent,
  WorldState,
} from "./types";
import { chebyshev } from "./world";

/** The kinds of pet. New kinds go on the end. */
export const PET_KINDS = [
  "cat",
  "dog",
  "rabbit",
  "hedgehog",
  "duck",
  "frog",
  "fox",
  "tortoise",
] as const;
export type PetKind = (typeof PET_KINDS)[number];

/** Each kind's coats, in the order the adopt sheet shows them. New coats go on the end of a list. */
export const PET_COATS = {
  cat: ["ginger", "tabby", "black", "calico"],
  dog: ["golden", "chocolate", "spotted", "cream"],
  rabbit: ["brown", "white", "grey", "patched"],
  hedgehog: ["brown", "cream", "grey", "cinnamon"],
  duck: ["white", "yellow", "mallard", "brown"],
  frog: ["green", "gold", "blue", "spotted"],
  fox: ["red", "arctic", "silver", "sand"],
  tortoise: ["olive", "amber", "slate", "star"],
} as const satisfies Record<PetKind, readonly string[]>;
export type PetCoat = (typeof PET_COATS)[PetKind][number];

/** Every coat name once, in the order the kinds first list them. */
export const ALL_PET_COATS: readonly PetCoat[] = [
  ...new Set(PET_KINDS.flatMap((kind): readonly PetCoat[] => PET_COATS[kind])),
];

/** The numbers (decision 0090). */
export const PETS = {
  /** The longest name, in characters. */
  nameMax: 20,
  /** Coins a new coat costs. Every one is burned. */
  groomFee: 20,
} as const;

/** A resident's pet. Every field but the first three is absent until it's set. */
export interface Pet {
  kind: PetKind;
  coat: PetCoat;
  /** Untrusted text, cleaned and filtered by the server before it was logged. */
  name: string;
  /** The world's day it came home. Absent in a world that doesn't count days. */
  adoptedDay?: number;
  /** The day of its last rename. Absent until the first, so a new pet can be renamed at once. */
  renamedDay?: number;
  /** Its last treat: the day, who gave it, and what. Happy until that day ends. */
  treat?: PetTreat;
  /** The day it last went out on a green (RFC 0045). Happy until that day ends. */
  walkedDay?: number;
  /** The day of its last counted meeting on a green, which earns once a day. */
  metDay?: number;
}

export interface PetTreat {
  day: number;
  by: ResidentId;
  kind: Crop;
}

export const isPetKind = (value: unknown): value is PetKind =>
  typeof value === "string" && (PET_KINDS as readonly string[]).includes(value);

/** Whether `coat` is one of `kind`'s coats. */
export const isCoatOf = (kind: PetKind, coat: unknown): coat is PetCoat =>
  typeof coat === "string" && (PET_COATS[kind] as readonly string[]).includes(coat);

/** A pet as an event or a view carries it: a copy, with its treat copied too. */
export function petView(pet: Pet): Pet {
  return { ...pet, ...(pet.treat ? { treat: { ...pet.treat } } : {}) };
}

/** Whether a pet had a treat today, so it's happy until the day ends. */
export const treatedToday = (pet: Pick<Pet, "treat">, day: number | undefined) =>
  day !== undefined && pet.treat?.day === day;

/** Whether a pet went out on a green today (RFC 0045), so it's happy until the day ends. */
export const walkedToday = (pet: Pick<Pet, "walkedDay">, day: number | undefined) =>
  day !== undefined && pet.walkedDay === day;

type Mutation = () => WorldEvent[];
export type PetsChecked = Mutation | Rejection;

/** A name as the sim keeps it, or why it can't be one. */
function nameOf(value: unknown): string | Rejection {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > PETS.nameMax) {
    return refuse("invalid_pet", `A pet's name is 1 to ${PETS.nameMax} characters.`);
  }
  return name;
}

const coatsLine = (kind: PetKind) => `A ${kind}'s coat is one of: ${PET_COATS[kind].join(", ")}.`;

/** The acting resident. `check` in apply.ts only hands these commands to someone online. */
const actorOf = (state: WorldState, actor: ResidentId) => state.residents[actor] as Resident;

/** `adopt_pet {kind, coat, name}`: a pet comes home with you, free. One each, for good. */
export function checkAdoptPet(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "adopt_pet" }>,
): PetsChecked {
  const me = actorOf(state, actor);
  if (me.pet) {
    return refuse(
      "already_have",
      "You already have a pet, and a pet is for good. Rename it with rename_pet, or give it a new coat with groom_pet.",
    );
  }
  const { kind, coat } = command;
  if (!isPetKind(kind)) {
    return refuse("invalid_pet", `A pet is one of: ${PET_KINDS.join(", ")}.`);
  }
  if (!isCoatOf(kind, coat)) return refuse("invalid_pet", coatsLine(kind));
  const name = nameOf(command.name);
  if (typeof name !== "string") return name;
  if (!me.hearth) {
    return refuse(
      "no_hearth",
      "A pet lives at your hearth, so set one first. Try build_starter_home, which sets one for you.",
    );
  }
  const pet: Pet = {
    kind,
    coat,
    name,
    ...(state.day === undefined ? {} : { adoptedDay: state.day }),
  };
  return () => {
    me.pet = pet;
    return [{ type: "pet_adopted", residentId: actor, pet: petView(pet) }];
  };
}

/** `rename_pet {name}`: free, once a UTC day. A new pet can be renamed right away. */
export function checkRenamePet(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "rename_pet" }>,
): PetsChecked {
  const me = actorOf(state, actor);
  const pet = me.pet;
  if (!pet) return refuse("no_pet", "You don't have a pet yet. Adopt one with adopt_pet.");
  const name = nameOf(command.name);
  if (typeof name !== "string") return name;
  if (name === pet.name) return refuse("invalid_pet", "That's already its name.");
  const day = state.day;
  if (day !== undefined && pet.renamedDay === day) {
    return refuse("pet_limit", "You can rename your pet once a day. Try again after midnight UTC.");
  }
  return () => {
    me.pet = { ...pet, name, ...(day === undefined ? {} : { renamedDay: day }) };
    return [
      { type: "pet_renamed", residentId: actor, name, ...(day === undefined ? {} : { day }) },
    ];
  };
}

/** `groom_pet {coat}`: a new coat from its kind's list, for `PETS.groomFee` coins, all burned. */
export function checkGroomPet(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "groom_pet" }>,
): PetsChecked {
  const me = actorOf(state, actor);
  const pet = me.pet;
  if (!pet) return refuse("no_pet", "You don't have a pet yet. Adopt one with adopt_pet.");
  const { coat } = command;
  if (!isCoatOf(pet.kind, coat)) return refuse("invalid_pet", coatsLine(pet.kind));
  if (coat === pet.coat) return refuse("invalid_pet", "That's already its coat.");
  const econ = state.economy;
  const day = state.day;
  if (!econ || day === undefined) {
    return refuse("economy_closed", "A new coat costs coins, and coins aren't open yet.");
  }
  if (isTownsfolk(state, actor)) {
    return refuse("not_eligible", "Townsfolk keep their coins for the town.");
  }
  const fee = PETS.groomFee;
  const have = econ.coins[actor] ?? 0;
  if (have < fee) {
    return refuse(
      "not_enough_coins",
      `A new coat is ${coinCount(fee)}, and you have ${coinCount(have)}.`,
    );
  }
  const at = { seq: state.seq + 1, day };
  return () => {
    me.pet = { ...pet, coat };
    econ.burned += fee;
    return [
      { type: "pet_groomed", residentId: actor, coat },
      movePurse(econ, actor, -fee, "groom", at),
    ];
  };
}

/**
 * `treat_pet {owner, item}`: one of your produce goes to `owner`'s pet, which is happy until the
 * day ends. One treat a pet a day, from anyone, its owner included. Blocks are the server's to
 * check: the sim can't see them.
 */
export function checkTreatPet(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "treat_pet" }>,
): PetsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const day = state.day as number;
  const owner = residentById(state, command.owner);
  if (!owner) return refuse("unknown_resident", "Nobody in the world has that id.");
  const pet = owner.pet;
  if (!pet) {
    return refuse(
      "no_pet",
      owner.id === actor
        ? "You don't have a pet yet. Adopt one with adopt_pet."
        : "They don't have a pet.",
    );
  }
  const { item } = command;
  if (!isCrop(item)) {
    return refuse("unknown_item", `A treat is something you grew: ${CROPS.join(", ")}.`);
  }
  if (held(items.inventories[actor], item) < 1) {
    return refuse("not_enough_items", `You have no ${ITEM_INFO[item].plural.toLowerCase()}.`);
  }
  if (treatedToday(pet, day)) {
    return refuse(
      "pet_limit",
      "That pet has had its treat today. Try again tomorrow; a pat is always welcome.",
    );
  }
  const treat: PetTreat = { day, by: actor, kind: item };
  return () => {
    owner.pet = { ...pet, treat };
    const change = addStack(inventory(items, actor), item, -1);
    return [
      { type: "pet_treated", residentId: owner.id, by: actor, kind: item },
      inventoryEvent(actor, "treat", [change], owner.id === actor ? {} : { with: owner.id }),
    ];
  };
}

/**
 * Why `me` isn't on a green, or null when they are: on the ground floor within `config.reach` of
 * the middle of the green `nearestPark` sends them to (RFC 0045). The refusal names the walk.
 * Clients call it to show the Walk button only where `walk_pet` would go.
 */
export function notAtTheGreen(
  state: WorldState,
  me: Pick<Resident, "x" | "y" | "floor">,
): Rejection | null {
  return notAtDoor(state, me, nearestPark(state, me), {
    lead: "Pets go out on the green, the middle of a town square.",
    doing: "take your pet out",
    there: "the green",
  });
}

/**
 * Whether `me` stands on one of `greens`, given as their middles (`parkTile`): on the ground floor
 * within `config.reach` of one. The same answer `notAtTheGreen` gives, for a reader with the
 * squares and not the world: the web shows its Walk button and draws a pet out on the green by it.
 */
export function onGreen(
  config: Pick<WorldState["config"], "reach">,
  greens: readonly { x: number; y: number }[],
  me: Pick<Resident, "x" | "y" | "floor">,
): boolean {
  return standingFloor(me) === 0 && greens.some((g) => chebyshev(me, g) <= config.reach);
}

/**
 * Whether two owners' pets meeting counts toward a pet's meeting of the day: two households, and
 * neither of them townsfolk, whose pets the server walks and whose meetings would be points
 * handed out by the town.
 */
const meetingCounts = (state: WorldState, a: ResidentId, b: ResidentId) =>
  !isTownsfolk(state, a) && !isTownsfolk(state, b) && !sameHousehold(state, a, b);

/**
 * `walk_pet {}`: take your pet out on the green you stand on, once a day (RFC 0045). It meets every
 * pet out today whose owner is online on the same green's ground floor. The first counted meeting
 * of each pet's day (`meetingCounts`) sets its `metDay` and earns its owner `PROGRESS.petMeet`
 * Hosting points, the walker's and the met owners' alike, so the first pet out isn't left with
 * nothing. Where anyone's pet stands is still drawing only.
 */
export function checkWalkPet(state: WorldState, actor: ResidentId): PetsChecked {
  const me = actorOf(state, actor);
  const pet = me.pet;
  if (!pet) return refuse("no_pet", "You don't have a pet yet. Adopt one with adopt_pet.");
  const day = state.day;
  if (day === undefined) return refuse("not_due", "Pets go out once the world counts days.");
  if (walkedToday(pet, day)) {
    return refuse(
      "pet_limit",
      "Your pet has been out today. Take it out again after midnight UTC.",
    );
  }
  const away = notAtTheGreen(state, me);
  if (away) return away;
  const green = nearestPark(state, me);
  const reach = state.config.reach;
  const met = Object.values(state.residents)
    .filter(
      (r) =>
        r.id !== actor &&
        r.online &&
        standingFloor(r) === 0 &&
        r.pet !== undefined &&
        walkedToday(r.pet, day) &&
        chebyshev(r, green) <= reach,
    )
    .map((r) => r.id)
    .sort();
  const fresh = (id: ResidentId) => residentById(state, id)?.pet?.metDay !== day;
  const theirs = met.filter((id) => meetingCounts(state, actor, id) && fresh(id));
  const mine = fresh(actor) && met.some((id) => meetingCounts(state, actor, id));
  const counted = [...(mine ? [actor] : []), ...theirs];
  const points = counted.map((id) => petMeetEarns(state, id));
  return () => {
    me.pet = { ...pet, walkedDay: day, ...(mine ? { metDay: day } : {}) };
    for (const id of theirs) {
      const owner = residentById(state, id) as Resident;
      owner.pet = { ...(owner.pet as Pet), metDay: day };
    }
    return [
      {
        type: "pet_walked",
        residentId: actor,
        day,
        met,
        ...(counted.length > 0 ? { counted } : {}),
      },
      ...points.flatMap(earned),
    ];
  };
}
