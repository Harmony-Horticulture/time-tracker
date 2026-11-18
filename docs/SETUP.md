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

(If you'd rather use your Google Workspace mailbox instead of Resend, that works too with an app password.)

## 8. Sign in and invite your team

1. Open the app and sign in with the email and password from step 3. It asks you to choose your password once.
2. Go to **People**, fill in name, email and role, and click **Send invitation**. They get an email, click the link and choose a password.
3. For each person, fill in their **QuickBooks name** (for example `Robbie Stephens`) so the QuickBooks file uses the right Product/Service.
4. Check **Lists > Clients** and fill in the **QuickBooks customer** name wherever it differs (for example "Adelson Residence" in the app but "Addelson" in QuickBooks).

---

## Good to know

- **Supabase free plan pauses a project after 7 days with no activity.** With daily use this won't happen. If it ever does, click **Restore** in Supabase.
- **Backups:** the free plan has no automatic backups you can restore. Download a "Time by person" file monthly, or move to Supabase Pro ($25/month) for daily backups.
- **Changing the logo, colors or text:** everything lives in this repository, so changes are edits on GitHub (or ask me).
