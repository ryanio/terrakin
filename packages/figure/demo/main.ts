/**
 * The demo: one body on a stage, with a button for every clip and feeling, a speed to walk at,
 * and a pointer to look at. It loads the plain plush, or any `.glb` dropped on the page.
 */
import {
  CircleGeometry,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { checkBody, drive, FEELINGS, glbJson } from "../src/index.js";
import { type Body, BodyError, loadBody } from "../src/three.js";
import { plainPlush } from "./plush.js";

/** How tall the body stands on the stage. */
const HEIGHT = 0.75;

function need<T extends HTMLElement>(id: string, kind: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof kind)) throw new Error(`the page has no #${id}`);
  return found;
}

const stage = need("stage", HTMLDivElement);
const status = need("status", HTMLParagraphElement);
const report = need("report", HTMLUListElement);
const clipRow = need("clips", HTMLParagraphElement);
const feelingRow = need("feelings", HTMLParagraphElement);
const speed = need("speed", HTMLInputElement);
const speedOut = need("speed-out", HTMLOutputElement);
const air = need("air", HTMLInputElement);
const look = need("look", HTMLInputElement);
const still = need("still", HTMLInputElement);

const renderer = new WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = SRGBColorSpace;
stage.append(renderer.domElement);

const scene = new Scene();
scene.add(new HemisphereLight(0xfff3dc, 0x8a6a48, 1.4));
const sun = new DirectionalLight(0xffe2b8, 2);
sun.position.set(2, 4, 3);
scene.add(sun);
const ground = new Mesh(
  new CircleGeometry(1.6, 48).rotateX(-Math.PI / 2),
  new MeshStandardMaterial({ color: 0xcbb98f, roughness: 1 }),
);
scene.add(ground);
/** Lines on the ground that slide back under a walking body, so planted feet can be judged. */
const lines = new GridHelper(3.2, 16, 0xa8946a, 0xa8946a);
lines.position.y = 0.002;
scene.add(lines);

const camera = new PerspectiveCamera(35, 1, 0.05, 50);
camera.position.set(0.8, 0.7, 2.7);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, HEIGHT * 0.48, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 0.8;
controls.maxDistance = 6;

function resize() {
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  renderer.setSize(width, height, false);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

let body: Body | undefined;
/** The clip a button asked for, played whenever the body isn't being moved by the speed slider. */
let asked = "idle";
let walked = 0;

function line(text: string, className = "") {
  const item = document.createElement("li");
  item.textContent = text;
  item.className = className;
  return item;
}

function button(row: HTMLElement, label: string, press: () => void) {
  const made = document.createElement("button");
  made.type = "button";
  made.textContent = label;
  made.addEventListener("click", () => {
    for (const other of row.querySelectorAll("button")) other.setAttribute("aria-pressed", "false");
    made.setAttribute("aria-pressed", "true");
    press();
  });
  row.append(made);
  return made;
}

/** Clips that read as one gesture are played through once; the rest loop. */
const ONCE = new Set(["wave", "hop"]);

function controlsFor(loaded: Body) {
  clipRow.replaceChildren();
  // A walk and a hop are offered even when the body has neither, to show what stands in.
  for (const clip of new Set([...loaded.clips, "walk", "hop"])) {
    const made = button(
      clipRow,
      loaded.clips.includes(clip) ? clip : `${clip} (made in code)`,
      () => {
        if (ONCE.has(clip)) {
          loaded.play(clip, { loop: false });
        } else {
          asked = clip;
          loaded.play(clip);
        }
      },
    );
    if (clip === "idle") made.setAttribute("aria-pressed", "true");
  }
  feelingRow.replaceChildren();
  for (const feeling of FEELINGS) {
    const made = button(feelingRow, feeling, () => loaded.feel(feeling));
    if (feeling === "neutral") made.setAttribute("aria-pressed", "true");
  }
}

async function show(bytes: Uint8Array, name: string) {
  report.replaceChildren();
  status.textContent = `Reading ${name}…`;
  try {
    // The same check loadBody runs, shown here so the page can list what the body holds.
    const found = checkBody(glbJson(bytes));
    for (const problem of found.problems) report.append(line(problem, "problem"));
    for (const note of found.notes) report.append(line(note));
    const loaded = await loadBody(bytes, { height: HEIGHT, id: name });
    body?.dispose();
    body = loaded;
    asked = "idle";
    loaded.still = still.checked;
    scene.add(loaded.object);
    controlsFor(loaded);
    const walk =
      loaded.walkSpeed === undefined
        ? "no walk speed given"
        : `walks ${loaded.walkSpeed.toFixed(2)} a second`;
    status.textContent = `${name}: ${found.triangles} triangles, ${found.joints} joints, ${loaded.clips.length} clips, ${found.expressions.length} face keys, ${walk}.`;
  } catch (err) {
    status.textContent =
      err instanceof BodyError ? `${name} isn't a body.` : `${name} couldn't be shown.`;
    if (err instanceof BodyError && report.childElementCount === 0) {
      for (const problem of err.problems) report.append(line(problem, "problem"));
    }
  }
}

const showPlush = async () => show(await plainPlush(), "The plain plush");
need("plush", HTMLButtonElement).addEventListener("click", showPlush);
need("file", HTMLInputElement).addEventListener("change", async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) await show(new Uint8Array(await file.arrayBuffer()), "Your file");
});
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", async (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) await show(new Uint8Array(await file.arrayBuffer()), "Your file");
});
still.addEventListener("change", () => {
  if (body) body.still = still.checked;
});

const pointer = new Vector2();
const ray = new Raycaster();
/** A wall a little in front of the body, where the pointer lands as a point to look at. */
const wall = new Plane(new Vector3(0, 0, -1), 0.9);
const target = new Vector3();
let pointing = false;
stage.addEventListener("pointermove", (event) => {
  const box = stage.getBoundingClientRect();
  pointer.set(
    ((event.clientX - box.left) / box.width) * 2 - 1,
    -((event.clientY - box.top) / box.height) * 2 + 1,
  );
  pointing = true;
});
stage.addEventListener("pointerleave", () => {
  pointing = false;
});

let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const seconds = Math.min((now - last) / 1000, 0.1);
  last = now;
  controls.update();
  if (body) {
    // The slider is in walks: 1 is the speed the body's own walk covers ground at.
    const pace = Number(speed.value);
    const walk = body.walkSpeed ?? HEIGHT * 0.4;
    const moving = pace > 0 || air.checked;
    if (moving) {
      const next = drive({ speed: pace * walk, grounded: !air.checked }, body);
      body.play(next.clip, { rate: next.rate });
      speedOut.textContent = `${next.clip} at ${next.rate.toFixed(2)}`;
      if (!air.checked) walked += pace * walk * seconds;
    } else {
      body.play(asked);
      speedOut.textContent = "standing";
    }
    lines.position.z = -(walked % 0.2);
    ray.setFromCamera(pointer, camera);
    body.lookAt(
      look.checked && pointing && ray.ray.intersectPlane(wall, target) ? target : undefined,
    );
    body.update(seconds);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
void showPlush();
