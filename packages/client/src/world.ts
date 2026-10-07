/**
 * The canvas world: landing curtain, live connection, input, and the render loop. Loaded as its own
 * chunk and started only on `/world`; `stopWorld` cancels the loop and closes the socket, so the
 * feed pages stay light on phones.
 */

import {
  type Action,
  type ChatChannel,
  facingToward,
  type ServerMessage,
  WorldSnapshot,
} from "@terrakin/protocol";
import {
  type BlockKind,
  canBuildOn,
  type Direction,
  directionOf,
  type GroundKind,
  ITEM_INFO,
  isGroundKind,
  isHeldBlock,
  pickupsInReach,
  plotOf,
  type Resident,
  route,
  STEP,
  settleProblem,
  type Tile,
  tileKey,
  waterBeside,
} from "@terrakin/sim";
import { REDUCED_MOTION } from "@terrakin/ui/motion";
import { plot3dPath } from "@terrakin/ui/paths";
import { everyVisible } from "@terrakin/ui/poll";
import { linkTabs, pickTab, whileBusy } from "@terrakin/ui/ui";
import { api, whoseKey } from "./api";
import {
  blockLine,
  canLay,
  groundLine,
  HELD_KINDS,
  type Holdings,
  heldLine,
  heldOf,
  holdingsFromStacks,
  PALETTE_TAB_WORDS,
  PALETTE_TABS,
  type PaletteTab,
  paintGroundRow,
  paintHeldRow,
  tabOf,
  withChanges,
} from "./build-palette";
import { type Camera, fitScale, screenToTile } from "./camera";
import { Feelings, gestureReaction } from "./feelings";
import { canDig, noRodLine, pondLine, rodsAfter, rodsIn } from "./fishing";
import { openHomeSheet } from "./home-sheet";
import { createLanding } from "./landing";
import { Mirror } from "./mirror";
import { Motion } from "./motion";
import { Connection, type Identity, savedToken, saveToken } from "./net";
import { openWorldPetSheet, patPet } from "./pet-sheet";
import { PatsToday, PetMotion, petCalled } from "./pets";
import { blockColor, CAST_MS, type CastMark, HEARTH_COLOR, render } from "./render";
import { dozerAt } from "./scene3d/layout";
import type { World3d } from "./scene3d/world";
import { approach, type Quarter, turnDir } from "./scene3d/world-layout";
import { SoundSwitch } from "./sound/switch";
import { reloadForNewerServer } from "./stale-bundle";
import { track } from "./telemetry";
import { NO_PLOT_LINE, newsLine, othersPickupLine, toastMs, worldProblem } from "./things";
import { dayPhase } from "./time";
import { ARRIVAL_KEY, type FoldedWaves, foldWaves, gestureLine, wavesLine } from "./together";
import { visitCard } from "./visit-card";
import { Walker } from "./walk";
import { Sky, skyNow } from "./weather";
import type { WorldLoader } from "./world-loader";
import { offer3d, readSignals, savedMode, saveMode, startMode, type WorldMode } from "./world-mode";
import { mountNextStep } from "./world-next-step";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("world");
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const curtain = $("curtain");
const hud = $("hud");
const status = $("status");
const toast = $("toast");
const worldWait = $("world-wait");
const opening3d = $("world-3d-wait");
const chatPanel = $("chat");
const chatLog = $<HTMLOListElement>("chat-log");
const chatInput = $<HTMLInputElement>("chat-input");
const chatToggle = $("chat-toggle");
const buildButton = $("build");
const palette = $("palette");
const paletteRows: Record<PaletteTab, HTMLElement> = {
  blocks: $("palette-blocks"),
  ground: $("palette-ground"),
  furniture: $("palette-furniture"),
};
const paletteLine = $("palette-line");
// The build bar's tabs, over the rows they show.
const paletteTabs = linkTabs(
  PALETTE_TABS.map((tab) => ({
    current: tab === "blocks",
    content: [PALETTE_TAB_WORDS[tab]],
    id: `palette-tab-${tab}`,
    panel: `palette-${tab}`,
  })),
  {
    label: "What to build",
    className: "palette-tabs",
    pick: (i) => showTab(PALETTE_TABS[i] ?? "blocks"),
  },
);
palette.prepend(paletteTabs);
const modeButton = $<HTMLButtonElement>("world-mode");
const petButton = $<HTMLButtonElement>("world-pet");
const gatherButton = $<HTMLButtonElement>("world-gather");
/** Shown while you stand beside water (RFC 0023): cast a line. */
const fishButton = $<HTMLButtonElement>("world-fish");
const claimButton = $<HTMLButtonElement>("claim");
/** Takes Claim plot's place once you own all the plots you may: your things are a tap away. */
const thingsLink = $<HTMLAnchorElement>("hud-things");
const enterButton = $<HTMLButtonElement>("world-enter");
const host3d = $("world-3d");
/** The speaker button: sound is off until it's tapped, and its code loads then (decision 0097). */
const sound = new SoundSwitch($<HTMLButtonElement>("sound"));

const motionQuery = window.matchMedia(REDUCED_MOTION);
/** What figures show in reaction to what happens to them (RFC 0013). Drawing only. */
const feelings = new Feelings();
/** Slides, hops, sways, dozing, and speech bubbles, for the map and the 3D view alike. */
const motion = new Motion();
/** The weather drifting in and out, for the map and the 3D view alike (decision 0073). */
const sky = new Sky();
/** Where pets are and what they're doing (RFC 0019), for the map and the 3D view alike. */
const pets = new PetMotion();
/** Standing this close to someone's pet, in tiles, offers to pat it. */
const PAT_NEAR = 1.6;
/** Whose pet the Pat button is for now, and when it last looked. */
let petNear: string | undefined;
let petCheckAt = 0;
/** "Gather all" waiting on the server's answer: its action's id, and how to stop waiting. */
let gathering: { id: string; done: () => void } | undefined;
/** How long "Gather all" waits on an answer before it can be tapped again. */
const GATHER_WAIT_MS = 5000;
/** The pets you've patted today, from here or anywhere else: the server takes one pat a day. */
const patsToday = new PatsToday(
  async (owner) => {
    const r = await api.profile(owner);
    return r.ok && r.data.resident.pet?.pattedToday === true;
  },
  () => paintPetButton(performance.now()),
);

let active = false;
let rafId = 0;
let stopPopulation: (() => void) | undefined;
let conn: Connection | undefined;
let mirror: Mirror | undefined;
let me: string | undefined;
/** How the world asks the site router to go to another page (the Town Hall, your plot in 3D). */
let navigate: ((path: string) => void) | undefined;
/** The loader a returning resident sees until the world is drawn (world-loader.ts). */
let loader: WorldLoader | undefined;
/** How long the loader waits on the 3D scene before lifting onto the map in the meantime. */
const SCENE_WAIT_MS = 8000;
let sceneWait = 0;
let buildMode = false;
/**
 * The build bar's pick (RFC 0016): a block or the hearth marker on the Blocks tab, a path or floor
 * on the Paths tab, or decor or furniture you hold on the Furniture tab.
 */
