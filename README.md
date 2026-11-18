# Harmony Horticulture Time Tracker

A simple web app for logging billable time and materials, for consultants on their phones and admins at a computer. Built from the Time Tracking App user stories (version 3, November 2026).

**Setting it up:** follow [docs/SETUP.md](docs/SETUP.md). Until then the app runs in demo mode with sample data kept in your browser.

## What it does

**Everyone (consultant or admin)**
- Signs in with their own account (invite-only; after 5 wrong passwords they're sent to reset it)
- Logs time: client search (2+ letters, recent clients first, one-off customers marked), property, date (defaults to today; warns for future dates or more than 7 days back), hours in 0.25 steps with + and − buttons, service (their own QuickBooks services first, then shared ones), description up to 500 characters with a microphone for dictation, a site minimum amount and an origination flag
- Adds materials from the Materials Price List, each in its own unit (tbsp, cup, oz…), or types a new one that's flagged for an admin to review
- Sees their day and week with totals, with weekdays that have no time highlighted
- Edits or deletes their own entries until they go into a QuickBooks file
- Downloads their own time as a branded Excel file

**Admins**
- **Time reports:** all time filtered by date range, person, client, and whether it's in a QuickBooks file yet
- Edit anyone's entry (every change is kept in the entry's history), and unlock entries that are already in a QuickBooks file
- Download: the filtered list, **Time by person** (summary tab plus one tab per person, people with no time show 0), a **client summary** of time and materials (one client, or every client with one tab each), and a **QuickBooks file** in the same columns as the QuickBooks bill sheet (Product/Service, Description, Qty, Customer). Entries go into a QuickBooks file only once, and anything that can't be billed yet is listed on a "Held back" tab
- Invite people and set their role, QuickBooks name and active status
- Manage clients (QuickBooks full names, properties, one-off or recurring), materials (units, prices, retire), services (QuickBooks Product/Service, who it's for, billable or not), and review new materials people typed in
- Update clients and services from QuickBooks export files, and materials from the Materials Price List

All Excel files use the official logo, the four brand colors and Montserrat.

## How it's built

- Plain HTML, CSS and JavaScript: no build step. GitHub Pages serves the files as they are.
- [Supabase](https://supabase.com) for sign-in and the Postgres database. Security rules in the database (not just the screens) make sure consultants only see and change their own time, and can't change it once it's in a QuickBooks file.
- [ExcelJS](https://github.com/exceljs/exceljs) for branded .xlsx files. Both libraries are saved in `vendor/` so the app doesn't depend on other websites.

| File | What's in it |
|---|---|
| `index.html` | The page |
| `css/app.css` | Brand colors, fonts and layout |
| `js/config.js` | Your Supabase address and key (the only file you need to edit) |
| `js/app.js` | The screens |
| `js/store.js` | Talks to the database (or to demo data in the browser) |
| `js/exports.js` | Excel downloads |
| `js/importers.js` | Reads QuickBooks and price list files for the list updates |
| `supabase/01_schema.sql` | Database tables and security rules |
| `supabase/02_seed.sql` | Starting clients, materials and service types |
| `supabase/03_add_technician_role.sql` | Adds the Technician role |
| `supabase/04_quickbooks_lists_and_site_minimum.sql` | One-off customers, site minimum amount, services and materials from your files |
| `supabase/05_fix_access.sql` | Lets signed-in people reach the tables and makes sure there's an admin |
| `harmony_time_tracker.html` | The original prototype, kept for reference |

## Not built yet

- Sending straight into QuickBooks (TT-21 asks for this; for now it's an import file). A direct link needs a QuickBooks developer app and a small server piece.
- Automatic nightly sync of the client list from QuickBooks (TT-05). For now, upload a QuickBooks customer export in Lists > Clients.
- Saving entries with no signal and syncing later (TT-12)
- 6 PM reminders for people with no time logged (TT-23)
- Receipt photos on materials (TT-17)
