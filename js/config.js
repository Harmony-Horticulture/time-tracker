// =====================================================================
// Harmony Horticulture Time Tracker: settings
//
// Paste your two Supabase values here (Supabase > Project Settings > API Keys: the Project URL and the "publishable" key).
// Both are safe to put on a public website: the database security rules
// decide what each signed-in person can see.
//
// Leave them empty to run the app in DEMO MODE. Demo mode keeps sample
// data in your own browser only, so you can click around before the
// database is set up.
// =====================================================================
window.HH_CONFIG = {
  SUPABASE_URL: "https://toqirqxhlisnvggxshxz.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_npyRIEu3nfnKbHHGcfc_Gg_5J3a7HSh", // "publishable" (anon) key

  // Warn when someone picks a date more than this many days back (user story TT-06)
  OLD_DATE_WARNING_DAYS: 7,

  // The separate report-building app, opened from "Build a report" in the menu
  REPORT_BUILDER_URL: "https://harmony-horticulture.github.io/report-builder/",
};
