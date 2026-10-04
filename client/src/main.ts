import {
  type Action,
  type ChatChannel,
  type ServerMessage,
  WorldSnapshot,
} from "@terrakin/protocol";
import { type BlockKind, type Direction, RESIDENT_COLORS, type ResidentColor } from "@terrakin/sim";
import { type Camera, fitScale, screenToTile, stepToward } from "./camera";
import { Mirror } from "./mirror";
import { Connection, savedToken } from "./net";
import { blockColor, HEARTH_COLOR, RESIDENT_COLOR_HEX, render } from "./render";
import { dayPhase } from "./time";
import "./style.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("world");
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const joinForm = $<HTMLFormElement>("join");
const joinError = $("join-error");
const hud = $("hud");
const status = $("status");
const toast = $("toast");
const chatPanel = $("chat");
const chatLog = $<HTMLOListElement>("chat-log");
const chatInput = $<HTMLInputElement>("chat-input");
const buildButton = $("build");
const palette = $("palette");

let conn: Connection | undefined;
let mirror: Mirror | undefined;
let me: string | undefined;
let buildMode = false;
/** Selected build tool: a block, or the hearth marker. */
let block: BlockKind | "hearth" = "wood";
let walkTarget: { x: number; y: number } | undefined;
let pendingMove: string | undefined;
let resyncing = false;
/** Server time anchor from the latest snapshot, plus when we received it locally. */
let dayAnchor: { nowMs: number; dayLengthMs: number; receivedAt: number } | undefined;
const cam: Camera = { cx: 0, cy: 0, scale: 32, width: 0, height: 0 };

// ---------- connection ----------

function connect(
  identity: { token: string } | { name: string; kind: "human"; color: ResidentColor },
) {
  conn?.close();
  conn = new Connection(identity, onMessage, (s) => {
    status.textContent =
      s === "online" ? "" : s === "connecting" ? "Connecting…" : "Offline, retrying…";
    if (s !== "online") stopWalking();
  });
}

function stopWalking() {
  walkTarget = undefined;
  pendingMove = undefined;
}

/** Reload the world from the server. One at a time; events are ignored until it lands. */
async function resync() {
  if (resyncing) return;
  resyncing = true;
  try {
    const parsed = WorldSnapshot.safeParse(await (await fetch("/v1/world")).json());
    if (parsed.success) {
      mirror = new Mirror(parsed.data);
      dayAnchor = { ...parsed.data.time, receivedAt: performance.now() };
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
      dayAnchor = { ...msg.world.time, receivedAt: performance.now() };
      stopWalking();
      joinForm.hidden = true;
      hud.hidden = false;
      snapCamera();
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
        hud.hidden = true;
        joinForm.hidden = false;
        joinError.textContent = msg.error.code === "invalid_name" ? msg.error.message : "";
        return;
      }
      showToast(msg.error.message);
      break;
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
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
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
  // Tapping someone shows who they are. Names and notes are untrusted: textContent only.
  const other = mirror.residentAt(tile.x, tile.y);
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
  if (document.activeElement instanceof HTMLInputElement) return;
  const dir = KEYS[e.key];
  if (dir) {
    e.preventDefault();
    step(dir);
  }
});

$("claim").addEventListener("click", () => act({ type: "claim" }));

buildButton.addEventListener("click", () => {
  buildMode = !buildMode;
  buildButton.setAttribute("aria-pressed", String(buildMode));
  palette.hidden = !buildMode;
});

for (const button of palette.querySelectorAll<HTMLButtonElement>("button")) {
  const kind = button.dataset.block as BlockKind | "hearth";
  button.style.background = kind === "hearth" ? HEARTH_COLOR : blockColor(kind);
  button.addEventListener("click", () => {
    block = kind;
    for (const b of palette.querySelectorAll("button"))
      b.classList.toggle("selected", b === button);
  });
  if (kind === block) button.classList.add("selected");
}

$("home").addEventListener("click", () => {
  walkTarget = undefined;
  act({ type: "home" });
});

$("chat-toggle").addEventListener("click", () => {
  chatPanel.hidden = !chatPanel.hidden;
  if (!chatPanel.hidden) chatInput.focus();
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

let color: ResidentColor =
  RESIDENT_COLORS[Math.floor(Math.random() * RESIDENT_COLORS.length)] ?? "sun";
const swatches = $("join-color");
for (const c of RESIDENT_COLORS) {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("aria-label", c);
  b.style.background = RESIDENT_COLOR_HEX[c];
  b.classList.toggle("selected", c === color);
  b.addEventListener("click", () => {
    color = c;
    for (const s of swatches.children) s.classList.toggle("selected", s === b);
  });
  swatches.append(b);
}

joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $<HTMLInputElement>("join-name").value.trim();
  if (name) connect({ name, kind: "human", color });
});

// ---------- loop ----------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  cam.width = window.innerWidth;
  cam.height = window.innerHeight;
  cam.scale = fitScale(cam.width, cam.height);
  canvas.width = Math.floor(cam.width * dpr);
  canvas.height = Math.floor(cam.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function snapCamera() {
  const r = self();
  if (r) Object.assign(cam, { cx: r.x, cy: r.y });
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
  requestAnimationFrame(frame);
}

window.addEventListener("resize", resize);
resize();
requestAnimationFrame(frame);

const token = savedToken();
if (token) connect({ token });
