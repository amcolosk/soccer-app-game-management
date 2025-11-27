import { Page } from '@playwright/test';

/**
 * Helper functions for E2E tests
 */

/**
 * Wait for navigation and any loading states to complete
 */
export async function waitForPageLoad(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500); // Brief pause for any animations
}

/**
 * Fill input and wait for React to update
 */
export async function fillInput(page: Page, selector: string, value: string) {
  await page.fill(selector, value);
  await page.waitForTimeout(100);
}

/**
 * Click button and wait for action to complete
 */
export async function clickButton(page: Page, text: string) {
  await page.getByRole('button', { name: text }).click();
  await page.waitForTimeout(300);
}

/**
 * Click button by text content (more flexible)
 */
export async function clickButtonByText(page: Page, text: string | RegExp) {
  await page.getByRole('button', { name: text }).click();
  await page.waitForTimeout(300);
}

/**
 * Select option from dropdown
 */
export async function selectOption(page: Page, selector: string, value: string) {
  await page.selectOption(selector, value);
  await page.waitForTimeout(200);
}

/**
 * Wait for element to be visible
 */
export async function waitForElement(page: Page, selector: string) {
  await page.waitForSelector(selector, { state: 'visible' });
}

/**
 * Get text content of element
 */
export async function getTextContent(page: Page, selector: string): Promise<string> {
  const element = await page.locator(selector);
  return (await element.textContent()) || '';
}

/**
 * Format time for display (MM:SS)
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Parse time from display format (MM:SS) to seconds
 */
export function parseTime(timeString: string): number {
  const [mins, secs] = timeString.split(':').map(Number);
  return mins * 60 + secs;
}