let pick: BlockKind | GroundKind | "hearth" = "wood";
/** What you hold that the build bar shows: decor and furniture counts, and what paths take. */
let holdings: Holdings = new Map();
/** The fishing rods you hold, by id (RFC 0023): with none, Fish says how to make one. */
let rods: ReadonlySet<string> = new Set();
/** Casts made lately, anyone's, drawn on the water for a moment. */
let casts: CastMark[] = [];
/** The chat line waiting for the server's answer: its text leaves the input only once accepted. */
let pendingChat: { id: string; text: string } | undefined;
/** Routine waves from neighbors at home, folded into one line while they come close together. */
let waves: FoldedWaves | undefined;
/**
 * Your steps: keys, the d-pad, and taps on the world, walked at your figure's pace and drawn before
 * the server answers (`walk.ts`). One step every 200ms keeps a held key well under the action rate
 * limit (10 a second).
 */
const walker = new Walker({
  at: () => self(),
  ground: () => mirror?.ground(),
  behind: () => (me ? motion.behind(me) : 0),
  steer,
  send: (dir) => {
    const id = act({ type: "move", dir });
    // A footstep for each step your figure takes, on the path or floor it steps onto.
    const from = walker.ahead;
    if (id && from)
      sound.step(mirror?.paving.get(`${from.x + STEP[dir][0]},${from.y + STEP[dir][1]}`));
    return id;
  },
  bumped: (dir, why) => {
    if (me) motion.bump(me, dir, performance.now());
    showToast(why);
  },
});
/** The card on someone else's plot: Admire and Next plot (RFC 0020). */
const visiting = visitCard({
  visit(px, py) {
    // Like Home: no more steps, and none until the jump lands.
    walker.stop();
    const id = tryAct({ type: "visit", px, py });
    if (id) walker.awaiting(id, performance.now());
    return id;
  },
  knock: (px, py) => tryAct({ type: "trick_or_treat", px, py }),
  toast: (text) => showToast(text),
});
/** The chip naming your next first step, in the near-actions slot while it is free. */
mountNextStep({ navigate: (path) => navigate?.(path) });
/** How quickly the map's camera catches up with your figure, per second. */
const CAMERA_RATE = 10;
let lastFrame = 0;
let resyncing = false;
/** True between pressing "Step inside" and the server's welcome, so we count a join once. */
let joiningFresh = false;
/** Server time anchor from the latest snapshot, plus when we received it locally. */
let dayAnchor: { nowMs: number; dayLengthMs: number; receivedAt: number } | undefined;
const cam: Camera = { cx: 0, cy: 0, scale: 32, width: 0, height: 0 };
/** 2D map or 3D view (decision 0060). The 2D map is the default; the choice is remembered. */
let mode: WorldMode = "2d";
let world3d: World3d | undefined;
let loading3d = false;
const signals = readSignals();
modeButton.hidden = !offer3d(signals);

// ---------- landing ----------

const landing = createLanding(curtain, {
  onJoin(choice) {
    joiningFresh = true;
    landing.setJoining(true);
    connect({ ...choice, kind: "human" });
  },
  async onRestore(key) {
    const who = await whoseKey(key);
    if (!who.ok) return who.message;
    saveToken(key, who.data.id);
    enterWorld();
    hud.hidden = false;
    connect({ token: key });
    return null;
  },
});

/** Leave the landing for the world: lift the curtain and bring the world into focus. */
function enterWorld(instant = false) {
  canvas.classList.remove("veiled");
  document.body.classList.add("in-world");
  landing.hide({ instant });
}

/** Back to the landing, with the world soft and drifting behind it. */
function leaveWorld() {
  loader?.hide();
  close3d();
  sound.leave();
  joiningFresh = false;
  worldWait.hidden = true;
  canvas.classList.add("veiled");
  document.body.classList.remove("in-world");
  landing.show();
}

function updatePopulation() {
  if (!mirror) return;
  let total = 0;
  let online = 0;
  for (const r of mirror.residents.values()) {
    if (mirror.townsfolk.has(r.id)) continue;
    total++;
    if (r.online) online++;
  }
  landing.setPopulation(total, online);
}

/** Keep the "online now" line fresh while someone reads the landing page. */
function watchPopulation() {
  stopPopulation ??= everyVisible(20_000, () => {
    if (landing.isUp()) void resync();
  });
}

// ---------- connection ----------

function connect(identity: Identity) {
  conn?.close();
  conn = new Connection(identity, onMessage, (s) => {
    status.textContent =
      s === "online" ? "" : s === "connecting" ? "Connecting…" : "Offline, retrying…";
    if (s === "offline" && joiningFresh && !me)
      landing.setError("Can't reach the world right now. Still trying…");
    // Coming back with a saved key and no answer yet: say so, rather than show an empty world.
    if (s === "offline" && !me && !hud.hidden) {
      loader?.hide();
      worldWait.hidden = false;
    }
    if (s !== "online") stopWalking();
  });
}

/** The server turned a new character away (a name it refuses, too many joins): back to the form. */
function joinRefused(code: string, message: string) {
  joiningFresh = false;
  conn?.close();
  conn = undefined;
  landing.setJoining(false);
  landing.setError(message);
  if (code === "invalid_profile") landing.focusNote();
  else landing.focusName();
}

/** The saved key doesn't match anyone (the world was reset, or the key was revoked). */
function keyNotFound() {
  conn?.close();
  conn = undefined;
  me = undefined;
  hud.hidden = true;
  leaveWorld();
  landing.setError(
    "We couldn't find your character in this browser. If you saved your key, restore it below, or make a new one.",
  );
  landing.openRestore();
  watchPopulation();
  void resync();
}

/** Whether you own a plot, or share one, as far as the mirror shows. */
function hasPlot(): boolean {
  if (!mirror || !me) return false;
  for (const owner of mirror.plots.values()) if (owner === me) return true;
  for (const shared of mirror.coOwners.values()) if (shared.includes(me)) return true;
  return false;
}

/** Nothing in flight and nothing to walk: a new connection, or leaving. */
function stopWalking() {
  walker.reset();
}

/** Remember the server's day/night anchor and when it arrived. No anchor means no night. */
function anchor(time: WorldSnapshot["time"]) {
  return { ...time, receivedAt: performance.now() };
}

/** Reload the world from the server. One at a time; events are ignored until it lands. */
async function resync() {
  if (resyncing) return;
  resyncing = true;
  const wasIn = me !== undefined;
  try {
    const parsed = WorldSnapshot.safeParse(await (await fetch("/v1/world")).json());
    // A welcome that landed meanwhile brought its own world, and its events build on that one.
    if (!wasIn && me) return;
    if (parsed.success) {
      mirror = new Mirror(parsed.data);
      // Steps taken against the old copy may have missed what changed: start over from this one.
      walker.reset();
      dayAnchor = anchor(parsed.data.time);
      updatePopulation();
      if (!wasIn) loader?.reach("world");
    } else {
      console.warn("Bad snapshot from server", parsed.error);
      reloadForNewerServer();
    }
  } catch (err) {
    console.warn("Resync failed", err);
  } finally {
    resyncing = false;
  }
}

