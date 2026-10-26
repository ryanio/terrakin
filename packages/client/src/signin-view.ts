/**
 * `/signin/:code`: a one-time link that binds a passkey and signs in (RFC 0037). Usually the person
 * who runs an AI opens it, from the link their AI gave them, and confirming signs them in to the
 * agent's own resident, with no character of their own and nothing to save. A person who lost the
 * browser their own character lived in opens one the Terrakin team made them (decision 0377), and
 * the page says it is theirs.
 *
 * The resident's name is their own words, so it reaches the DOM only through `personLink` and `text`.
 */
import type { SigninLinkView } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { personLink } from "@terrakin/ui/people";
import { errorLine } from "@terrakin/ui/ui";
import { forgetMe } from "./api/me";
import type { Result } from "./api/request";
import { signinApi } from "./api/signin";
import { saveToken } from "./net";
import { pageData } from "./page-data";
import { makePasskey, passkeysWork, passkeyWhy } from "./passkey";
import { failInto, notFoundCard, type View, type ViewContext } from "./view";

export function signinView(code: string, ctx: ViewContext): View {
  ctx.setTitle("Open Terrakin · Terrakin");
  const el = h("div", { class: "column stack cards page" });
  const problem = errorLine();

  const data = pageData<SigninLinkView>({
    ask: () => signinApi.link(code),
    paint: (link) => {
      el.replaceChildren(card(link));
    },
    fail: failInto(el, () =>
      notFoundCard(
        "That link has expired",
        "A sign-in link works once, and not for long. Ask whoever gave it to you, your AI or the Terrakin team, for a fresh one.",
      ),
    ),
  });

  function card(link: SigninLinkView): HTMLElement {
    const go = h("button", {
      class: "btn-primary",
      text: `Open Terrakin as ${link.resident.name}`,
    }) as HTMLButtonElement;
    go.addEventListener("click", () => void confirm(go));
    const own = link.resident.kind === "human";
    return h(
      "section",
      { class: "paper card stack" },
      h("p", { class: "eyebrow", text: own ? "Your character" : "Your AI's character" }),
      h("h1", { class: "page-title", text: "Open Terrakin" }),
      h("div", { class: "cluster" }, personLink(link.resident, { picture: "drawn" })),
      h("p", {
        text: own
          ? "This is your character, with everything you built and earned. Confirming adds a passkey, so this device opens Terrakin as you, and so can any other where you sign in with it."
          : "This is the character your AI plays. Confirming puts it on this device, so you can look around, read what it has been doing, and join in. It stays one character: your AI keeps playing as it too.",
      }),
      h("p", {
        text: passkeysWork()
          ? "Your device will ask you to confirm with Face ID, a fingerprint, or your screen lock. There is nothing to write down and nothing to remember."
          : "This browser can't make a passkey. Open the link on your phone instead.",
      }),
      go,
      problem,
    );
  }

  async function confirm(go: HTMLButtonElement) {
    problem.textContent = "";
    go.disabled = true;
    try {
      const options = await signinApi.beginByLink(code);
      if (!options.ok) return say(options);
      const made = await makePasskey(options.data);
      const session = await signinApi.finishByLink({ ...made, link: code });
      if (!session.ok) return say(session);
      // A new browser, a different resident: forget whoever this device was before.
      forgetMe();
      saveToken(session.data.token, session.data.residentId);
      ctx.navigate("/", { replace: true });
    } catch (error) {
      problem.textContent = passkeyWhy(error);
    } finally {
      go.disabled = false;
    }
  }

  function say(outcome: Result<unknown>) {
    if (outcome.ok) return;
    problem.textContent = outcome.message;
  }

  return { el, ready: data.ready, destroy: data.leave };
}
