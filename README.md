This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Bring your own Gemini API key

Transcription and smart spelling call Google's Gemini API with **your own key**:

1. Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   (free tier allows 25 transcription requests/day; a paid-tier key is recommended).
2. Open the app, go to **Settings → Your Gemini API key**, paste it and press **Save**.
   Use **Test** to verify it before captioning.
3. The key is stored in your browser's `localStorage` and sent with each request to
   this app's API routes, which forward it to Google. It is never written to disk, a
   database or the server logs.

The server ships no shared/fallback key, so spend and rate limits belong to each
visitor's own Google account. `GEMINI_API_KEY` in `.env` is only read by the
benchmark and the optional real e2e test (`E2E_REAL=1`).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
