# BGPD Recreation App — Deployment Guide

This is your staff-facing program management app. Follow these steps once and it will be live
at a permanent web address that works on any phone, tablet, or computer.

Total time: about 20–30 minutes. No coding required.

---

## STEP 1 — Create a Supabase account (free database)

Supabase is a free service that stores your program data so all staff see the same information.

1. Go to **https://supabase.com** and click **Start for free**
2. Sign up with Google or email
3. Click **New project**
4. Name it `bgpd-recreation` — choose any region — set any password (save it somewhere)
5. Wait ~2 minutes for the project to set up

### Create the database tables

Once your project is ready:

1. In the left sidebar, click **SQL Editor**
2. Click **New query**
3. Paste the following SQL and click **Run**:

```sql
create table programs (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  name text not null,
  staff_name text,
  area text,
  season text,
  year text,
  classification text,
  capacity integer default 0,
  enrollment integer default 0,
  revenue numeric default 0,
  expenses numeric default 0,
  waitlist integer default 0,
  trend text,
  nps integer default 0,
  notes text
);

create table cost_records (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  program_id uuid references programs(id) on delete cascade,
  season text,
  service_category text,
  program_type text,
  custom_workload numeric,
  facility_hours numeric default 0,
  revenue numeric default 0,
  personnel numeric default 0,
  commodities numeric default 0,
  contractuals numeric default 0,
  other1 numeric default 0,
  other2 numeric default 0,
  notes text
);

-- Allow public read/write (staff don't need individual logins)
alter table programs enable row level security;
alter table cost_records enable row level security;

create policy "Allow all" on programs for all using (true) with check (true);
create policy "Allow all" on cost_records for all using (true) with check (true);
```

4. You should see "Success. No rows returned."

### Get your Supabase credentials

1. In the left sidebar, click **Project Settings** (gear icon)
2. Click **API**
3. Copy two values — you'll need them in Step 3:
   - **Project URL** (looks like `https://abcxyz.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)

---

## STEP 2 — Create a GitHub account and upload the code

GitHub stores your app code.

1. Go to **https://github.com** and sign up (free)
2. Click the **+** in the top right → **New repository**
3. Name it `bgpd-recreation-app`
4. Set it to **Public**
5. Check **"Add a README file"**
6. Click **Create repository**

### Upload the app files

1. In your new repository, click **Add file** → **Upload files**
2. Upload all the files from the `bgpd-app` folder you received:
   - `package.json`
   - `vite.config.js`
   - `index.html`
   - `tailwind.config.js`
   - `postcss.config.js`
   - The entire `src/` folder (App.jsx, main.jsx, index.css, supabase.js)
   - The entire `public/` folder (manifest.json)
3. Click **Commit changes**

---

## STEP 3 — Deploy on Vercel (free hosting)

Vercel takes your code from GitHub and makes it live on the web.

1. Go to **https://vercel.com** and click **Sign Up**
2. Choose **Continue with GitHub** — this connects them automatically
3. Click **Add New Project**
4. Find and select `bgpd-recreation-app` from your repository list
5. Click **Import**
6. Under **Framework Preset**, select **Vite**
7. Open the **Environment Variables** section and add these two:

   | Name | Value |
   |------|-------|
   | `VITE_SUPABASE_URL` | your Project URL from Step 1 |
   | `VITE_SUPABASE_ANON_KEY` | your anon public key from Step 1 |

8. Click **Deploy**
9. Wait ~2 minutes — Vercel will give you a URL like `bgpd-recreation-app.vercel.app`

That's your app. Share that link with your whole team.

---

## STEP 4 — Set yourself up as manager

Open the app at your Vercel URL. When it asks for your name, enter your name exactly.

Then open the file `src/App.jsx` and find this line near the bottom:

```js
const MANAGER_NAMES = ["admin", "manager"];
```

Add your name (lowercase) to that list, for example:

```js
const MANAGER_NAMES = ["admin", "manager", "sarah johnson"];
```

Save the file, commit it to GitHub, and Vercel will automatically redeploy within ~1 minute.
From then on, when you open the app with your name, you'll see the manager view with staff filters.

---

## STEP 5 — Add to home screen (phone)

Share the Vercel URL with staff and have everyone do this on their phone:

**iPhone:**
1. Open the URL in Safari
2. Tap the Share button (box with arrow) at the bottom
3. Scroll down and tap **Add to Home Screen**
4. Tap **Add** — it will appear as an app icon

**Android:**
1. Open the URL in Chrome
2. Tap the three-dot menu in the top right
3. Tap **Add to Home screen**
4. Tap **Add**

---

## Notes

- All data is shared — everyone sees all programs
- Staff are identified by the name they enter on first use (stored on their device)
- Staff can only edit programs they entered; you can edit all programs as manager
- The ⇄ button in the top right lets anyone switch their name if needed
- Data is stored securely in Supabase — free tier supports up to 500MB and 50,000 rows
