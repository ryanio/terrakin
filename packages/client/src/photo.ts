/**
 * The scene photo page (`/photo?t=<ticket>`, RFC 0049), its own small entry so the headless browser
 * that takes the photo loads no app shell, no socket, and no telemetry. It reads the ticket's scene
 * and the public snapshot, draws, and says `data-photo="ready"` on the body, or `failed`. It never
 * sends an action.
 */
import "./jitless";
import "@fontsource-variable/figtree";
import "@fontsource-variable/fraunces/full.css";
import "./photo.css";
import { PhotoScene, WorldSnapshot } from "@terrakin/protocol";

const say = (state: "ready" | "failed") => {
  document.body.dataset.photo = state;
};

async function take() {
  const ticket = new URLSearchParams(location.search).get("t") ?? "";
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

take().catch((err: unknown) => {
  console.warn("Scene photo failed", err);
  say("failed");
});
