# DMM workshops manpower plan

Web app that compares the man-hours needed for the planned exams (workload × standard hours from the time study) with the productive man-hours the roster can give, for each DMM workshop (Wagon Maintenance, 10-Year Overhaul, Loco).

- Live site: GitHub Pages from the `gh-pages` branch (`index.html`).
- Back end: Supabase (Postgres + Auth + row level security). The page only holds the public publishable key; all data is protected by per-workshop access rules and needs a sign-in.

## Change the app
Edit the files in `src/`, then rebuild the single-file page:

```
npm install
python3 build.py      # writes dist/index.html
cp dist/index.html index.html
```
