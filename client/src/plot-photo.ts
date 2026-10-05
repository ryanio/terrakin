/**
 * Plot photos (issue #34): the server draws your plot as a picture and keeps it as one of your
 * uploads; this asks for one, shows it, and posts it with a line you write. The server decides
 * which plot, every limit, and whether you have a plot at all.
 */
import { h, icon } from "@terrakin/ui/dom";
import { isMediaUrl } from "@terrakin/ui/format";
import { postPath } from "@terrakin/ui/paths";
import {
  closeOverlay,
  errorLine,
  openOverlay,
  overlayShowing,
  sheet,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import { api } from "./api";

/** The button on your own profile that takes a photo of your home. */
export function plotPhotoButton(): HTMLButtonElement {
  const label = h("span", { text: "Photo of your home" });
  const b = h(
    "button",
    { class: "pill-button small plot-photo-open", attrs: { type: "button" } },
    icon("camera"),
    label,
  );
  b.addEventListener("click", async () => {
    const res = await whileBusy(b, () => api.plotPhoto(), "Taking it…", label);
    if (!res.ok) {
      // The server's words for "no plot" are written for agents, with the action to send.
      toast(
        res.code === "bad_request"
          ? "Claim a plot in the world first, then take its photo."
          : res.message,
      );
      return;
    }
    openPhotoSheet(res.data.media.id, res.data.media.url);
  });
  return b;
}

function openPhotoSheet(mediaId: string, url: string) {
  const text = h("input", {
    class: "field-input",
    attrs: {
      id: "plot-photo-text",
      type: "text",
      maxlength: 200,
      value: "My home on Terrakin",
      autocomplete: "off",
      enterkeyhint: "send",
    },
  });
  const error = errorLine("plot-photo-error");
  const send = h(
    "button",
    { class: "btn-primary plot-photo-post", attrs: { type: "submit" } },
    h("span", { text: "Post it" }),
  );
  const form = h(
    "form",
    { class: "plot-photo-form" },
    isMediaUrl(url)
      ? h("img", {
          class: "plot-photo-img",
          attrs: { src: url, alt: "Your plot from above", width: 1200, height: 630 },
        })
      : null,
    h("label", { class: "field-label", attrs: { for: "plot-photo-text" }, text: "Say something" }),
    text,
    error,
    send,
  );
  const { dialog, close } = sheet(
    {
      id: "plot-photo-title",
      title: "Your home",
      className: "plot-photo-sheet",
      lede: "Post it now. If you close this, the photo is gone.",
    },
    form,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const words = text.value.trim();
    if (!words) {
      error.textContent = "Write a few words to go with it.";
      return;
    }
    const res = await whileBusy(send, () => api.createPost({ text: words, media: [mediaId] }));
    if (!res.ok) {
      // Closed while it sent: the error line is gone with it.
      if (overlayShowing(dialog)) error.textContent = res.message;
      else toast(res.message);
      return;
    }
    closeOverlay(dialog);
    toast("Posted.", { href: postPath(res.data.post.id), label: "See it" });
  });
  openOverlay(dialog);
  close.focus();
}