function onMessage(msg: ServerMessage) {
  switch (msg.type) {
    case "welcome":
      me = msg.residentId;
      mirror = new Mirror(msg.world);
      dayAnchor = anchor(msg.world.time);
      stopWalking();
      if (joiningFresh) track("join");
      joiningFresh = false;
      landing.setJoining(false);
      landing.setError("");
      enterWorld();
      hud.hidden = false;
      worldWait.hidden = true;
      snapCamera();
      if (mode === "3d") open3d();
      revealWhenDrawn();
      showArrival();
      void loadHoldings();
      sound.enter();
      break;
    case "gesture":
      if (msg.routine) {
        // A neighbor away at home waved as you walked past (RFC 0009): they wave from where they
        // sleep, and waves close together are one line.
        waves = foldWaves(waves, msg.from.name, performance.now());
        showToast(wavesLine(waves), "player");
        feelings.show(msg.from.id, gestureReaction("wave"), performance.now());
      } else {
        // Someone sent you a hug or a wave. Their name and note are their words: shown as text.
        showToast(gestureLine(msg.kind, msg.from.name, msg.note, msg.putter, msg.item), "player");
      }
      // Your figure answers it: love for a hug, a wave back for a wave. Only the kind decides.
      // A kiss arrives only once it's mutual (decision 0066), so it can show here like the rest.
      if (me) feelings.show(me, gestureReaction(msg.kind), performance.now());
      sound.gesture(msg.kind);
      break;
    case "event": {
      // An away resident's routine walks them from where they were (decision 0083).
      const ev = msg.event;
      const walker =
        ev.type === "moved" && ev.routine ? mirror?.residents.get(ev.residentId) : undefined;
      if (walker && !walker.online) motion.setOut(walker, performance.now());
      // Out of step with the server? Reload the truth rather than guessing.
      const applied = mirror && !resyncing ? mirror.apply(msg) : undefined;
      if (applied === "gap") void resync();
      // Each step someone takes joins their walk, so a burst of them is walked, not jumped.
      if (applied === "applied" && msg.event.type === "moved") {
        const { residentId, x, y } = msg.event;
        motion.moved(residentId, x, y, performance.now());
      }
      // A knock for a block you placed, a chime for someone admiring what you made: yours only.
      if (applied === "applied" && me) sound.event(msg.event, me);
      // Halloween night (RFC 0022): the card on a neighbor's plot marks a door you knocked at.
      if (msg.event.type === "trick_or_treated" && msg.event.by === me) {
        visiting.knocked(msg.event.px, msg.event.py);
      }
      // A plot you just claimed offers a home, then asks for a name (decisions 0144 and 0121).
      if (applied === "applied" && msg.event.type === "plot_claimed" && msg.event.ownerId === me) {
        const { px, py } = msg.event;
        openHomeSheet({ plot: { px, py }, say: showToast, buildMyself: buildFromHearth });
      }
      // A cast (RFC 0023), anyone's: its float, its rings, and what it brought up, on the water.
      if (applied === "applied" && msg.event.type === "fished") {
        const { x, y, caught } = msg.event;
        casts = [...casts, { x, y, caught, at: performance.now() }];
      }
      // Your own news, in plain words. Notes, labels, and names stay out of it.
      const line = me ? newsLine(msg.event, me) : null;
      if (line) showToast(line);
      // What you hold changes the build bar: decor and furniture counts, and what paths take.
      if (msg.event.type === "inventory" && msg.event.residentId === me) {
        rods = rodsAfter(rods, msg.event);
        const next = withChanges(holdings, msg.event.changes);
        if (next !== holdings) {
          const wasHeld = isHeldBlock(pick) ? heldOf(holdings, pick) : 0;
          holdings = next;
          if (isHeldBlock(pick) && wasHeld > 0 && heldOf(holdings, pick) === 0) {
            showToast(`That was your last ${ITEM_INFO[pick].name.toLowerCase()}.`);
          }
          paintPalette();
        }
      }
      break;
    }
    case "pet_patted":
      // Someone patted a pet: it looks happy wherever it's drawn. Who did isn't said.
      pets.pat(msg.owner, performance.now());
      break;
    case "chat":
      addChat(msg.from.name, msg.from.kind, msg.text, msg.channel);
      // Figures near the speaker look their way, and the words show over the speaker's head.
      feelings.heard(msg.from.id, performance.now());
      motion.say(msg.from.id, msg.text, performance.now());
      break;
    case "ack":
      if (msg.id !== undefined) walker.answered(msg.id, true);
      if (gathering && msg.id === gathering.id) gathering.done();
      if (pendingChat && msg.id === pendingChat.id) {
        // Sent: clear the line, unless you've started another one meanwhile.
        if (chatInput.value.trim() === pendingChat.text) chatInput.value = "";
        pendingChat = undefined;
      }
      break;
    case "error": {
      const { code, message } = msg.error;
      // A step the mirror said was open was turned down (someone built there meanwhile): the
      // walker stops and goes back to where the server says you are.
      if (msg.id !== undefined) {
        walker.answered(msg.id, false);
        visiting.refused(msg.id, code);
      }
      if (gathering && msg.id === gathering.id) gathering.done();
      // Before the welcome, any refusal is about joining: the form says why.
      if (joiningFresh && !me) return joinRefused(code, message);
      if (code === "unauthorized") return keyNotFound();
      // A refused chat line stays in the input, so it isn't lost.
      if (pendingChat && msg.id === pendingChat.id) pendingChat = undefined;
      // A second tap on Claim lands after the first made the plot yours: nothing went wrong.
      const r = self();
      if (code === "plot_owned" && r && mirror?.ownerAt(r.x, r.y) === me) return;
      showToast(worldProblem(code, message, { hasPlot: hasPlot() }));
      break;
    }
  }
}

/** The welcome line an invite leaves for your first arrival, shown once. */
function showArrival() {
  try {
    const line = sessionStorage.getItem(ARRIVAL_KEY);
    sessionStorage.removeItem(ARRIVAL_KEY);
    if (line) showToast(line);
  } catch {
    // No storage: no welcome line.
  }
}

function act(action: Action): string | undefined {
  return conn?.send(action);
}

const OFFLINE_LINE = "Not connected yet. Try again in a moment.";

/** Send something you tapped for. With the socket down, say so rather than drop it. */
function tryAct(action: Action): string | undefined {
  const id = act(action);
  if (id === undefined) showToast(OFFLINE_LINE);
  return id;
}

// ---------- chat (untrusted text: textContent only, never innerHTML) ----------

function addChat(name: string, kind: "human" | "agent", text: string, channel: ChatChannel) {
  const li = document.createElement("li");
  const who = document.createElement("b");
  const label = kind === "agent" ? `${name} ⚙` : name;
  who.textContent = channel === "world" ? `${label} (to everyone)` : label;
  li.append(who, document.createTextNode(` ${text}`));
  chatLog.append(li);
  while (chatLog.children.length > 100) chatLog.firstElementChild?.remove();
  chatLog.scrollTop = chatLog.scrollHeight;
  if (chatPanel.hidden) showToast(`${who.textContent}: ${text}`, "player");
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastAt = 0;
/** System lines this close together came from one action (home: coins and the pantry). */
const TOAST_JOIN_MS = 400;
/** Player text (chat, names, notes) gets its own style so it can't pass for a system message. */
function showToast(text: string, source: "system" | "player" = "system") {
  const now = performance.now();
  const shown = toast.textContent ?? "";
  // Show lines from one action together, rather than the last one wiping out the rest.
  const join =
    source === "system" &&
    now - toastAt < TOAST_JOIN_MS &&
    toast.classList.contains("show") &&
    !toast.classList.contains("player");
  const line = !join ? text : shown.includes(text) ? shown : `${shown} ${text}`;
  toastAt = now;
  toast.textContent = line;
  toast.classList.toggle("player", source === "player");
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), toastMs(line, source));
}

// ---------- input ----------

