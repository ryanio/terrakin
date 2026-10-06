/**
 * The canvas world: landing curtain, live connection, input, and the render loop. Loaded as its own
 * chunk and started only on `/world`; `stopWorld` cancels the loop and closes the socket, so the
 * feed pages stay light on phones.
 */

import {
  type Action,
  type ChatChannel,
  type ServerMessage,
  WorldSnapshot,
} from "@terrakin/protocol";
import {
  type BlockKind,
  canBuildOn,
  type DecorKind,
  type Direction,
  ITEM_INFO,
  isDecorKind,
} from "@terrakin/sim";
import { REDUCED_MOTION } from "@terrakin/ui/motion";
import { plot3dPath } from "@terrakin/ui/paths";
import { everyVisible } from "@terrakin/ui/poll";
import { api, whoseKey } from "./api";
import {
  type DecorCounts,
  decorChoices,
  decorFromStacks,
  paintDecorChoices,
  withDecorChanges,
} from "./build-palette";
import { type Camera, fitScale, screenToTile, stepToward } from "./camera";
import { Feelings, gestureReaction } from "./feelings";
import { createLanding } from "./landing";
import { Mirror } from "./mirror";
import { Connection, type Identity, savedToken, saveToken } from "./net";
import { blockColor, HEARTH_COLOR, render } from "./render";
import type { World3d } from "./scene3d/world";
import { type Quarter, turnDir } from "./scene3d/world-layout";
import { track } from "./telemetry";
import { NO_PLOT_LINE, newsLine, othersPickupLine, toastMs, worldProblem } from "./things";
import { dayPhase } from "./time";
import { ARRIVAL_KEY, gestureLine, showsReceived } from "./together";
import { offer3d, readSignals, savedMode, saveMode, startMode, type WorldMode } from "./world-mode";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("world");
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const curtain = $("curtain");
const hud = $("hud");
const status = $("status");
const toast = $("toast");
const worldWait = $("world-wait");
const chatPanel = $("chat");
const chatLog = $<HTMLOListElement>("chat-log");
const chatInput = $<HTMLInputElement>("chat-input");
const chatToggle = $("chat-toggle");
const buildButton = $("build");
const palette = $("palette");
const modeButton = $<HTMLButtonElement>("world-mode");
const host3d = $("world-3d");

const motionQuery = window.matchMedia(REDUCED_MOTION);
/** What figures show in reaction to what happens to them (RFC 0013). Drawing only. */
const feelings = new Feelings();

let active = false;
let rafId = 0;
let stopPopulation: (() => void) | undefined;
let conn: Connection | undefined;
let mirror: Mirror | undefined;
let me: string | undefined;
/** How the world asks the site router to go to another page (the Town Hall, your plot in 3D). */
let navigate: ((path: string) => void) | undefined;
let buildMode = false;
/** Selected build tool: a block, or the hearth marker. */
let block: BlockKind | "hearth" = "wood";
/** Decor from the town shop you hold, shown in the palette while you have some. */
let decor: DecorCounts = new Map();
/** Decor shown since the palette opened, kept (greyed out) when you run out. */
let decorShown = new Set<DecorKind>();
/** Where a tap sent you. `station` is a planter, kitchen, or workbench to open once in reach. */
let walkTarget: { x: number; y: number; station?: boolean; pickup?: boolean } | undefined;
let pendingMove: string | undefined;
/** The chat line waiting for the server's answer: its text leaves the input only once accepted. */
let pendingChat: { id: string; text: string } | undefined;
/** Steps asked for by key presses and d-pad taps (world directions), sent as the pace allows. */
const queuedSteps: Direction[] = [];
/** Walk keys held down, newest last, as the key's own direction (up is "n"). Holding walks on. */
const heldKeys: Direction[] = [];
/**
 * The fastest we walk: one step per server ack, and no more often than this. Keeps a held key
 * under the action rate limit (10 a second) instead of bursting into "Slow down."
 */
