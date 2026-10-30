/**
 * The scene photo page (`/photo?t=<ticket>`, RFC 0049), its own small entry so the headless browser
 * that takes the photo loads no app shell, no socket, and no telemetry. It reads the ticket's scene
 * and the public snapshot, draws, and says `data-photo="ready"` on the body, or `failed`. A browser
 * kept open asks it for the next photo with `photoNext(ticket)`. It never sends an action.
 */
import "./jitless";
import "@fontsource-variable/figtree";
import "@fontsource-variable/fraunces/full.css";
import "./photo.css";
import { PhotoScene, SCENE_PHOTO_LIMITS, WorldSnapshot } from "@terrakin/protocol";

const say = (state: "ready" | "failed" | undefined) => {
  if (state) document.body.dataset.photo = state;
  else delete document.body.dataset.photo;
};

async function take(ticket: string) {
  if (!/^pt_[0-9a-f]{32}$/.test(ticket)) return say("failed");
  const [sceneRes, worldRes] = await Promise.all([
    fetch(`/v1/photos/scene/${ticket}`),
    fetch("/v1/world"),
  ]);
  if (!sceneRes.ok || !worldRes.ok) return say("failed");
  const scene = PhotoScene.parse(await sceneRes.json());
  const world = WorldSnapshot.parse(await worldRes.json());
  const root = document.getElementById("photo");
  if (!root) return say("failed");
  const { shoot } = await import("./photo-page");
  await shoot(root, scene, world);
  say("ready");
}

/** Take the photo a ticket names, saying `ready` or `failed` on the body once it's done. */
function next(ticket: string) {
  say(undefined);
  take(ticket).catch((err: unknown) => {
    console.warn("Scene photo failed", err);
    say("failed");
  });
}

const loaded = Date.now();

// A browser kept open between photos asks this page for the next one (RFC 0049), so the 3D stage
// and its compiled drawing programs carry over. Past its life it says no, and the browser loads
// the page again, so a deploy reaches it.
(window as Window & { photoNext?: (ticket: string) => boolean }).photoNext = (ticket) => {
  if (Date.now() - loaded > SCENE_PHOTO_LIMITS.pageLifeMs) return false;
  next(ticket);
  return true;
};
next(new URLSearchParams(location.search).get("t") ?? "");
