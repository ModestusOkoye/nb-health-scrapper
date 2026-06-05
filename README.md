[README.md](https://github.com/user-attachments/files/28653253/README.md)
# NB Health Scraper

Playwright scraper for Vitalité and Horizon Health Network job postings.
Runs headlessly, scrapes all allied health jobs, and posts them to n8n for matching and alerting.

## Environment Variables

Set these in Railway:

| Variable | Value |
|---|---|
| `N8N_WEBHOOK_URL` | Your n8n webhook URL for receiving scraped jobs |

## How it works

1. Launches headless Chromium via Playwright
2. Scrapes Vitalité Health Network iTacit careers portal
3. Scrapes Horizon Health Network iTacit careers portal
4. POSTs all jobs as JSON to the n8n webhook
5. n8n runs matching logic and sends Telegram alerts for strong matches

## Local development

```bash
npm install
npx playwright install chromium
N8N_WEBHOOK_URL=https://your-n8n-webhook node scraper.js
```

## Deployment

Push to GitHub, connect repo to Railway, set the `N8N_WEBHOOK_URL` environment variable.
Railway uses the Dockerfile to build and run the scraper.

To run on a schedule, use Railway's cron job feature:
- Go to your service settings in Railway
- Add a cron schedule: `0 */6 * * *` (every 6 hours)
