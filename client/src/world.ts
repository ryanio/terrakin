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
import type { BlockKind, Direction } from "@terrakin/sim";
import { plot3dPath } from "@terrakin/ui/paths";
import { whoseKey } from "./api";
import { type Camera, fitScale, screenToTile, stepToward } from "./camera";
import { createLanding } from "./landing";
import { Mirror } from "./mirror";
import { Connection, type Identity, savedToken, saveToken } from "./net";
import { blockColor, HEARTH_COLOR, render } from "./render";
import { track } from "./telemetry";
import { dayPhase } from "./time";
import { ARRIVAL_KEY, gestureLine } from "./together";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("world");
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const curtain = $("curtain");
const hud = $("hud");
const status = $("status");
const toast = $("toast");
const chatPanel = $("chat");
const chatLog = $<HTMLOListElement>("chat-log");
const chatInput = $<HTMLInputElement>("chat-input");
const chatToggle = $("chat-toggle");
const buildButton = $("build");
const palette = $("palette");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let active = false;
let rafId = 0;
let populationTimer: ReturnType<typeof setInterval> | undefined;
let conn: Connection | undefined;
let mirror: Mirror | undefined;
let me: string | undefined;
/** How the world asks the site router to go to another page (the Town Hall, your plot in 3D). */
let navigate: ((path: string) => void) | undefined;
let buildMode = false;
/** Selected build tool: a block, or the hearth marker. */
let block: BlockKind | "hearth" = "wood";
let walkTarget: { x: number; y: number } | undefined;
let pendingMove: string | undefined;
let resyncing = false;
/** True between pressing "Step inside" and the server's welcome, so we count a join once. */
let joiningFresh = false;
/** Server time anchor from the latest snapshot, plus when we received it locally. */
let dayAnchor: { nowMs: number; dayLengthMs: number; receivedAt: number } | undefined;
const cam: Camera = { cx: 0, cy: 0, scale: 32, width: 0, height: 0 };

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
  joiningFresh = false;
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

// ---------- connection ----------

function connect(identity: Identity) {
  conn?.close();
  conn = new Connection(identity, onMessage, (s) => {
    status.textContent =
      s === "online" ? "" : s === "connecting" ? "Connecting…" : "Offline, retrying…";
    if (s === "offline" && joiningFresh && !me)
      landing.setError("Can't reach the world right now. Still trying…");
    if (s !== "online") stopWalking();
  });
}

function stopWalking() {
  walkTarget = undefined;
  pendingMove = undefined;
}

/** Remember the server's day/night anchor and when it arrived. No anchor means no night. */
function anchor(time: WorldSnapshot["time"]) {
  return time ? { ...time, receivedAt: performance.now() } : undefined;
}

/** Reload the world from the server. One at a time; events are ignored until it lands. */
async function resync() {
  if (resyncing) return;
  resyncing = true;
  try {
    const parsed = WorldSnapshot.safeParse(await (await fetch("/v1/world")).json());
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
      snapCamera();
      showArrival();
      break;
    case "gesture":
      // Someone sent you a hug or a wave. Their name and note are their words: shown as text.
      showToast(gestureLine(msg.kind, msg.from.name, msg.note), "player");
      break;
    case "event":
      // Out of step with the server? Reload the truth rather than guessing.
      if (mirror && !resyncing && mirror.apply(msg) === "gap") void resync();
      break;
    case "chat":
      addChat(msg.from.name, msg.from.kind, msg.text, msg.channel);
      break;
    case "ack":
      if (msg.id === pendingMove) pendingMove = undefined;
      break;
    case "error":
      if (msg.id === pendingMove) {
        pendingMove = undefined;
        walkTarget = undefined;
      }
      if (msg.error.code === "unauthorized" || msg.error.code === "invalid_name") {
        conn?.close();
        me = undefined;
        hud.hidden = true;
        leaveWorld();
        landing.setError(msg.error.code === "invalid_name" ? msg.error.message : "");
        if (msg.error.code === "invalid_name") landing.focusName();
        void resync();
        return;
      }
      showToast(msg.error.message);
      break;
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
/** Player text (chat, names, notes) gets its own style so it can't pass for a system message. */
function showToast(text: string, source: "system" | "player" = "system") {
  toast.textContent = text;
  toast.classList.toggle("player", source === "player");
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), source === "player" ? 4000 : 2600);
}

// ---------- input ----------

function step(dir: Direction) {
  walkTarget = undefined;
  act({ type: "move", dir });
}

function self() {
  return me ? mirror?.residents.get(me) : undefined;
}