const pad = document.querySelector<HTMLElement>(".dpad");
const padButtons = [...document.querySelectorAll<HTMLButtonElement>(".dpad button")];
const DIR_NAMES: Record<Direction, string> = {
  n: "North",
  e: "East",
  s: "South",
  w: "West",
  ne: "Northeast",
  nw: "Northwest",
  se: "Southeast",
  sw: "Southwest",
};
/** What "up" on the d-pad and arrow keys means: north on the map, away from the camera in 3D. */
let padQuarter: Quarter = 0;
let padIn3d = false;
/** The north needle's angle in degrees, kept running so it always turns the short way. */
let padNorth = 0;

/** A d-pad or key direction (up is "n") as the world direction it walks. */
function steer(dir: Direction): Direction {
  return turnDir(dir, padQuarter);
}

/**
 * Follow the 3D camera: each button walks the way its arrow points on screen and says so to
 * screen readers, and in 3D the hub's needle points north. Only the input changes; `move` doesn't.
 */
function paintPad(quarter: Quarter, in3d: boolean) {
  if (quarter === padQuarter && in3d === padIn3d) return;
  const turn = (((padQuarter - quarter) % 4) + 4) % 4;
  padNorth += (turn === 3 ? -1 : turn) * 90;
  padQuarter = quarter;
  padIn3d = in3d;
  pad?.toggleAttribute("data-compass", in3d);
  pad?.style.setProperty("--north", `${padNorth}deg`);
  for (const button of padButtons)
    button.setAttribute("aria-label", DIR_NAMES[steer(button.dataset.dir as Direction)]);
}

function self() {
  return me ? mirror?.residents.get(me) : undefined;
}

/** Where you'll be once the steps you've taken land: what you can reach from next. */
function here(): Tile | undefined {
  return walker.ahead ?? self();
}

/**
 * Walk to a tile, or until it's within `near` tiles, around whatever is in the way, with the
 * sim's own walking rule. `arrive` runs once the walk ends.
 */
function walkToward(tile: Tile, near = 0, arrive?: () => void) {
  walker.walkTo({
    plan: (from) => (mirror ? route(mirror.ground(), from, tile, near) : []),
    ...(arrive ? { arrive } : {}),
  });
}

/** Blocks a tap opens a sheet for: what grows or is made there, or what's on display. */
const STATIONS: readonly BlockKind[] = ["planter", "kitchen", "workbench", "pedestal", "frame"];

/** Whether a tile is within the world's reach of where you stand. Only a hint: the server checks. */
function inReach(r: { x: number; y: number }, tile: { x: number; y: number }): boolean {
  const reach = mirror?.config.reach ?? 0;
  return Math.max(Math.abs(tile.x - r.x), Math.abs(tile.y - r.y)) <= reach;
}

/**
 * Open the sheet for the planter, kitchen, workbench, pedestal, or frame on a tile (RFC 0005), if
 * one is there.
 */
function openStation(x: number, y: number) {
  const m = mirror;
  const kind = m?.blocks.get(`${x},${y}`);
  if (!m || !kind || !STATIONS.includes(kind)) return;
  const planting = m.crops.get(`${x},${y}`);
  const ownerId = m.ownerAt(x, y);
  // The sim's rule for whose plot this is to work on.
  const plot = ownerId ? { px: 0, py: 0, ownerId, coOwners: [...m.coOwnersAt(x, y)] } : undefined;
  const yours = !!me && canBuildOn(plot, me);
  const ownerName = ownerId ? m.residents.get(ownerId)?.name : undefined;
  if (kind === "pedestal" || kind === "frame") {
    const shown = m.displays.get(`${x},${y}`);
    const find = m.shownFinds.get(`${x},${y}`);
    const { plotSize } = m.config;
    const px = Math.floor(x / plotSize);
    const py = Math.floor(y / plotSize);
    void import("./display-sheet").then((d) =>
      d.openDisplaySheet({
        block: kind,
        x,
        y,
        ...(shown ? { shown } : {}),
        ...(find ? { find } : {}),
        plot: { px, py, gallery: m.galleries.has(`${px},${py}`) },
        yours,
        me,
        nameOf: (id) => m.residents.get(id)?.name,
        act: (action) => act(action),
      }),
    );
    return;
  }
  void import("./garden-sheet").then((g) =>
    g.openTileSheet({
      block: kind,
      x,
      y,
      ...(planting ? { planting } : {}),
      day: m.day,
      yours,
      ...(ownerName ? { ownerName } : {}),
      act: (action) => act(action),
    }),
  );
}

canvas.addEventListener("pointerdown", (e) => {
  tapTile(screenToTile(cam, e.clientX, e.clientY));
});

/** Where a mouse rests over the map. Each frame rings what a click there would act on. */
let pointer: { x: number; y: number } | undefined;
canvas.addEventListener("pointermove", (e) => {
  pointer = e.pointerType === "mouse" ? { x: e.clientX, y: e.clientY } : undefined;
});
canvas.addEventListener("pointerleave", () => {
  pointer = undefined;
});

/** A tap on the world, as a tile: from the 2D map, or picked in the 3D view. Both act the same. */
/** Turn to look at something you tapped or are using. Only how you're drawn; the server moves you. */
function lookAt(tile: { x: number; y: number }) {
  const r = here();
  const dir = r && facingToward(tile.x - r.x, tile.y - r.y);
  if (!dir || !me) return;
  mirror?.facing.set(me, dir);
  motion.face(me, dir);
}

/** What a tap on a tile does besides walking there. `tapTile` acts on it; a mouse over it shows it. */
type TapTarget =
  | { kind: "plot" }
  | { kind: "page"; path: string; tiles: readonly Tile[] }
  | { kind: "pond" }
  | { kind: "station" }
  | { kind: "pickup" }
  | { kind: "pet"; owner: Resident }
  | { kind: "resident"; other: Resident };

function tapTarget(tile: Tile): TapTarget | undefined {
  const r = self();
  const at = here();
  if (!mirror || !r || !at) return undefined;
  // Tapping yourself while you stand on your own plot opens it in 3D.
  if (tile.x === at.x && tile.y === at.y && mirror.ownerAt(at.x, at.y) === r.id && navigate)
    return { kind: "plot" };
  // Someone standing on a tile takes the tap, over whatever they stand on.
  const other = mirror.residentAt(tile.x, tile.y);
  if (other) return other.id === me ? undefined : { kind: "resident", other };
  // A game table opens its page (RFC 0011), and so do the Town Hall and the shop.
  const table = mirror.tableAt(tile.x, tile.y);
  if (table && navigate) return { kind: "page", path: `/games/${table}`, tiles: [tile] };
  if (mirror.isTownHall(tile.x, tile.y) && navigate)
    return { kind: "page", path: "/town", tiles: mirror.townHall };
  if (mirror.isShop(tile.x, tile.y) && navigate)
    return { kind: "page", path: "/shop", tiles: mirror.shop };
  const block = mirror.blocks.get(tileKey(tile.x, tile.y));
  if (block === "pond") return { kind: "pond" };
  if (block && STATIONS.includes(block)) return { kind: "station" };
  if (mirror.pickupAt(tile.x, tile.y)) return { kind: "pickup" };
  // Someone else's pet drawn on the tile. Pets are drawing only, so this asks where they were last
  // drawn; yours sits at your heel, where you tap to walk.
  const petOwner = pets.tapped(tile, me, mirror);
  const owner = petOwner ? mirror.residents.get(petOwner) : undefined;
  return owner?.pet ? { kind: "pet", owner } : undefined;
}

