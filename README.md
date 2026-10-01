# Package Calculator (monday board view)

Price-generating creator package calculator for the sales team. It runs as the
**Package Calculator** board view in the monday app **Master**, is hosted on
Railway, saves everything to Supabase (project *Team*) and reads/writes deals in
Pipedrive.

The logic follows *Creator Package Calculator: Logic Spec* (Oct 2026).

## Sales flow

1. **Pick the deal.** Search open Pipedrive deals, or create one (organisation
   search, or a new organisation) from the view.
2. **Build packages.** For the deal, create as many options as needed:
   - *Budget → package*: client budget in, recommended creators per size out.
   - *Package → price*: creators per size in, price to quote out.
   Market, niche, currency and paid media are prefilled from the Pipedrive deal
   and organisation where set. Results recalculate as you type.
3. **Approve one.** Approving writes the price, projected margin, number of
   influencers, paid media and brand uplift spend to the Pipedrive deal and adds
   a note with the package. An approved package can still be adjusted (creators
   by hand, agreed price); saving it re-syncs Pipedrive.
4. **Download the slide.** One client-facing .pptx slide per package: price,
   creators by size, videos, views and reach we promise, cost per 1,000 views,
   boosted views as a separate line. No fees or margin.

## What is stored in Supabase

All tables are prefixed `pc_`, have RLS on with no policies, and are only used
by the server with the service role key.

| Table | One row per | Holds |
| --- | --- | --- |
| `pc_proposals` | Pipedrive deal being priced | deal id/title, organisation, currency, status (draft/approved/…), approved package, who created it in monday |
| `pc_packages` | package option | name, mode, all form inputs (`inputs`), the full calculator output (`result`, client + internal), and reporting columns: price, views/reach promised, CPM, creators, videos, gifted, boosted views, expected views, creator money and allocation, expected margin, agreed price and real margin, approval, version, who/when |
| `pc_package_lines` | size band in a package | creators, videos each, package cost, first offer and max fee per video, target views per video, confidence and fallback level used |
| `pc_slides` | slide generated | package, file name, who, when |
| `pc_events` | action | audit trail: created, updated, approved, Pipedrive sync (and failures), slide generated, settings changed, rates rebuilt |
| `pc_settings` | — (one row) | section 6 settings, editable in the app |
| `pc_rate_builds` | rate table rebuild | parameters, counts, multi-video factors |
| `pc_rate_archetypes` | archetype × fallback level | records, confidence, P50/P65 cost per video (GBP), P25/P50/P75 views per video |
| `pc_rate_flags` | excluded outlier booking | booking id, reason, views, followers |

Packages keep the `rate_build_id` they were priced on, so old quotes stay
explainable after the rates are rebuilt.

## Rate table

Built from `creator_bookings` (harvested from the Monday client boards and the
payments board) joined to `campaigns` on `campaign_number = pd_deal_id`:

- campaigns of the account owners in *Settings → Rate table* (default: Ritchie, team id 9)
- kept/dropped board groups by the regexes in settings (spec section 3)
- size band from followers on the booking's platform; market from the creator's location; niche = the campaign's wide niche
- outliers (views above 5× followers or above 10M) excluded and listed in `pc_rate_flags`
- cost per video = fee in GBP ÷ videos booked (paid creators only)

Rebuild from *Settings* after changing those settings or when new campaigns land.
The server builds it once on first start if none exists.

## Run locally

```bash
cp .env.example .env   # fill in, set DEV_AUTH_BYPASS=1
npm install
node --env-file=.env server/index.js   # API on :8080
npx vite                               # UI on :5173
npm test
```

## Deploy

Railway builds with `npm run build` and starts `npm start` (see `railway.json`).
Required variables are listed in `.env.example`. The monday feature's URL is the
Railway domain.
