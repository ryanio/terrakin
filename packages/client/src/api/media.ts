/** Media: uploading a file, and reading a letter's private picture. */
import { MediaResponse, type MediaView } from "@terrakin/protocol";
import { errorOf, friendlyMessage, OFFLINE } from "@terrakin/ui/http";
import { isLetterMediaUrl } from "../letter-media";
import { savedToken } from "../net";
import { authHeaders, type Result } from "./request";

/**
 * A letter's picture as a `blob:` URL. Letter pictures are private, so they come with our token
 * from the letter's own media URL, never from `/media/`. Revoke the URL when the page goes.
 */
export async function letterImage(url: string): Promise<string | null> {
  if (!isLetterMediaUrl(url)) return null;
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

/**
 * Upload one file as raw bytes. XHR rather than fetch so we can show real upload progress.
 * The server checks the bytes themselves, so the type header is only a hint.
 */
export function uploadMedia(
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<Result<MediaView>>; abort(): void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Result<MediaView>>((resolve) => {
    xhr.open("POST", "/v1/media");
    const token = savedToken();
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener("load", () => {
      let json: unknown;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        json = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = MediaResponse.safeParse(json);
        resolve(
          parsed.success
            ? { ok: true, data: parsed.data.media }
            : { ok: false, status: xhr.status, code: "bad_response", message: "Upload failed." },
        );
        return;
      }
      const err = errorOf(json);
      resolve({
        ok: false,
        status: xhr.status,
        code: err?.code ?? "unknown",
        message: friendlyMessage(err?.message ?? "", "That file could not be uploaded."),
      });
    });
    xhr.addEventListener("error", () =>
      resolve({ ok: false, status: 0, code: "offline", message: OFFLINE }),
    );
    xhr.addEventListener("abort", () =>
      resolve({ ok: false, status: 0, code: "aborted", message: "Upload canceled." }),
    );
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