/** The tiles a click would act on, ringed under a mouse: in build mode, any tile a block goes on. */
function hoverTiles(tile: Tile): readonly Tile[] | undefined {
  if (!mirror || tile.x < 0 || tile.y < 0) return undefined;
  if (tile.x >= mirror.config.width || tile.y >= mirror.config.height) return undefined;
  if (buildMode) return [tile];
  const target = tapTarget(tile);
  if (!target) return undefined;
  if (target.kind === "page") return target.tiles;
  if (target.kind === "resident") return [{ x: target.other.x, y: target.other.y }];
  return [tile];
}

function tapTile(tile: { x: number; y: number }) {
  const r = self();
  const at = here();
  if (!mirror || !r || !at) return;
  if (buildMode) {
    const key = `${tile.x},${tile.y}`;
    const hasBlock = mirror.blocks.has(key);
    if (pick === "hearth") tryAct({ type: "set_hearth", ...tile });
    else if (isGroundKind(pick)) {
      // Paths and floors: a tap lifts what's there, or lays the pick if you can pay for it.
      if (mirror.paving.has(key)) tryAct({ type: "lift", ...tile });
      else if (canLay(pick, holdings)) tryAct({ type: "lay", ...tile, ground: pick });
      else showToast(groundLine(pick, holdings));
    } else if (hasBlock) tryAct({ type: "remove", ...tile });
    else if (isHeldBlock(pick) && heldOf(holdings, pick) === 0) showToast(heldLine(pick, 0));
    else if (pick === "pond" && !canDig(holdings)) showToast(pondLine(holdings));
    else tryAct({ type: "place", ...tile, block: pick });
    return;
  }
  const target = tapTarget(tile);
  if (target?.kind === "plot") {
    navigate?.(plot3dPath(r.id));
    return;
  }
  if (target?.kind === "page") {
    navigate?.(target.path);
    return;
  }
  /** Do `then` here if it's in reach, or walk until it is and do it there. */
  const reachThen = (then: () => void) => {
    if (inReach(at, tile)) return then();
    walkToward(tile, mirror?.config.reach ?? 0, () => {
      const there = here();
      if (there && inReach(there, tile)) then();
      else showToast("You can't get close enough to reach that from here.");
    });
  };
  // Water (RFC 0023): cast a line into it from beside it, walking there first when it's farther.
  if (target?.kind === "pond") {
    if (Math.max(Math.abs(tile.x - at.x), Math.abs(tile.y - at.y)) <= 1) castLine();
    else walkToward(tile, 1, castLine);
    return;
  }
  // A planter, kitchen, or workbench opens what you can do there (RFC 0005). One farther off is
  // somewhere to walk to: you stop once it's in reach, and it opens then.
  if (target?.kind === "station") {
    reachThen(() => {
      lookAt(tile);
      openStation(tile.x, tile.y);
    });
    return;
  }
  // A fallen branch or a loose stone: tap to pick it up (phase 1 gathering). One farther off is
  // somewhere to walk to: you stop once it's in reach and pick it up then. The sim has the last
  // word; its `nothing_to_gather` says someone got there first. One on someone else's plot is
  // theirs: say so rather than walk there for nothing.
  if (target?.kind === "pickup") {
    if (!mirror.mayGatherAt(tile.x, tile.y, r.id)) {
      const owner = mirror.ownerAt(tile.x, tile.y);
      showToast(othersPickupLine(owner ? mirror.residents.get(owner)?.name : undefined));
      return;
    }
    reachThen(() => {
      lookAt(tile);
      // Someone may have claimed the plot on the way.
      const m = mirror;
      if (!m || m.mayGatherAt(tile.x, tile.y, r.id)) tryAct({ type: "gather", ...tile });
      else showToast(othersPickupLine(m.residents.get(m.ownerAt(tile.x, tile.y) ?? "")?.name));
    });
    return;
  }
  // Someone else's pet opens its sheet: Pat and Give a treat. A tap on a hearth walks there past a
  // pet curled up by it.
  const owned = target?.kind === "pet" ? target.owner : undefined;
  if (owned?.pet) {
    lookAt(tile);
    openWorldPetSheet({
      owner: { id: owned.id, name: owned.name },
      pet: owned.pet,
      pattedToday: patsToday.has(owned.id, mirror.day),
      patted: () => {
        patsToday.add(owned.id, mirror?.day);
        pets.pat(owned.id, performance.now());
      },
      say: (text) => showToast(text),
    });
    return;
  }
  // Tapping someone shows who they are. Names and notes are untrusted: textContent only.
  if (target?.kind === "resident") {
    const other = target.other;
    lookAt(other);
    const name = other.kind === "agent" ? `${other.name} ⚙` : other.name;
    showToast(other.note ? `${name}: ${other.note}` : name, "player");
    return;
  }
  // Someone away is not here: asleep at home, or out on a routine (decision 0083). Say so, and
  // walk on as if the tile were empty.
  const other = mirror.residentAt(tile.x, tile.y);
  const out = other
    ? undefined
    : mirror.outOnRoutine(me).find((o) => o.r.x === tile.x && o.r.y === tile.y);
  const asleep = other || out ? undefined : dozerAt(mirror.asleep(me), tile.x, tile.y)?.r;
  const away = out?.r ?? asleep;
  if (away) {
    const name = away.kind === "agent" ? `${away.name} ⚙` : away.name;
    const doing =
      out?.routine === "stroll" ? "out on a stroll" : out ? "just walked home" : "asleep at home";
    showToast(`${name} is away, ${doing}.`, "player");
  }
  walkToward(tile);
}

// ---------- 2D or 3D ----------

function paintMode() {
  modeButton.setAttribute("aria-pressed", String(mode === "3d"));
}

modeButton.addEventListener("click", () => {
  mode = mode === "3d" ? "2d" : "3d";
  saveMode(mode);
  paintMode();
  if (mode === "3d") open3d();
  else close3d();
});

/** The scene's code (three.js included). The browser fetches it once and reuses it after. */
const scene3d = () => import("./scene3d/world");

// A finger on the toggle or a pointer over it starts the fetch, a beat before the click lands.
const warm3d = () => {
  if (mode === "2d" && !world3d) scene3d().catch(() => {});
};
modeButton.addEventListener("pointerenter", warm3d);
modeButton.addEventListener("focus", warm3d);

/** While the scene loads, the map softens and says so, so a tap on "3D view" shows at once. */
function showOpening(on: boolean) {
  const shown = on && !loader?.isUp();
  canvas.classList.toggle("opening-3d", shown);
  opening3d.hidden = !shown;
}

/** Lift the loader once the world is on screen: now on the map, or when the 3D scene first draws. */
function revealWhenDrawn() {
  if (!loader?.isUp()) return;
  if (!loading3d) return loader.finish();
  loader.reach("welcome");
  clearTimeout(sceneWait);
  sceneWait = window.setTimeout(() => loader?.finish(), SCENE_WAIT_MS);
}

/** Show the world in 3D, fetching the scene code (three.js included) the first time. */
function open3d() {
  if (world3d || !active || !me) return;
  if (loading3d) return showOpening(true);
  loading3d = true;
  modeButton.setAttribute("aria-busy", "true");
  showOpening(true);
  scene3d()
    // Building the scene holds the page for a moment, so let the softened map paint first.
    .then(
      (m) =>
        new Promise<typeof m>((done) => requestAnimationFrame(() => setTimeout(() => done(m)))),
    )
    .then((m) => {
      loading3d = false;
      modeButton.removeAttribute("aria-busy");
      showOpening(false);
      if (mode !== "3d" || !active || !me) return loader?.finish();
      host3d.hidden = false;
      world3d = m.createWorld3d(host3d, {
        onTap: tapTile,
        tappable: (tile) => !!hoverTiles(tile),
        onFail: fallBack,
      });
      canvas.hidden = true;
      // Two frames on, the scene has drawn once, so the loader lifts onto it rather than onto nothing.
      requestAnimationFrame(() => requestAnimationFrame(() => loader?.finish()));
    })
    .catch(() => {
      loading3d = false;
      modeButton.removeAttribute("aria-busy");
      showOpening(false);
      fallBack("failed");
    });
}

