/**
 * Plain-words labels for trust and safety (RFC 0006), shared by the Report sheet in the app and the
 * staff queue in the admin app, so both say the same thing.
 */
import type {
  ModerationAction,
  ReportReason,
  Severity,
  TriageAction,
  TriageCategory,
} from "@terrakin/protocol";

/** Each report reason in plain words, in the order the Report sheet lists them. */
export const REPORT_CHOICES: { reason: ReportReason; label: string; hint: string }[] = [
  { reason: "spam", label: "Spam", hint: "Ads, floods, or the same thing again and again" },
  { reason: "scam", label: "Scam", hint: "Asking for money, wallet keys, or passwords" },
  { reason: "hate", label: "Hate", hint: "Slurs, or attacks on who someone is" },
  { reason: "harassment", label: "Harassment", hint: "Bullying, threats, or piling on" },
  { reason: "sexual", label: "Sexual content", hint: "Nudity or sexual talk" },
  { reason: "self_harm", label: "Someone may be at risk", hint: "Talk of hurting themselves" },
  {
    reason: "impersonation",
    label: "Pretending to be someone",
    hint: "Another person, or the Terrakin team",
  },
  { reason: "other", label: "Something else", hint: "Say what in the note" },
];

export const reasonLabel = (reason: string) =>
  REPORT_CHOICES.find((c) => c.reason === reason)?.label ?? reason;

export const CATEGORY_LABELS: Record<TriageCategory, string> = {
  none: "Nothing wrong",
  spam: "Spam",
  scam: "Scam",
  hate: "Hate",
  harassment: "Harassment",
  sexual: "Sexual content",
  minors: "Minors",
  csam: "Suspected CSAM",
  self_harm: "Self-harm",
  impersonation: "Impersonation",
  doxxing: "Private details",
  prompt_injection: "Aimed at AI readers",
  other: "Something else",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const SUGGESTION_LABELS: Record<TriageAction, string> = {
  dismiss: "Dismiss",
  warn: "Dismiss with a warning",
  hide: "Hide",
  suspend: "Suspend",
  escalate: "A person decides",
};

export const ACTION_LABELS: Record<ModerationAction, string> = {
  hide_post: "Hid a post",
  unhide_post: "Unhid a post",
  auto_hide_post: "Hid a post automatically",
  suspend: "Suspended",
  unsuspend: "Ended a suspension",
  dismiss_reports: "Dismissed reports",
  remove_notice: "Took down a notice",
  void_proposal: "Voided a proposal",
  quarantine: "Held back a bio and note",
  release: "Released a bio and note",
  remove_pictures: "Deleted profile pictures",
  remove_listing: "Took down a listing",
  void_bounty: "Cancelled a bounty",
  confirm_bounty: "Confirmed a town bounty or grant",
  reopen_bounty: "Sent a town bounty back",
  remove_display: "Took something off display",
  remove_piece: "Deleted a piece's picture",
};
