// Shared formatting helpers and status vocabulary.

// fmtHours — minutes → "12.3h"
export const fmtHours = (m) => `${(m / 60).toFixed(1)}h`;

// fmtScore — strip trailing zeros: 3.25, 3.5, 3.75, 4, 4.5 …
export const fmtScore = (s) => (s ? parseFloat(s.toFixed(2)).toString() : "0");

// Canonical rating statuses, used by filters, badges, and the rate modal.
export const STATUSES = ["played", "playing", "backlog", "wishlist", "dropped"];