/** Back to the 2D map, keeping the choice for next time. */
function close3d() {
  showOpening(false);
  world3d?.dispose();
  world3d = undefined;
  host3d.hidden = true;
  canvas.hidden = false;
}

/**
 * The 3D view can't run here: back to the map. Too slow, or the scene won't load, is remembered
 * for this device; a lost GPU (a phone reclaiming it in the background) is for this visit only.
 */
function fallBack(reason: "slow" | "lost" | "failed") {
  loader?.finish();
  mode = "2d";
  if (reason !== "lost") saveMode("2d");
  paintMode();
  // Leave the frame the scene is in before freeing it, and free only the view that failed.
  const failed = world3d;
  setTimeout(() => {
    if (world3d === failed) close3d();
  }, 0);
  showToast(
    reason === "slow"
      ? "3D was running slowly on this device, so you're back on the map."
      : "The 3D view stopped working here, so you're back on the map.",
  );
}

// ---------- the d-pad: press for a step, hold to walk, slide your thumb to turn ----------

/**
 * The way a point on the d-pad points on screen: the button under it, a corner between two
 * buttons for a diagonal, or nothing on the hub. Past the pad's edge it points the way it went.
 */
function padWay(e: PointerEvent): Direction | undefined {
  if (!pad) return undefined;
  const box = pad.getBoundingClientRect();
  const half = box.width / 6;
  const dx = e.clientX - (box.left + box.width / 2);
  const dy = e.clientY - (box.top + box.height / 2);
  return directionOf(
    Math.abs(dx) > half ? Math.sign(dx) : 0,
    Math.abs(dy) > half ? Math.sign(dy) : 0,
  );
}

/** Light the buttons the d-pad is walking toward: one, or the two either side of a diagonal. */
function paintHeld(dir: Direction | undefined) {
  const [dx, dy] = dir ? STEP[dir] : [0, 0];
  for (const button of padButtons) {
    const [bx, by] = STEP[button.dataset.dir as Direction];
    button.toggleAttribute("data-held", (bx !== 0 && bx === dx) || (by !== 0 && by === dy));
  }
}

/** Until when a click on a d-pad button is the tail of a press the pointer already walked. */
let padClickUntil = 0;

pad?.addEventListener("pointerdown", (e) => {
  const dir = padWay(e);
  if (!active || !me || !dir || e.button > 0) return;
  e.preventDefault();
  walker.padDown(dir, performance.now());
  paintHeld(dir);
  // Keep the thumb's moves coming to the pad as it slides off a button, or past the pad's edge.
  try {
    pad.setPointerCapture(e.pointerId);
  } catch {
    // A pointer the browser no longer tracks: the step still goes, it just won't slide.
  }
});
pad?.addEventListener("pointermove", (e) => {
  if (!pad.hasPointerCapture(e.pointerId)) return;
  const dir = padWay(e);
  walker.padMove(dir);
  paintHeld(dir);
});
const padUp = () => {
  walker.padUp();
  paintHeld(undefined);
  padClickUntil = performance.now() + 500;
};
pad?.addEventListener("pointerup", padUp);
pad?.addEventListener("pointercancel", padUp);
pad?.addEventListener("lostpointercapture", padUp);
// A button pressed with the keyboard or a screen reader takes one step.
for (const button of padButtons) {
  button.addEventListener("click", () => {
    if (performance.now() < padClickUntil) return;
    walker.tap(button.dataset.dir as Direction, performance.now());
  });
}

const KEYS: Record<string, Direction> = {
  ArrowUp: "n",
  ArrowDown: "s",
  ArrowLeft: "w",
  ArrowRight: "e",
  w: "n",
  s: "s",
  a: "w",
  d: "e",
};
/** Keys belong to a sheet that's open, or to whatever you're typing in, not to walking. */
function keysTaken(): boolean {
  if (document.documentElement.classList.contains("overlay-open")) return true;
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && (el.isContentEditable || el.closest("dialog") !== null))
  );
}

/** The walk key an event is, if any: W and w alike, so Caps Lock doesn't stop you. */
const walkKey = (e: KeyboardEvent): Direction | undefined =>
  KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];

window.addEventListener("keydown", (e) => {
  // macOS sends no keyup for a key let go while Command is down, so Command lets go of them all.
  if (e.key === "Meta") {
    walker.releaseKeys();
    return;
  }
  if (!active || !me || keysTaken() || e.metaKey || e.ctrlKey || e.altKey) return;
  const dir = walkKey(e);
  if (!dir) return;
  e.preventDefault();
  // Key repeat isn't another press: a held key walks at your figure's pace (`walk.ts`).
  if (!e.repeat) walker.press(dir, performance.now());
});
window.addEventListener("keyup", (e) => {
  const dir = walkKey(e);
  if (dir) walker.release(dir, performance.now());
});
// A key released while the page is in the background never sends keyup.
window.addEventListener("blur", () => {
  walker.stop();
  paintHeld(undefined);
});

claimButton.addEventListener("click", () => {
  // The claim lands after any steps still on their way, on the plot they end in.
  const r = here();
  const m = mirror;
  if (!r || !m) return;
  if (m.ownerAt(r.x, r.y) === me) {
    showToast("This plot is already yours. Tap Build to start.");
    return;
  }
  // With no plot yet, a plot `settle` wouldn't take where you stand (the Commons, or someone's)
  // opens the picker of ones it would (decision 0143).
  const { px, py } = plotOf(m.config, r.x, r.y);
  const claimed = m.plots.has(`${px},${py}`);
  if (ownedPlots() === 0 && settleProblem(m.config, px, py, { claimed, ownsAPlot: false })) {
    void import("./claim-sheet").then((c) => c.openClaimSheet());
    return;
  }
  tryAct({ type: "claim" });
});

/** How many plots you own, as far as the mirror shows. */
function ownedPlots(): number {
  let n = 0;
  if (mirror && me) for (const owner of mirror.plots.values()) if (owner === me) n++;
  return n;
}

/** Claim plot while you may claim one, else Your things in its place (one plot per resident). */
function paintClaim() {
  const full = !!mirror && !!me && ownedPlots() >= mirror.config.maxPlotsPerResident;
  claimButton.hidden = full;
  thingsLink.hidden = !full;
}

$("hud-invite").addEventListener("click", () => {
  void import("./invite-share").then((m) => m.openInviteDialog());
});

buildButton.addEventListener("click", () => {
  // With no plot there's nowhere to build: say how to get one instead.
  if (!buildMode && self() && !hasPlot()) {
    showToast(NO_PLOT_LINE);
    return;
  }
  setBuildMode(!buildMode);
});

/**
 * Build mode on or off. The build bar sits where chat opens, so building closes chat (and opening
 * chat ends building), and notices move under the bar while it shows.
 */
function setBuildMode(on: boolean) {
  buildMode = on;
  buildButton.setAttribute("aria-pressed", String(on));
  palette.hidden = !on;
  hud.classList.toggle("building", on);
  if (on && !chatPanel.hidden) toggleChat(false);
  paintPalette();
  if (on) hud.style.setProperty("--palette-bottom", `${palette.getBoundingClientRect().bottom}px`);
}

