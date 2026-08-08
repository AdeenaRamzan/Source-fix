# SourceFix Command Center

A complete Next.js App Router frontend for the SourceFix supplier-shortlisting workflow.

## What is included

- A simpler five-step flow: Requirements → Baseline → Agent run → Shortlist → Decision ledger
- Direct integration with:
  - `POST /api/baseline`
  - `POST /api/analyze`
  - `POST /api/analyze/stream`
- Next.js server-side proxy routes so the browser does not need CORS configuration
- Transparent API connection errors
- Explicit demo-data buttons for trying the UI before the backend is available
- Responsive layout for desktop and mobile
- Inline supplier constellation and machined enclosure graphic
- Exact SourceFix field names and response shapes from the supplied brief

## Run locally

1. Copy `.env.example` to `.env.local`.
2. Set `SOURCEFIX_BACKEND_URL` to the SourceFix backend URL. The default is `http://localhost:8000`.
3. Install dependencies with `npm install` or `pnpm install`.
4. Start the app with `npm run dev` or `pnpm dev`.
5. Open `http://localhost:3000`.

The app uses the demo-data buttons if the API is not available. Demo mode is labeled clearly and never silently replaces a failed API request.

The included `.env.example` is intentionally safe to commit. Put your actual backend URL in `.env.local`.

## Build for production

```bash
pnpm build
pnpm start
```

## Main files

- `app/page.tsx` — interactive SourceFix workflow
- `app/globals.css` — paper/ink visual system and responsive layout
- `lib/sourcefix.ts` — product requirements, response types, and explicit demo data
- `app/api/sourcefix/*` — server-side proxy routes for the SourceFix API