canvas.addEventListener("pointerdown", (e) => {
  const r = self();
  if (!mirror || !r) return;
  const tile = screenToTile(cam, e.clientX, e.clientY);
  if (buildMode) {
    const hasBlock = mirror.blocks.has(`${tile.x},${tile.y}`);
    if (block === "hearth") act({ type: "set_hearth", ...tile });
    else act(hasBlock ? { type: "remove", ...tile } : { type: "place", ...tile, block });
    return;
  }
  // Tapping yourself while you stand on your own plot opens it in 3D.
  if (tile.x === r.x && tile.y === r.y && mirror.ownerAt(r.x, r.y) === r.id && navigate) {
    navigate(plot3dPath(r.id));
    return;
  }
  // Tapping someone shows who they are. Names and notes are untrusted: textContent only.
  const other = mirror.residentAt(tile.x, tile.y);
  // The Town Hall opens its page, unless someone is standing in its doorway.
  if (!other && mirror.isTownHall(tile.x, tile.y) && navigate) {
    navigate("/town");
    return;
  }
  if (other && other.id !== me) {
    const name = other.kind === "agent" ? `${other.name} ⚙` : other.name;
    showToast(other.note ? `${name}: ${other.note}` : name, "player");
    return;
  }
  walkTarget = tile;
});

for (const button of document.querySelectorAll<HTMLButtonElement>(".dpad button")) {
  button.addEventListener("click", () => step(button.dataset.dir as Direction));
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
window.addEventListener("keydown", (e) => {
  if (!active || !me || document.activeElement instanceof HTMLInputElement) return;
  const dir = KEYS[e.key];
  if (dir) {
    e.preventDefault();
    step(dir);
  }
});

$("claim").addEventListener("click", () => act({ type: "claim" }));

$("hud-invite").addEventListener("click", () => {
  void import("./invite-share").then((m) => m.openInviteDialog());
});

buildButton.addEventListener("click", () => {
  buildMode = !buildMode;
  buildButton.setAttribute("aria-pressed", String(buildMode));
  palette.hidden = !buildMode;
  if (buildMode) showToast("Tap a tile to build. Tap a block to remove it.");
});

for (const button of palette.querySelectorAll<HTMLButtonElement>("button")) {
  const kind = button.dataset.block as BlockKind | "hearth";
  const chip = button.querySelector<HTMLElement>(".chip");
  if (chip) chip.style.background = kind === "hearth" ? HEARTH_COLOR : blockColor(kind);
  button.setAttribute("aria-pressed", String(kind === block));
  button.addEventListener("click", () => {
    block = kind;
    for (const b of palette.querySelectorAll("button"))
      b.setAttribute("aria-pressed", String(b === button));
  });
}

$("home").addEventListener("click", () => {
  walkTarget = undefined;
  act({ type: "home" });
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
  if (text) act({ type: "chat", text, channel });
  chatInput.value = "";
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
    // Tap-to-walk: one step at a time, each waiting for the server to confirm the last.
    if (walkTarget && !pendingMove && t - lastWalk > 110) {
      const dir = stepToward(r, walkTarget);
      if (dir) pendingMove = act({ type: "move", dir });
      else walkTarget = undefined;
      lastWalk = t;
    }
  } else if (mirror) {
    // Behind the curtain: a slow drift around the Commons.
    const { plotSize } = mirror.config;
    const ox = (mirror.commons.px + 0.5) * plotSize - 0.5;
    const oy = (mirror.commons.py + 0.5) * plotSize - 0.5;
    const drift = reducedMotion.matches ? 0 : t / 1000;
    cam.cx = ox + Math.sin(drift / 9) * 4;
    cam.cy = oy + Math.cos(drift / 13) * 2.5 + 1.5;
    cam.scale = targetScale();
  }
  // Advance the server's time anchor with our own clock, so every client
  // renders the same night at the same time without asking the server again.
  const phase = dayAnchor
    ? dayPhase(dayAnchor.nowMs + (performance.now() - dayAnchor.receivedAt), dayAnchor.dayLengthMs)
    : undefined;
  if (mirror)
    render(ctx, {
      mirror,
      me,
      cam,
      buildMode,
      ...(phase === undefined ? {} : { dayPhase: phase }),
    });
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
  resize();
  rafId = requestAnimationFrame(frame);
  const token = savedToken();
  if (token) {
    // Returning resident: skip the landing and go straight in.
    enterWorld(true);
    hud.hidden = false;
    connect({ token });
  } else {
    void resync();
    // Keep the "online now" line fresh while someone reads the landing page.
    populationTimer = setInterval(() => {
      if (landing.isUp() && document.visibilityState === "visible") void resync();
    }, 20_000);
  }
}

/** Leave the world: stop the loop, close the socket, and forget who is walking where. */
export function stopWorld() {
  if (!active) return;
  active = false;
  cancelAnimationFrame(rafId);
  clearInterval(populationTimer);
  populationTimer = undefined;
  conn?.close();
  conn = undefined;
  me = undefined;
  joiningFresh = false;
  stopWalking();
  hud.hidden = true;
  landing.setJoining(false);
}