for (const button of paletteRows.blocks.querySelectorAll<HTMLButtonElement>("button")) {
  const kind = button.dataset.block as BlockKind | "hearth";
  const chip = button.querySelector<HTMLElement>(".chip");
  if (chip) chip.style.background = kind === "hearth" ? HEARTH_COLOR : blockColor(kind);
  button.setAttribute("aria-pressed", String(kind === pick));
}

// One listener for every choice, including the rows painted as what you hold changes.
palette.addEventListener("click", (e) => {
  const target = e.target as Element;
  const button = target.closest<HTMLButtonElement>("button[data-block], button[data-ground]");
  if (!button) return;
  selectPick((button.dataset.ground ?? button.dataset.block) as BlockKind | GroundKind | "hearth");
});

/**
 * Build it yourself, after a claim: the build bar open on Blocks with the hearth picked, and its
 * line saying what a hearth is for.
 */
function buildFromHearth() {
  if (!buildMode) setBuildMode(true);
  pickTab(paletteTabs, PALETTE_TABS.indexOf("blocks"));
  pick = "hearth";
  showTab("blocks");
}

/** Show one tab's row. A pick from another tab gives way to this tab's first choice. */
function showTab(next: PaletteTab) {
  for (const [name, row] of Object.entries(paletteRows)) row.hidden = name !== next;
  if (tabOf(pick) !== next) {
    pick =
      next === "blocks"
        ? "wood"
        : next === "ground"
          ? "dirt"
          : (HELD_KINDS.find((k) => heldOf(holdings, k) > 0) ?? "table");
  }
  paintPalette();
}

function selectPick(next: BlockKind | GroundKind | "hearth") {
  pick = next;
  paintPalette();
}

/** Redraw the rows that follow what you hold, mark the pick, and say what it costs. */
function paintPalette() {
  paintGroundRow(paletteRows.ground, holdings, pick);
  paintHeldRow(paletteRows.furniture, holdings, pick);
  for (const b of paletteRows.blocks.querySelectorAll<HTMLButtonElement>("button"))
    b.setAttribute("aria-pressed", String(b.dataset.block === pick));
  paletteLine.textContent = isGroundKind(pick)
    ? groundLine(pick, holdings)
    : isHeldBlock(pick)
      ? heldLine(pick, heldOf(holdings, pick))
      : pick === "pond"
        ? pondLine(holdings)
        : blockLine(pick);
  if (buildMode)
    hud.style.setProperty("--palette-bottom", `${palette.getBoundingClientRect().bottom}px`);
}

/** Ask what you hold. Quietly nothing when items aren't open or the request fails. */
async function loadHoldings() {
  const r = await api.inventory();
  if (!active || !r.ok) return;
  holdings = holdingsFromStacks(r.data.inventory?.stacks ?? []);
  rods = rodsIn(r.data.inventory?.goods ?? []);
  paintPalette();
}

$("home").addEventListener("click", () => {
  walker.stop();
  // No hearth is nowhere to go: say how to set one now, rather than after a round trip.
  const r = self();
  if (r && !r.hearth) {
    showToast(worldProblem("no_hearth", "", { hasPlot: hasPlot() }));
    return;
  }
  // The jump lands after any steps still on their way; walk no further until it does.
  const id = tryAct({ type: "home" });
  if (id) walker.awaiting(id, performance.now());
});

chatToggle.addEventListener("click", () => toggleChat(chatPanel.hidden !== false));

function toggleChat(open: boolean) {
  chatPanel.hidden = !open;
  chatToggle.setAttribute("aria-pressed", String(open));
  if (!open) return;
  if (buildMode) setBuildMode(false);
  chatLog.scrollTop = chatLog.scrollHeight;
  chatInput.focus();
}

// Nearby by default; tap to switch to everyone online.
let channel: ChatChannel = "nearby";
const channelButton = $<HTMLButtonElement>("chat-channel");
channelButton.addEventListener("click", () => {
  channel = channel === "nearby" ? "world" : "nearby";
  channelButton.textContent = channel === "nearby" ? "Nearby" : "Everyone";
  chatInput.placeholder =
    channel === "nearby" ? "Say something to people nearby" : "Say something to everyone";
  chatInput.focus();
});

$<HTMLFormElement>("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  // The text stays until the server takes it, so a dropped or refused line isn't lost.
  const id = tryAct({ type: "chat", text, channel });
  if (id) pendingChat = { id, text };
});

// ---------- loop ----------

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cam.width = window.innerWidth;
  cam.height = window.innerHeight;
  cam.scale = targetScale();
  canvas.width = Math.floor(cam.width * dpr);
  canvas.height = Math.floor(cam.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** In the world we show ~13 tiles across; behind the curtain we pull back to show more of it. */
function targetScale() {
  return me ? fitScale(cam.width, cam.height) : fitScale(cam.width, cam.height, 17);
}

function snapCamera() {
  const r = self();
  if (r) Object.assign(cam, { cx: r.x, cy: r.y });
  cam.scale = targetScale();
}

/** How far down the top bar's pills reach, in CSS pixels: where the visit card starts. */
const TOP_BAR_PX = 60;

function frame() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const still = motionQuery.matches;
  motion.self = me;
  // The 3D camera decides which way "up" walks, so turn the d-pad before the next step.
  paintPad(world3d?.heading() ?? 0, world3d !== undefined);
  const r = self();
  visiting.update(mirror, me, r);
  if (r) {
    // While the world reloads, the mirror is behind the server: no steps checked against it.
    if (!resyncing) walker.tick(now);
    motion.ahead = walker.ahead;
    // The map's camera follows your figure as it's drawn, so the world glides under a walk.
    const p = motion.pose(r, now, still);
    cam.cx = approach(cam.cx, p.x, dt, CAMERA_RATE);
    cam.cy = approach(cam.cy, p.y, dt, CAMERA_RATE);
  } else if (mirror) {
    // Behind the curtain: a slow drift around the Commons.
    const { plotSize } = mirror.config;
    const ox = (mirror.commons.px + 0.5) * plotSize - 0.5;
    const oy = (mirror.commons.py + 0.5) * plotSize - 0.5;
    const drift = still ? 0 : now / 1000;
    cam.cx = ox + Math.sin(drift / 9) * 4;
    cam.cy = oy + Math.cos(drift / 13) * 2.5 + 1.5;
    cam.scale = targetScale();
  }
  // Advance the server's time anchor with our own clock, so every client renders the same night,
  // and the same weather, at the same time without asking the server again.
  const serverMs = dayAnchor
    ? dayAnchor.nowMs + (performance.now() - dayAnchor.receivedAt)
    : undefined;
  const phase =
    dayAnchor && serverMs !== undefined ? dayPhase(serverMs, dayAnchor.dayLengthMs) : undefined;
  const { season, weather } = skyNow(serverMs, mirror?.day);
  // Only once the server's clock is known, so the first weather we draw is the real one, not a
  // spell drifting in from a clear sky.
  if (serverMs !== undefined) sky.update(weather, now, still);
  sound.frame({ phase, season, sky: sky.amounts });
  // Pets plan their days by the server's clock, so every screen tells the same story.
  const clock = serverMs ?? Date.now();
  if (world3d && mirror && me)
    world3d.sync({
      mirror,
      me,
      buildMode,
      feelings,
      motion,
      season,
      sky: sky.amounts,
      pets,
      clock,
      ...(phase === undefined ? {} : { dayPhase: phase }),
    });
  else if (mirror) {
    // Worked out every frame: people walk under a still pointer, and the map follows you.
    const hover = pointer ? hoverTiles(screenToTile(cam, pointer.x, pointer.y)) : undefined;
    const cursor = hover ? "pointer" : "";
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    render(ctx, {
      mirror,
      me,
      cam,
      buildMode,
      feelings,
      motion,
      now,
      still,
      season,
      sky: sky.amounts,
      pets,
      clock,
      // Plots' names keep clear of the top bar and the visit card (decision 0121).
      labelTop: Math.max(TOP_BAR_PX, visiting.bottom()),
      casts,
      hover,
      ...(phase === undefined ? {} : { dayPhase: phase }),
    });
  }
  if (casts.length > 0 && now - (casts[0]?.at ?? now) > CAST_MS) {
    casts = casts.filter((c) => now - c.at <= CAST_MS);
  }
  if (now - petCheckAt > 250) {
    petCheckAt = now;
    paintPetButton(now);
    paintGatherButton();
    paintFishButton();
    paintClaim();
    paintEnterButton();
  }
  // Your own figure's feeling, a name from a fixed list, once you're in: for tests and tools.
  const mine = me ? feelings.feeling(me, now) : "";
  if (canvas.dataset.feeling !== mine) canvas.dataset.feeling = mine;
  if (active) rafId = requestAnimationFrame(frame);
}

