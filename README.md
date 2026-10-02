# digital nomads marina

build as is. do not redesign do not add any design or text in the site, make sure the admin and data is set with supabase, do not add text of  lovable supabase in the site. the supabase code tree is already set up so its easy for you to set up database and storage.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://set-sail-project.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/6003d037-f970-40f1-bfea-1f10cb300992).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Partner Dashboard (homepage hero)

The homepage hero at `/` is a partner workspace: a status table of live
projects plus threaded comments with images and smart link chips. Project rows
come from `content/updates.json`; comments live in Supabase (with a Neon
fallback and a localStorage offline mode).

**Full setup, configuration and API reference: [DASHBOARD-README.md](./DASHBOARD-README.md)**

Quick start:

```sh
cp .env.example .env     # then fill in what you have
```

Then run `supabase/migrations/20261002000000_partner_dashboard.sql` in the
Supabase SQL Editor to create the tables and the `comment-images` bucket.
Until that is done the dashboard renders normally and saves comments in the
browser only.
