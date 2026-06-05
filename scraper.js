const { chromium } = require('playwright');

const N8N_WEBHOOK = process.env.N8N_WEBHOOK_URL;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const CITY_PREFIXES = ['Fredericton', 'Moncton', 'Saint John', 'Bathurst', 'Miramichi', 'Edmundston', 'Campbellton', 'Caraquet', 'Tracadie', 'Shippagan'];

function cleanTitle(rawTitle) {
  // iTacit format: "CityName Job Title_Category Type City, NB"
  // Step 1: strip everything after underscore
  let t = (rawTitle || '').split('_')[0].trim();
  // Step 2: strip leading city prefix
  for (const city of CITY_PREFIXES) {
    if (t.startsWith(city + ' ')) {
      t = t.slice(city.length + 1).trim();
      break;
    }
  }
  return t;
}

function extractCity(rawTitle, locationField) {
  // Try location field first
  if (locationField && locationField.trim()) {
    const city = locationField.split(',')[0].trim();
    if (city.length > 1) return city;
  }
  // Fall back to title prefix
  for (const city of CITY_PREFIXES) {
    if ((rawTitle || '').startsWith(city)) return city;
  }
  return 'New Brunswick';
}

function extractEmploymentType(rawTitle) {
  const t = (rawTitle || '').toLowerCase();
  if (t.includes('permanent full time') || t.includes('permanent full-time')) return 'Permanent full-time';
  if (t.includes('permanent part time') || t.includes('permanent part-time')) return 'Permanent part-time';
  if (t.includes('temporary full time') || t.includes('temporary full-time')) return 'Temporary full-time';
  if (t.includes('temporary part time') || t.includes('temporary part-time')) return 'Temporary part-time';
  if (t.includes('casual')) return 'Casual';
  return '';
}

// ─── Generic iTacit scraper ───────────────────────────────────────────────────
async function scrapeITacit(browser, url, employer, prefix) {
  console.log(`[${employer}] Starting scrape...`);
  const page = await browser.newPage();
  const jobs = [];

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

    await page.waitForSelector(
      '.posting-item, .job-posting, [class*="posting"], li[class*="job"], article',
      { timeout: 30000 }
    ).catch(() => console.log(`[${employer}] Selector timeout — trying anyway`));

    const raw = await page.evaluate(() => {
      const items = [];
      const cards = document.querySelectorAll(
        '.posting-item, .job-card, [class*="posting-list"] li, [class*="job-list"] li, article, li'
      );
      cards.forEach(card => {
        const titleEl = card.querySelector('h2, h3, h4, .title, [class*="title"], a');
        const locationEl = card.querySelector('[class*="location"], [class*="city"], .location');
        const typeEl = card.querySelector('[class*="type"], [class*="status"], .employment-type');
        const linkEl = card.querySelector('a[href*="posting"]');
        const dateEl = card.querySelector('[class*="date"], time');
        const idMatch = linkEl?.href?.match(/postings\/(\d+)/);
        const text = titleEl?.textContent?.trim();
        if (text && text.length > 5) {
          items.push({
            title: text,
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

    const baseUrl = url.split('/postings')[0];
    raw.forEach(job => {
      if (!job.title || job.title.length < 5) return;
      const cleanedTitle = cleanTitle(job.title);
      if (!cleanedTitle) return;
      const city = extractCity(job.title, job.location);
      const empType = job.employment_type || extractEmploymentType(job.title);
      const postingId = job.posting_id || String(Date.now());
      jobs.push({
        job_title_original: cleanedTitle,
        employer,
        city,
        province: 'NB',
        employment_type_raw: empType,
        vacancy_url: job.url || `${baseUrl}/postings/${postingId}`,
        posting_date: job.posted_date || '',
        source: prefix.toLowerCase(),
        job_ref: `${prefix}-${postingId}`,
      });
    });

    console.log(`[${employer}] Found ${jobs.length} jobs`);
  } catch (err) {
    console.error(`[${employer}] Error:`, err.message);
  } finally {
    await page.close();
  }
  return jobs;
}

// ─── Post to n8n ─────────────────────────────────────────────────────────────
async function postToN8n(jobs) {
  if (!N8N_WEBHOOK) { console.error('N8N_WEBHOOK_URL not set'); return; }
  if (jobs.length === 0) { console.log('No jobs to post'); return; }
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
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const [vitaliteJobs, horizonJobs] = await Promise.all([
      scrapeITacit(browser,
        'https://vitalitenb.itacit.com/itacit-career-ui/postings?CLIENT=73224542677&SID=4&LANGUAGE=en',
        'Vitalité Health Network', 'VIT'),
      scrapeITacit(browser,
        'https://horizonnb.itacit.com/itacit-career-ui/postings?CLIENT=73224542677&SID=3&LANGUAGE=en',
        'Horizon Health Network', 'HOR'),
    ]);

    const allJobs = [...vitaliteJobs, ...horizonJobs];
    console.log(`Total jobs found: ${allJobs.length}`);
    if (allJobs.length > 0) {
      console.log('Sample titles:');
      allJobs.slice(0, 5).forEach(j => console.log(' -', j.job_title_original, '|', j.city, '|', j.employment_type_raw));
    }
    await postToN8n(allJobs);
  } finally {
    await browser.close();
  }
  console.log('=== Scraper complete ===');
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
