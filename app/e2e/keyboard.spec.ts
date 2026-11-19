import { test, expect } from '@playwright/test';
import { guard, openApp } from './helpers';

test.describe('F01 keyboard only', () => {
  test('F01-E7 reach the tree with Tab, move with arrows, start a sketch with S', async ({ page }) => {
    const check = guard(page);
    await openApp(page);
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'treeitem');
    }
    expect(reached, 'Tab reaches the feature tree').toBe(true);
    // Move down to "Front plane" and select it
    for (let i = 0; i < 5; i++) {
      const name = await page.evaluate(() => document.activeElement?.textContent ?? '');
      if (name.includes('Front plane')) break;
      await page.keyboard.press('ArrowDown');
    }
    await expect(page.locator(':focus')).toHaveText(/Front plane/);
    await page.keyboard.press(' ');
    await expect(page.getByRole('treeitem', { name: 'Front plane' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('s');
    await expect(page.getByText(/Under-defined|Fully defined/)).toBeVisible();
    check();
  });
});
