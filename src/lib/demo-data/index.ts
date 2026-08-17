// Milestone 18 (Demo Data Purge) reduced this barrel to the two
// compatibility bridges that real, persisted data still depends on:
//
//   users.ts     — the colleague directory the working Chat module resolves
//                  conversations against (matched to real profiles by
//                  email). Chat itself is fully Supabase-backed; this list
//                  is routing, not fabricated content. Retired in the
//                  future user-administration milestone.
//   companies.ts — resolves clients.company_legacy_id (persisted on every
//                  existing client) to an employer name for display. The
//                  Settings screen that let you toggle fictitious payroll
//                  flags was removed; this display bridge was NOT.
//   chat.ts      — pure helpers over REAL messages, never fixture data.
//
// The fabricated fixtures that used to live here — activities.ts,
// pending-tasks.ts, reports.ts — were deleted along with the surfaces that
// rendered them. Nothing in this folder invents operational data anymore.
export * from "./users";
export * from "./companies";
export * from "./chat";
