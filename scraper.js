const { chromium } = require('playwright');

const N8N_WEBHOOK = process.env.N8N_WEBHOOK_URL;

// ─── Vitalité scraper ────────────────────────────────────────────────────────
async function scrapeVitalite(browser) {
  console.log('[Vitalité] Starting scrape...');
  const page = await browser.newPage();
  const jobs = [];

  try {
    await page.goto(
      'https://vitalitenb.itacit.com/itacit-career-ui/postings?CLIENT=73224542677&SID=4&LANGUAGE=en',
      { waitUntil: 'networkidle', timeout: 60000 }
    );

    // Wait for job cards to appear
    await page.waitForSelector('.posting-item, .job-posting, [class*="posting"]', {
      timeout: 30000
    }).catch(() => console.log('[Vitalité] No posting selector found, trying fallback'));

    // Extract all job listings
    const raw = await page.evaluate(() => {
      const items = [];

      // iTacit renders job cards — try multiple selector patterns
      const cards = document.querySelectorAll(
        '.posting-item, .job-card, [class*="posting-list"] li, [class*="job-list"] li, article'
      );

      cards.forEach(card => {
        const titleEl = card.querySelector('h2, h3, h4, .title, [class*="title"], a');
        const locationEl = card.querySelector('[class*="location"], [class*="city"], .location');
        const typeEl = card.querySelector('[class*="type"], [class*="status"], .employment-type');
        const linkEl = card.querySelector('a[href*="posting"]');
        const dateEl = card.querySelector('[class*="date"], time');
        const idMatch = linkEl?.href?.match(/postings\/(\d+)/);

        if (titleEl && titleEl.textContent.trim()) {
          items.push({
            title: titleEl.textContent.trim(),
            location: locationEl?.textContent?.trim() || '',
            employment_type: typeEl?.textContent?.trim() || '',
            url: linkEl?.href || '',
            posting_id: idMatch?.[1] || '',
            posted_date: dateEl?.textContent?.trim() || '',
          });
        }
      });

      return items;
    });

    // Normalise and tag source
    raw.forEach(job => {
      if (job.title) {
        jobs.push({
          job_title_original: job.title,
          employer: 'Vitalité Health Network',
          city: extractCity(job.location),
          province: 'NB',
          employment_type_raw: job.employment_type,
          vacancy_url: job.url || `https://vitalitenb.itacit.com/itacit-career-ui/postings/${job.posting_id}?CLIENT=73224542677&SID=4&LANGUAGE=en`,
          posting_date: job.posted_date,
          source: 'vitalite',
          job_ref: `VIT-${job.posting_id || Date.now()}`,
        });
      }
    });

    console.log(`[Vitalité] Found ${jobs.length} jobs`);
  } catch (err) {
    console.error('[Vitalité] Error:', err.message);
  } finally {
    await page.close();
  }

  return jobs;
}

// ─── Horizon scraper ─────────────────────────────────────────────────────────
async function scrapeHorizon(browser) {
  console.log('[Horizon] Starting scrape...');
  const page = await browser.newPage();
  const jobs = [];

  try {
    await page.goto(
      'https://horizonnb.itacit.com/itacit-career-ui/postings?CLIENT=73224542677&SID=3&LANGUAGE=en',
      { waitUntil: 'networkidle', timeout: 60000 }
    );

    await page.waitForSelector('.posting-item, .job-posting, [class*="posting"]', {
      timeout: 30000
    }).catch(() => console.log('[Horizon] No posting selector found, trying fallback'));

    const raw = await page.evaluate(() => {
      const items = [];
      const cards = document.querySelectorAll(
        '.posting-item, .job-card, [class*="posting-list"] li, [class*="job-list"] li, article'
      );

      cards.forEach(card => {
        const titleEl = card.querySelector('h2, h3, h4, .title, [class*="title"], a');
        const locationEl = card.querySelector('[class*="location"], [class*="city"], .location');
        const typeEl = card.querySelector('[class*="type"], [class*="status"], .employment-type');
        const linkEl = card.querySelector('a[href*="posting"]');
        const dateEl = card.querySelector('[class*="date"], time');
        const idMatch = linkEl?.href?.match(/postings\/(\d+)/);

        if (titleEl && titleEl.textContent.trim()) {
          items.push({
            title: titleEl.textContent.trim(),
            location: locationEl?.textContent?.trim() || '',
            employment_type: typeEl?.textContent?.trim() || '',
            url: linkEl?.href || '',
            posting_id: idMatch?.[1] || '',
            posted_date: dateEl?.textContent?.trim() || '',
          });
        }
      });

      return items;
    });

    raw.forEach(job => {
      if (job.title) {
        jobs.push({
          job_title_original: job.title,
          employer: 'Horizon Health Network',
          city: extractCity(job.location),
          province: 'NB',
          employment_type_raw: job.employment_type,
          vacancy_url: job.url || `https://horizonnb.itacit.com/itacit-career-ui/postings/${job.posting_id}?CLIENT=73224542677&SID=3&LANGUAGE=en`,
          posting_date: job.posted_date,
          source: 'horizon',
          job_ref: `HOR-${job.posting_id || Date.now()}`,
        });
      }
    });

    console.log(`[Horizon] Found ${jobs.length} jobs`);
  } catch (err) {
    console.error('[Horizon] Error:', err.message);
  } finally {
    await page.close();
  }

  return jobs;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function extractCity(locationText) {
  if (!locationText) return 'New Brunswick';
  // iTacit usually shows "City, NB" or just "City"
  const parts = locationText.split(',');
  return parts[0].trim() || 'New Brunswick';
}

// ─── Post to n8n ─────────────────────────────────────────────────────────────
async function postToN8n(jobs) {
  if (!N8N_WEBHOOK) {
    console.error('N8N_WEBHOOK_URL not set');
    return;
  }

  if (jobs.length === 0) {
    console.log('No jobs to post');
    return;
  }

  console.log(`Posting ${jobs.length} jobs to n8n...`);

  const response = await fetch(N8N_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs, scraped_at: new Date().toISOString() }),
  });

  const text = await response.text();
  console.log(`n8n response: ${response.status} ${text}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== NB Health Scraper starting ===');
  console.log(`Time: ${new Date().toISOString()}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    const [vitaliteJobs, horizonJobs] = await Promise.all([
      scrapeVitalite(browser),
      scrapeHorizon(browser),
    ]);

    const allJobs = [...vitaliteJobs, ...horizonJobs];
    console.log(`Total jobs found: ${allJobs.length}`);

    await postToN8n(allJobs);
  } finally {
    await browser.close();
  }

  console.log('=== Scraper complete ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
