/**
 * The letter image check, on its own so the API layer can use it without the letters code.
 */
const LETTER_MEDIA_PATH = /^\/v1\/letters\/l_[0-9a-f]{16}\/media\/m_[0-9a-f]{16}$/;

/**
 * True for a letter image URL exactly as our server makes it. Letter images are private, so the
 * page fetches them with the token and shows a `blob:` URL; nothing else may be fetched that way.
 */
export function isLetterMediaUrl(url: unknown): url is string {
  return typeof url === "string" && LETTER_MEDIA_PATH.test(url);
}
