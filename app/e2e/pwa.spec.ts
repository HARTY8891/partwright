// Fix 4: the production build installs a service worker and starts offline.
// Needs a production preview server: `npm run build && npx vite preview --port 4173`,
// then `PWA=1 npx playwright test e2e/pwa.spec.ts`.
import { test, expect } from '@playwright/test';

test.skip(!process.env.PWA, 'needs the production preview server (see the top of this file)');
test.use({ baseURL: 'http://localhost:4173' });

test('Fix 4: installable and works offline after the first visit', async ({ page, context }) => {
  await page.goto('/');
  // manifest is linked and valid
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
    return href ? (await fetch(href)).json() : null;
  });
  expect(manifest?.name).toBe('Partwright');
  expect(manifest?.display).toBe('standalone');
  // service worker active and the geometry engine loaded (and so cached)
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 30_000 });
  await expect(page.getByText('Loading the geometry engine')).toBeHidden({ timeout: 60_000 });
  await page.reload(); // let the worker control the page and cache what it fetches
  await expect(page.getByText('Loading the geometry engine')).toBeHidden({ timeout: 60_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('treeitem', { name: 'Front plane' })).toBeVisible();
  await expect(page.getByText('Loading the geometry engine')).toBeHidden({ timeout: 60_000 });
  await expect(page.getByText(/geometry engine failed/)).toHaveCount(0);
  await context.setOffline(false);
});