const STEP_MS = 110;
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
  onJoin({ name, color, shape, note }) {
    joiningFresh = true;
    landing.setJoining(true);
    connect({ name, kind: "human", color, shape, ...(note ? { note } : {}) });
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
  close3d();
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
    if (s === "offline" && !me && !hud.hidden) worldWait.hidden = false;
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

function stopWalking() {
  walkTarget = undefined;
  pendingMove = undefined;
  queuedSteps.length = 0;
  heldKeys.length = 0;
}

/** Remember the server's day/night anchor and when it arrived. No anchor means no night. */
function anchor(time: WorldSnapshot["time"]) {
  return time ? { ...time, receivedAt: performance.now() } : undefined;
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
      dayAnchor = anchor(parsed.data.time);
      updatePopulation();
    } else console.warn("Bad snapshot from server", parsed.error);
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
      showArrival();
      void loadDecor();
      break;
    case "gesture":
      // Someone sent you a hug or a wave. Their name and note are their words: shown as text.
      if (showsReceived(msg.kind)) {
        showToast(gestureLine(msg.kind, msg.from.name, msg.note, msg.putter, msg.item), "player");
        // Your figure answers it: love for a hug, a wave back for a wave. Only the kind decides,
        // and a kind the site keeps quiet about (a kiss, decision 0066) shows nothing here either.
        if (me) feelings.show(me, gestureReaction(msg.kind), performance.now());
      }
      break;
    case "event": {
      // Out of step with the server? Reload the truth rather than guessing.
      if (mirror && !resyncing && mirror.apply(msg) === "gap") void resync();
      // Your own news, in plain words. Notes, labels, and names stay out of it.
      const line = me ? newsLine(msg.event, me) : null;
      if (line) showToast(line);
      // Decor from the town shop you hold changes the palette.
      if (msg.event.type === "inventory" && msg.event.residentId === me) {
        const next = withDecorChanges(decor, msg.event.changes);
        if (next !== decor) {
          decor = next;
          if (isDecorKind(block) && !decor.has(block)) {
            showToast(`That was your last ${ITEM_INFO[block].name.toLowerCase()}.`);
            selectBlock("wood");
          }
          paintPalette();
        }
      }
      break;
    }
    case "chat":
      addChat(msg.from.name, msg.from.kind, msg.text, msg.channel);
      // Figures near the speaker look their way. Who spoke, never what they said.
      feelings.heard(msg.from.id, performance.now());
      break;
    case "ack":
      if (msg.id === pendingMove) pendingMove = undefined;
      if (pendingChat && msg.id === pendingChat.id) {
        // Sent: clear the line, unless you've started another one meanwhile.
        if (chatInput.value.trim() === pendingChat.text) chatInput.value = "";
        pendingChat = undefined;
      }
      break;
    case "error": {
      const { code, message } = msg.error;
      if (msg.id === pendingMove) {
        // Walked into something: stop, rather than bumping it every step until the key comes up.
        stopWalking();
      }
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
const DIR_NAMES: Record<Direction, string> = { n: "North", e: "East", s: "South", w: "West" };
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

function step(dir: Direction) {
  walkTarget = undefined;
  queuedSteps.push(dir);
  // Turn right away, even if the step is refused. Only how you're drawn; the server moves you.
  if (me) mirror?.facing.set(me, dir);
}

function self() {
  return me ? mirror?.residents.get(me) : undefined;
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
  const here = m?.blocks.get(`${x},${y}`);
  if (!m || !here || !STATIONS.includes(here)) return;
  const planting = m.crops.get(`${x},${y}`);
  const ownerId = m.ownerAt(x, y);
  // The sim's rule for whose plot this is to work on.
  const plot = ownerId ? { px: 0, py: 0, ownerId, coOwners: [...m.coOwnersAt(x, y)] } : undefined;
  const yours = !!me && canBuildOn(plot, me);
  const ownerName = ownerId ? m.residents.get(ownerId)?.name : undefined;
  if (here === "pedestal" || here === "frame") {
    const shown = m.displays.get(`${x},${y}`);
    const { plotSize } = m.config;
    const px = Math.floor(x / plotSize);
    const py = Math.floor(y / plotSize);
    void import("./display-sheet").then((d) =>
      d.openDisplaySheet({
        block: here,
        x,
        y,
        ...(shown ? { shown } : {}),
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
      block: here,
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

/** A tap on the world, as a tile: from the 2D map, or picked in the 3D view. Both act the same. */
function tapTile(tile: { x: number; y: number }) {
  const r = self();
  if (!mirror || !r) return;
  if (buildMode) {
    const hasBlock = mirror.blocks.has(`${tile.x},${tile.y}`);
    if (block === "hearth") tryAct({ type: "set_hearth", ...tile });
    else tryAct(hasBlock ? { type: "remove", ...tile } : { type: "place", ...tile, block });
    return;
  }
  // Tapping yourself while you stand on your own plot opens it in 3D.
  if (tile.x === r.x && tile.y === r.y && mirror.ownerAt(r.x, r.y) === r.id && navigate) {
    navigate(plot3dPath(r.id));
    return;
  }
  // Tapping someone shows who they are. Names and notes are untrusted: textContent only.
  const other = mirror.residentAt(tile.x, tile.y);
  // The Town Hall opens its page, unless someone is standing in its doorway. So does the shop.
  if (!other && mirror.isTownHall(tile.x, tile.y) && navigate) {
    navigate("/town");
    return;
  }
  if (!other && mirror.isShop(tile.x, tile.y) && navigate) {
    navigate("/shop");
    return;
  }
  // A planter, kitchen, or workbench opens what you can do there (RFC 0005). One farther off is
  // somewhere to walk to: you stop once it's in reach, since walking into it only bumps, and it
  // opens then.
  const here = mirror.blocks.get(`${tile.x},${tile.y}`);
  if (!other && here && STATIONS.includes(here)) {
    if (inReach(r, tile)) openStation(tile.x, tile.y);
    else walkTarget = { ...tile, station: true };
    return;
  }
  // A fallen branch or a loose stone: tap to pick it up (phase 1 gathering). One farther off is
  // somewhere to walk to: you stop once it's in reach and pick it up then. The sim has the last
  // word; its `nothing_to_gather` says someone got there first. One on someone else's plot is
  // theirs: say so rather than walk there for nothing.
  if (!other && mirror.pickupAt(tile.x, tile.y)) {
    if (!mirror.mayGatherAt(tile.x, tile.y, r.id)) {
      const owner = mirror.ownerAt(tile.x, tile.y);
      showToast(othersPickupLine(owner ? mirror.residents.get(owner)?.name : undefined));
      return;
    }
    if (inReach(r, tile)) tryAct({ type: "gather", x: tile.x, y: tile.y });
    else walkTarget = { ...tile, pickup: true };
    return;
  }
  if (other && other.id !== me) {
    const name = other.kind === "agent" ? `${other.name} ⚙` : other.name;
    showToast(other.note ? `${name}: ${other.note}` : name, "player");
    return;
  }
  walkTarget = tile;
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

/** Show the world in 3D, fetching the scene code (three.js included) the first time. */
function open3d() {
  if (world3d || loading3d || !active || !me) return;
  loading3d = true;
  modeButton.setAttribute("aria-busy", "true");
  import("./scene3d/world")
    .then((m) => {
      loading3d = false;
      modeButton.removeAttribute("aria-busy");
      if (mode !== "3d" || !active || !me) return;
      host3d.hidden = false;
      world3d = m.createWorld3d(host3d, { onTap: tapTile, onFail: fallBack });
      canvas.hidden = true;
    })
    .catch(() => {
      loading3d = false;
      modeButton.removeAttribute("aria-busy");
      fallBack("failed");
    });
}

/** Back to the 2D map, keeping the choice for next time. */
function close3d() {
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

for (const button of padButtons) {
  button.addEventListener("click", () => step(steer(button.dataset.dir as Direction)));
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

window.addEventListener("keydown", (e) => {
  if (!active || !me || keysTaken()) return;
  const dir = KEYS[e.key];
  if (!dir) return;
  e.preventDefault();
  // Key repeat is ignored: the frame loop walks a held key at its own steady pace.
  if (e.repeat) return;
  releaseKey(dir);
  heldKeys.push(dir);
  step(steer(dir));
});
window.addEventListener("keyup", (e) => {
  const dir = KEYS[e.key];
  if (dir) releaseKey(dir);
});
// A key released while the page is in the background never sends keyup.
window.addEventListener("blur", () => {
  heldKeys.length = 0;
});

function releaseKey(dir: Direction) {
  const i = heldKeys.indexOf(dir);
  if (i >= 0) heldKeys.splice(i, 1);
}

$("claim").addEventListener("click", () => {
  const r = self();
  if (r && mirror?.ownerAt(r.x, r.y) === me) {
    showToast("This plot is already yours. Tap Build to start.");
    return;
  }
  tryAct({ type: "claim" });
});

$("hud-invite").addEventListener("click", () => {
  void import("./invite-share").then((m) => m.openInviteDialog());
});

buildButton.addEventListener("click", () => {
  // With no plot there's nowhere to build: say how to get one instead.
  if (!buildMode && self() && !hasPlot()) {
    showToast(NO_PLOT_LINE);
    return;
  }
  buildMode = !buildMode;
  buildButton.setAttribute("aria-pressed", String(buildMode));
  palette.hidden = !buildMode;
  if (buildMode) showToast("Tap a tile to build. Tap a block to remove it.");
  // A fresh start: only the decor you hold now.
  decorShown = new Set(decor.keys());
  paintPalette();
});

for (const button of palette.querySelectorAll<HTMLButtonElement>("button")) {
  const kind = button.dataset.block as BlockKind | "hearth";
  const chip = button.querySelector<HTMLElement>(".chip");
  if (chip) chip.style.background = kind === "hearth" ? HEARTH_COLOR : blockColor(kind);
  button.setAttribute("aria-pressed", String(kind === block));
}

// One listener for every choice, including the decor buttons painted in and out as counts change.
palette.addEventListener("click", (e) => {
  const button = (e.target as Element).closest<HTMLButtonElement>("button[data-block]");
  if (button && !button.disabled) selectBlock(button.dataset.block as BlockKind | "hearth");
});

function selectBlock(kind: BlockKind | "hearth") {
  block = kind;
  for (const b of palette.querySelectorAll<HTMLButtonElement>("button"))
    b.setAttribute("aria-pressed", String(b.dataset.block === kind));
}

/** Redraw the decor choices. A decor you no longer hold can't stay picked: back to wood. */
function paintPalette() {
  if (isDecorKind(block) && !decor.has(block)) selectBlock("wood");
  for (const kind of decor.keys()) decorShown.add(kind);
  paintDecorChoices(palette, decorChoices(decor, decorShown), block);
}

/** Ask what decor you hold. Quietly nothing when items aren't open or the request fails. */
async function loadDecor() {
  const r = await api.inventory();
  if (!active || !r.ok) return;
  decor = decorFromStacks(r.data.inventory?.stacks ?? []);
  paintPalette();
}

$("home").addEventListener("click", () => {
  walkTarget = undefined;
  // No hearth is nowhere to go: say how to set one now, rather than after a round trip.
  const r = self();
  if (r && !r.hearth) {
    showToast(worldProblem("no_hearth", "", { hasPlot: hasPlot() }));
    return;
  }
  tryAct({ type: "home" });
});

chatToggle.addEventListener("click", () => {
  chatPanel.hidden = !chatPanel.hidden;
  chatToggle.setAttribute("aria-pressed", String(!chatPanel.hidden));
  if (!chatPanel.hidden) {
    chatLog.scrollTop = chatLog.scrollHeight;
    chatInput.focus();
  }
});

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

let lastWalk = 0;
function frame(t: number) {
  const r = self();
  if (r) {
    cam.cx += (r.x - cam.cx) * 0.2;
    cam.cy += (r.y - cam.cy) * 0.2;
    // Walking: one step at a time, each waiting for the server to confirm the last. Presses and
    // taps go first, then a held key, then a tapped destination.
    if (!pendingMove && t - lastWalk >= STEP_MS) {
      // Walking to a planter or a kitchen: stop once it's in reach, and open it.
      if (
        walkTarget?.station &&
        !queuedSteps.length &&
        !heldKeys.length &&
        inReach(r, walkTarget)
      ) {
        openStation(walkTarget.x, walkTarget.y);
        walkTarget = undefined;
      }
      // Walking to a pickup: stop once it's in reach, and pick it up, unless its plot was claimed
      // by someone else on the way.
      if (walkTarget?.pickup && !queuedSteps.length && !heldKeys.length && inReach(r, walkTarget)) {
        const { x, y } = walkTarget;
        const m = mirror;
        if (!m || m.mayGatherAt(x, y, r.id)) tryAct({ type: "gather", x, y });
        else showToast(othersPickupLine(m.residents.get(m.ownerAt(x, y) ?? "")?.name));
        walkTarget = undefined;
      }
      // A held key walks the way it points now, so it follows the camera as it turns.
      const held = heldKeys.at(-1);
      const dir =
        queuedSteps.shift() ?? (held && steer(held)) ?? (walkTarget && stepToward(r, walkTarget));
      if (dir) {
        pendingMove = act({ type: "move", dir });
        lastWalk = t;
      } else walkTarget = undefined;
    }
  } else if (mirror) {
    // Behind the curtain: a slow drift around the Commons.
    const { plotSize } = mirror.config;
    const ox = (mirror.commons.px + 0.5) * plotSize - 0.5;
    const oy = (mirror.commons.py + 0.5) * plotSize - 0.5;
    const drift = motionQuery.matches ? 0 : t / 1000;
    cam.cx = ox + Math.sin(drift / 9) * 4;
    cam.cy = oy + Math.cos(drift / 13) * 2.5 + 1.5;
    cam.scale = targetScale();
  }
  // Advance the server's time anchor with our own clock, so every client
  // renders the same night at the same time without asking the server again.
  const phase = dayAnchor
    ? dayPhase(dayAnchor.nowMs + (performance.now() - dayAnchor.receivedAt), dayAnchor.dayLengthMs)
    : undefined;
  paintPad(world3d?.heading() ?? 0, world3d !== undefined);
  const now = performance.now();
  const still = motionQuery.matches;
  if (world3d && mirror && me) world3d.sync({ mirror, me, buildMode, feelings });
  else if (mirror)
    render(ctx, {
      mirror,
      me,
      cam,
      buildMode,
      feelings,
      now,
      still,
      ...(phase === undefined ? {} : { dayPhase: phase }),
    });
  // Your own figure's feeling, a name from a fixed list, once you're in: for tests and tools.
  const mine = me ? feelings.feeling(me, now) : "";
  if (canvas.dataset.feeling !== mine) canvas.dataset.feeling = mine;
  if (active) rafId = requestAnimationFrame(frame);
}

window.addEventListener("resize", () => {
  if (active) resize();
});

/** Show the world: start drawing, and connect if we have a token. */
export function startWorld(options: { navigate?: (path: string) => void } = {}) {
  if (active) return;
  active = true;
  navigate = options.navigate;
  mode = startMode(savedMode(), signals);
  paintMode();
  resize();
  rafId = requestAnimationFrame(frame);
  const token = savedToken();
  if (token) {
    // Returning resident: skip the landing and go straight in. The snapshot draws the world while
    // the socket says hello, and if the server is down, "Can't reach the world" says why it's empty.
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
  close3d();
  stopPopulation?.();
  stopPopulation = undefined;
  conn?.close();
  conn = undefined;
  me = undefined;
  joiningFresh = false;
  decor = new Map();
  decorShown = new Set();
  paintPalette();
  pendingChat = undefined;
  stopWalking();
  hud.hidden = true;
  worldWait.hidden = true;
  landing.setJoining(false);
}
