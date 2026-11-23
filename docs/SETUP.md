# Setting up the Time Tracker

This takes about 30 minutes, once. You don't need to write any code. Everything below is free to start.

| Piece | What it does | Service | Cost |
|---|---|---|---|
| Website | Shows the app at a web address | GitHub Pages (already part of GitHub) | Free |
| Database and sign-in | Stores time entries, handles passwords and invitations | Supabase | Free plan; Pro is $25/month if you outgrow it |
| Email | Sends invitations and password reset emails | Resend (connected to Supabase) | Free up to 3,000 emails/month |

> **Try it first:** before any setup, the app runs in **demo mode** with sample data kept only in your browser. Once step 4 is done you can open it and click around.

---

## 1. Create the database (Supabase)

1. Go to [supabase.com](https://supabase.com) and sign up (you can use "Continue with GitHub").
2. Click **New project**. Name it `harmony-time`, create a strong database password (save it in your password manager), pick the region closest to you (for Arizona: **West US**), and keep the **Free** plan.
3. Wait a minute or two while it sets up.

## 2. Load the tables and starting lists

1. In your Supabase project, click **SQL Editor** in the left menu, then **New query**.
2. Open [`supabase/01_schema.sql`](../supabase/01_schema.sql) here on GitHub, click the **Copy raw file** button, paste it into the SQL Editor and click **Run**. You should see "Success. No rows returned."
3. Click **New query** again and do the same with [`supabase/02_seed.sql`](../supabase/02_seed.sql). This loads your 347 clients, 34 materials and 3 service types from the prototype.
4. If you ran `01_schema.sql` before November 18, 2026, also run [`supabase/03_add_technician_role.sql`](../supabase/03_add_technician_role.sql). It adds the Technician role. Running it when you don't need it does no harm.
5. Run [`supabase/04_quickbooks_lists_and_site_minimum.sql`](../supabase/04_quickbooks_lists_and_site_minimum.sql) the same way. It adds the one-off marker for customers and the site minimum amount, and loads your services from QuickBooks and your materials from the Materials Price List (with their units). Running it twice does no harm.
6. Run [`supabase/05_fix_access.sql`](../supabase/05_fix_access.sql) the same way. It lets signed-in people reach the tables (newer Supabase projects don't do this automatically) and makes sure the first person to sign up is an admin. Without it, signing in shows "You don't have permission to do that."

## 3. Create your own admin login

The first person added becomes the admin automatically. After that, only invited people can join.

1. In Supabase, go to **Authentication > Users > Add user > Create new user**.
2. Enter your work email and a password, tick **Auto Confirm User**, and click **Create user**.

## 4. Put the app online (GitHub Pages)

1. In this GitHub repository, click **Settings > Pages**.
2. Under **Build and deployment**, set Source to **Deploy from a branch**, Branch to **main** and folder to **/ (root)**, then **Save**.
3. After a minute the page shows your web address, something like `https://harmony-horticulture.github.io/time-tracker/`. Open it: you'll see the app in demo mode.

## 5. Connect the app to your database

1. In Supabase, go to **Project Settings > API** (or **Data API**). Copy the **Project URL** and the **anon public** key.
2. In GitHub, open [`js/config.js`](../js/config.js), click the pencil icon to edit, and paste the two values between the quotes:
   ```js
   SUPABASE_URL: "https://abcdefghijk.supabase.co",
   SUPABASE_ANON_KEY: "eyJhbGciOi...",
   ```
3. Click **Commit changes**. In a minute the website updates.

The anon key is designed to be public. The database rules only let each signed-in person see what their role allows.

## 6. Tell Supabase your web address

1. In Supabase, go to **Authentication > URL Configuration**.
2. Set **Site URL** to your GitHub Pages address from step 4.
3. Under **Redirect URLs**, click **Add URL** and add the same address.

This makes invitation and password reset links open your app.

Leave **Authentication > Sign In / Providers > Allow new users to sign up** turned on. The app needs it to send invitations, and the database itself turns away anyone who wasn't invited.

## 7. Set up email so invitations reach people

Supabase's built-in email only sends to members of your Supabase team and only a few per hour, so invitations to consultants won't arrive until you connect an email service.

1. Sign up at [resend.com](https://resend.com) (free plan).
2. Add your domain `harmonyhorticulture.com` under **Domains** and add the DNS records it shows you wherever your domain is managed (often Google Workspace, GoDaddy or Squarespace). If you'd like, send me a screenshot of that screen and I'll tell you exactly what to enter.
3. Create an **API key** in Resend.
4. In Supabase, go to **Authentication > Emails > SMTP Settings**, turn on **Custom SMTP** and enter:
   - Sender email: `timetracker@harmonyhorticulture.com` (or any address on your domain)
   - Sender name: `Harmony Horticulture`
   - Host: `smtp.resend.com`, Port: `465`
   - Username: `resend`, Password: your Resend API key

**Using your Google Workspace mailbox instead of Resend:** turn on 2-Step Verification for the sending account, create an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), then in the same Supabase screen enter Host `smtp.gmail.com`, Port `465`, Username your full Google Workspace email address, and Password the 16-letter app password. The sender email must be that address (or an alias of it).

## 8. Sign in and invite your team

1. Open the app and sign in with the email and password from step 3. It asks you to choose your password once.
2. Go to **People**, fill in name, email and role, and click **Send invitation**. They get an email, click the link and choose a password. Each person signs in with their own email and password, and their role decides what they see:
   - **Consultant** (Robbie, Kristen) and **Technician** (Stephanie): log time and see only their own time.
   - **Admin** (Krista, Kasey): everything above, plus everyone's time, downloads, people and lists.
3. For each person, fill in their **QuickBooks name** (for example `Robbie Stephens`) so the QuickBooks file uses the right Product/Service.
4. Load your customers: in QuickBooks, go to **Sales > Customers**, click the export icon and choose **Export to Excel**. In the app, go to **Lists > Clients > Update from QuickBooks** and pick that file. Customers are matched on their QuickBooks **full name**, so two customers with the same short name stay separate. Tick **One-off** on any customer who isn't recurring.

## 9. Turn on password resets for admins (Who has access)

The **People** page has a **Who has access** list showing everyone who can sign in, their role and when they last signed in, with a **Reset password** button. Reset gives that person a temporary password, shown once to the admin, and the app makes them choose their own password the next time they sign in. Passwords are stored scrambled, so nobody can look up someone's current password; a reset is how you get someone back in.

It needs one small server function in Supabase, set up once:

1. In Supabase, open **SQL Editor > New query**, paste [`supabase/06_admin_users.sql`](../supabase/06_admin_users.sql) and click **Run**. (It lets the function sign the person out of any devices they're still signed in on.)
2. Go to **Edge Functions > Deploy a new function > Via Editor**, name it `admin-users`, paste [`supabase/functions/admin-users/index.ts`](../supabase/functions/admin-users/index.ts) and click **Deploy**. Leave **Verify JWT** on. There are no secrets to add.

Only active admins can use it. The function checks who's asking before it does anything, and the key that can change passwords stays inside Supabase.

---

## Put the app on your phone

The app installs from the website, with no App Store needed. Send people the app's web address, then:

- **iPhone (Safari):** open the address, tap the **Share** button (the square with an arrow), scroll down and tap **Add to Home Screen**, then **Add**.
- **Android (Chrome):** open the address, tap the **⋮** menu, then **Add to Home screen** or **Install app**, then **Install**.

A green Harmony icon called **Time Tracker** appears on the home screen. It opens full screen like a normal app and stays signed in. New versions show up automatically after you merge changes on GitHub, the next time the app is opened with signal.

## Good to know

- **Updating your lists later:** in **Lists**, each tab has an update button. **Services:** export Products and Services from QuickBooks (Sales > Products and services > Export) and upload it. Items with a person's name in them (like "Robbie Stephens Consulting") are offered only to that person; everything else is offered to everyone. **Materials:** download the Materials Price List Google Sheet as .xlsx or .csv (File > Download) and upload it; each material keeps the unit shown in the sheet. **Customers:** see step 8.4.
- **No approval step:** time can be changed by the person who logged it until it goes into a QuickBooks file. Then it's locked. If something needs fixing after that, an admin can select it in **Time reports** and click **Unlock**, and it goes into the next QuickBooks file again (so fix it in QuickBooks too).
- **Browser tab icon:** the icon switches between the light and dark logo to match the browser's theme in Chrome, Edge and Firefox. Safari shows one icon and may not switch.

- **Supabase free plan pauses a project after 7 days with no activity.** With daily use this won't happen. If it ever does, click **Restore** in Supabase.
- **Backups:** the free plan has no automatic backups you can restore. Download a "Time by person" file monthly, or move to Supabase Pro ($25/month) for daily backups.
- **Changing the logo, colors or text:** everything lives in this repository, so changes are edits on GitHub (or ask me).
