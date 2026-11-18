// =====================================================================
// Harmony Horticulture Time Tracker: settings
//
// Paste your two Supabase values here (Supabase > Project Settings > API).
// Both are safe to put on a public website: the database security rules
// decide what each signed-in person can see.
//
// Leave them empty to run the app in DEMO MODE. Demo mode keeps sample
// data in your own browser only, so you can click around before the
// database is set up.
// =====================================================================
window.HH_CONFIG = {
  SUPABASE_URL: "",       // looks like https://abcdefghijk.supabase.co
  SUPABASE_ANON_KEY: "",  // the long "anon public" key

  // Warn when someone picks a date more than this many days back (user story TT-06)
  OLD_DATE_WARNING_DAYS: 7,
};
