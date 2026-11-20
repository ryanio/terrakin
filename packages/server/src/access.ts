/**
 * Cloudflare Access sign-ins for admin.terrakin.org (RFC 0006, decision 0040). Access sits in front
 * of the admin host and adds a signed JWT to every request it lets through. `workers-start/access`
 * checks it (signature against the team's keys, audience, issuer, expiry) and then the sign-in
 * against the config's lists: staff emails, and service token client ids.
 *
 * A person's sign-in carries their email, and only maintainers' and moderators' emails get in. A
 * service token's carries none: its `common_name` is the token's client id, and the one in
 * `TERRAKIN_ACCESS_DEPLOY_CLIENT` is the deploy's replay check (decision 0257), which reads the
 * world log and nothing else. It is the only service token on the list.
 */
import { type AccessConfig, parseAccessConfig } from "workers-start/access";

/** The deploy's replay check, as a sign-in. */
export const DEPLOY_SERVICE = "deploy";
/** How a service sign-in's staff actor starts. A service is never a resident. */
export const SERVICE_ACTOR = "service:";
/** Its staff actor. `staffFor` gives it out for the world-log export alone, and it has no role. */
export const DEPLOY_ACTOR = `${SERVICE_ACTOR}${DEPLOY_SERVICE}`;
export const DEPLOY_READS_LOG_ONLY = "The deploy check's sign-in only reads the world log.";

/**
 * The config the admin host checks sign-ins against: `TERRAKIN_ACCESS_TEAM` and
 * `TERRAKIN_ACCESS_AUD`, the maintainer and moderator emails, and the deploy check's client id.
 * Null without a team and audience, or with nobody on either list.
 */
export function staffAccessConfig(env: {
  team?: string | undefined;
  aud?: string | undefined;
  deployClient?: string | undefined;
  staffEmails: Iterable<string>;
}): AccessConfig | null {
  return parseAccessConfig({
    teamDomain: env.team,
    aud: env.aud,
    emails: [...env.staffEmails].join(","),
    serviceTokens: env.deployClient,
  });
}

/**
 * Whether Access is on (`TERRAKIN_ACCESS_TEAM` and `TERRAKIN_ACCESS_AUD` both set), and with it
 * the rule that a resident token never counts as staff.
 */
export function accessIsOn(team: string | undefined, aud: string | undefined): boolean {
  return Boolean(team?.trim() && aud?.trim());
}

/** Email lists from config: comma or whitespace separated, lowercased. */
export function parseEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[\s,]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@")),
  );
}

/** The ids the server gives residents: `r_` and 16 hex characters. */
const RESIDENT_ID = /^r_[0-9a-f]{16}$/;

/**
 * `TERRAKIN_STAFF_RESIDENTS`: which resident each staff sign-in email also is, as `email=residentId`
 * pairs separated by commas or spaces. Emails are lowercased. A pair without an `@` email, or whose
 * id isn't a resident id, is ignored, and so is a second pair for the same email. `warn` hears once
 * how many were ignored and how many map to nobody `isResident` knows, never which, so no email
 * reaches a log.
 */
export function parseStaffResidents(
  value: string | undefined,
  {
    warn = console.warn,
    isResident,
  }: { warn?: (message: string) => void; isResident?: (id: string) => boolean } = {},
): Map<string, string> {
  const residents = new Map<string, string>();
  let malformed = 0;
  let repeated = 0;
  for (const pair of (value ?? "").split(/[\s,]+/)) {
    if (pair === "") continue;
    const at = pair.indexOf("=");
    const email = pair.slice(0, at).toLowerCase();
    const resident = pair.slice(at + 1);
    if (at <= 0 || !/^[^@=]+@[^@=]+$/.test(email) || !RESIDENT_ID.test(resident)) malformed++;
    else if (residents.has(email)) repeated++;
    else residents.set(email, resident);
  }
  const unknown = isResident ? [...residents.values()].filter((id) => !isResident(id)).length : 0;
  const problems = [
    malformed > 0 ? `ignored ${malformed} malformed (each is email=r_ and 16 hex characters)` : "",
    repeated > 0 ? `ignored ${repeated} repeating an email already mapped` : "",
    unknown > 0 ? `${unknown} map to an id that isn't a resident here` : "",
  ].filter((p) => p !== "");
  if (problems.length > 0) warn(`TERRAKIN_STAFF_RESIDENTS: ${problems.join("; ")}.`);
  return residents;
}