window.addEventListener("resize", () => {
  if (active) resize();
});

/** Show "Pat Biscuit" while you stand by someone's pet (RFC 0019), and hide it otherwise. */
function paintPetButton(now: number) {
  const r = self();
  const at = r && me ? motion.pose(r, now, motionQuery.matches) : undefined;
  const owner = at ? pets.nearest(at.x, at.y, PAT_NEAR, me) : undefined;
  const pet = owner ? mirror?.residents.get(owner)?.pet : undefined;
  petNear = pet ? owner : undefined;
  petButton.hidden = !pet;
  if (!owner || !pet) return;
  const done = patsToday.has(owner, mirror?.day);
  const label = `${done ? "Patted" : "Pat"} ${petCalled(pet, "their")}`;
  const text = petButton.querySelector("span");
  if (text && text.textContent !== label) text.textContent = label;
  petButton.setAttribute("aria-pressed", String(done));
}

/**
 * Show "Gather all" while something lies within reach that you may pick up (decision 0125): the
 * sim's own list, from where your steps will have taken you, so a tap gathers what it says.
 */
function paintGatherButton() {
  const m = mirror;
  const you = me;
  const at = here();
  const lying =
    m && you && at
      ? pickupsInReach(
          m.config,
          at,
          (x, y) => m.pickupAt(x, y),
          (x, y) => m.mayGatherAt(x, y, you),
        ).length
      : 0;
  gatherButton.hidden = lying === 0 && !gathering;
}

gatherButton.addEventListener("click", () => {
  if (gathering) return;
  void whileBusy(
    gatherButton,
    () =>
      new Promise<void>((done) => {
        const id = tryAct({ type: "gather" });
        if (!id) return done();
        const finish = () => {
          clearTimeout(timer);
          gathering = undefined;
          done();
        };
        const timer = setTimeout(finish, GATHER_WAIT_MS);
        gathering = { id, done: finish };
      }),
  );
});

/** The water beside where the server has you, if any: where a cast would go in. */
function waterNear(): Tile | undefined {
  const r = self();
  const m = mirror;
  if (!r || !m) return undefined;
  return waterBeside(r, (x, y) => m.blocks.get(tileKey(x, y)) === "pond");
}

/** Show Fish while you stand beside water, out of build mode (RFC 0023). */
function paintFishButton() {
  fishButton.hidden = buildMode || waterNear() === undefined;
}

/** Cast a line into the water beside you, or say how to get a rod. The server rolls the catch. */
function castLine() {
  const water = waterNear();
  if (!water) {
    showToast("Stand right beside the water to fish.");
    return;
  }
  lookAt(water);
  if (rods.size === 0) {
    showToast(noRodLine());
    return;
  }
  tryAct({ type: "fish" });
}

fishButton.addEventListener("click", () => castLine());

/** The Town Hall or the shop, when one is right beside where you stand: where its button goes. */
function placeNear(): "/town" | "/shop" | undefined {
  const r = self();
  const m = mirror;
  if (!r || !m) return undefined;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (m.isTownHall(r.x + dx, r.y + dy)) return "/town";
      if (m.isShop(r.x + dx, r.y + dy)) return "/shop";
    }
  }
  return undefined;
}

/**
 * Show "Town Hall" or "Shop" while you stand beside one, out of build mode. Walking up to a
 * building only bumps into it, so this is the way in that doesn't depend on tapping the building.
 */
function paintEnterButton() {
  const place = buildMode || !navigate ? undefined : placeNear();
  enterButton.hidden = !place;
  if (!place || enterButton.dataset.place === place) return;
  enterButton.dataset.place = place;
  const text = enterButton.querySelector("span");
  if (text) text.textContent = place === "/shop" ? "Shop" : "Town Hall";
}

enterButton.addEventListener("click", () => {
  const place = enterButton.dataset.place;
  if (place && navigate) navigate(place);
});

petButton.addEventListener("click", async () => {
  const owner = petNear;
  const pet = owner ? mirror?.residents.get(owner)?.pet : undefined;
  if (!owner || !pet) return;
  if (patsToday.has(owner, mirror?.day)) {
    showToast(`You patted ${petCalled(pet, "their")} today. You can again tomorrow.`);
    return;
  }
  if (await patPet(petButton, owner, pet, (text) => showToast(text))) {
    patsToday.add(owner, mirror?.day);
    pets.pat(owner, performance.now());
    paintPetButton(performance.now());
  }
});

/** Show the world: start drawing, and connect if we have a token. */
export function startWorld(
  options: { navigate?: (path: string) => void; loader?: WorldLoader } = {},
) {
  if (active) return;
  active = true;
  navigate = options.navigate;
  loader = options.loader;
  mode = startMode(savedMode(), signals);
  paintMode();
  resize();
  rafId = requestAnimationFrame(frame);
  const token = savedToken();
  if (token) {
    // Returning resident: skip the landing and go straight in. The snapshot draws the world while
    // the socket says hello, and if the server is down, "Can't reach the world" says why it's empty.
    // The loader covers all of that until the world is drawn.
    loader?.show();
    loader?.reach("code");
    enterWorld(true);
    hud.hidden = false;
    connect({ token });
    void resync();
  } else {
    void resync();
    watchPopulation();
  }
}

/** Leave the world: stop the loop, close the socket, and forget who is walking where. */
export function stopWorld() {
  if (!active) return;
  active = false;
  cancelAnimationFrame(rafId);
  clearTimeout(sceneWait);
  loader?.hide();
  close3d();
  sound.leave();
  stopPopulation?.();
  stopPopulation = undefined;
  conn?.close();
  conn = undefined;
  me = undefined;
  joiningFresh = false;
  holdings = new Map();
  paintPalette();
  pendingChat = undefined;
  stopWalking();
  visiting.hide();
  hud.hidden = true;
  worldWait.hidden = true;
  petButton.hidden = true;
  petNear = undefined;
  gatherButton.hidden = true;
  gathering?.done();
  fishButton.hidden = true;
  enterButton.hidden = true;
  rods = new Set();
  casts = [];
  landing.setJoining(false);
}
