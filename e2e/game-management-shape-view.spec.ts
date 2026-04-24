import { test, expect } from "@playwright/test";
import { navigateToApp, waitForPageLoad } from "./helpers";

test.describe("Game Management shape view", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("supports shape mode with locked bench strip and substitution parity", async ({ page }) => {
    await navigateToApp(page);

    await page.locator("a.nav-item", { hasText: "Games" }).click();
    await waitForPageLoad(page);

    const gameCardCount = await page.locator(".game-card").count();
    test.skip(gameCardCount === 0, "No games available to validate shape view in this environment.");

    await page.locator(".game-card").first().click();
    await waitForPageLoad(page);

    const shapeToggle = page.getByRole("button", { name: "Shape" });
    const listToggle = page.getByRole("button", { name: "List" });
    const onCompletedScreen = await page.getByRole("heading", { name: /play time summary/i }).isVisible().catch(() => false);
    test.skip(onCompletedScreen, "Shape view is out of scope for completed games.");

    await expect(shapeToggle).toBeVisible({ timeout: 10000 });
    await expect(listToggle).toBeVisible({ timeout: 10000 });

    await shapeToggle.click();
    await expect(page.getByText("Locked bench strip")).toBeVisible({ timeout: 10000 });

    const emptyNode = page.getByRole("button", { name: /empty/i }).first();
    if (await emptyNode.isVisible().catch(() => false)) {
      await emptyNode.click();
      const substitutionDialog = page.getByRole("heading", { name: /assign player to position|substitution/i }).first();
      await expect(substitutionDialog).toBeVisible({ timeout: 10000 });
    }

    const assignedNode = page.locator(".lineup-shape-node--assigned .lineup-shape-node__tap-target").first();
    if (await assignedNode.isVisible().catch(() => false)) {
      await assignedNode.click();

      const quickReplaceDialog = page.getByRole("dialog", { name: /quick replace/i });
      const substitutionHeading = page.getByRole("heading", { name: /substitution/i });
      const lineupHeading = page.locator(".lineup-header h2").first();
      const headingText = (await lineupHeading.textContent()) ?? "";
      const isScheduled = /starting lineup/i.test(headingText);
      const isHalftime = /second half lineup/i.test(headingText);

      if (isScheduled || isHalftime) {
        await expect(quickReplaceDialog).toBeVisible({ timeout: 10000 });
        await expect(quickReplaceDialog).toHaveAttribute("aria-modal", "true");
        await expect(substitutionHeading).toHaveCount(0);
      } else {
        await expect(substitutionHeading).toBeVisible({ timeout: 10000 });
        await expect(quickReplaceDialog).toHaveCount(0);
      }
    }
  });

  test("fits narrow viewport and keeps shape controls at least 44x44", async ({ page }) => {
    await navigateToApp(page);

    await page.locator("a.nav-item", { hasText: "Games" }).click();
    await waitForPageLoad(page);

    const gameCardCount = await page.locator(".game-card").count();
    test.skip(gameCardCount === 0, "No games available to validate shape view in this environment.");

    await page.locator(".game-card").first().click();
    await waitForPageLoad(page);

    const onCompletedScreen = await page.getByRole("heading", { name: /play time summary/i }).isVisible().catch(() => false);
    test.skip(onCompletedScreen, "Shape view is out of scope for completed games.");

    const shapeToggle = page.getByRole("button", { name: "Shape" });
    await expect(shapeToggle).toBeVisible({ timeout: 10000 });
    await shapeToggle.click();

    const pitch = page.locator(".lineup-shape-view__pitch");
    await expect(pitch).toBeVisible({ timeout: 10000 });

    const pitchHasHorizontalOverflow = await pitch.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    expect(pitchHasHorizontalOverflow).toBe(false);

    const undersizedTapTargets = await page.locator(".lineup-shape-node__tap-target").evaluateAll((elements) =>
      elements.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44;
      }).length,
    );
    expect(undersizedTapTargets).toBe(0);

    await expect(page.locator(".lineup-shape-node__remove")).toHaveCount(0);
  });

  test("prevents overlap between visible assigned cards on narrow viewport", async ({ page }) => {
    await navigateToApp(page);

    await page.locator("a.nav-item", { hasText: "Games" }).click();
    await waitForPageLoad(page);

    const gameCardCount = await page.locator(".game-card").count();
    test.skip(gameCardCount === 0, "No games available to validate shape view in this environment.");

    await page.locator(".game-card").first().click();
    await waitForPageLoad(page);

    const onCompletedScreen = await page.getByRole("heading", { name: /play time summary/i }).isVisible().catch(() => false);
    test.skip(onCompletedScreen, "Shape view is out of scope for completed games.");

    const shapeToggle = page.getByRole("button", { name: "Shape" });
    await expect(shapeToggle).toBeVisible({ timeout: 10000 });
    await shapeToggle.click();

    const pitch = page.locator(".lineup-shape-view__pitch");
    await expect(pitch).toBeVisible({ timeout: 10000 });

    const assignedCards = page.locator(".lineup-shape-node--assigned .lineup-shape-node__tap-target");
    const assignedRects = await assignedCards.evaluateAll((elements) => {
      return elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const isVisible = rect.width > 0
            && rect.height > 0
            && window.getComputedStyle(element).visibility !== "hidden"
            && window.getComputedStyle(element).display !== "none";

          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            isVisible,
          };
        })
        .filter((rect) => rect.isVisible);
    });

    test.skip(
      assignedRects.length < 2,
      "Not enough visible assigned cards to validate overlap in this environment.",
    );

    const overlapPairs: string[] = [];
    for (let i = 0; i < assignedRects.length; i += 1) {
      const a = assignedRects[i];
      for (let j = i + 1; j < assignedRects.length; j += 1) {
        const b = assignedRects[j];
        const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        if (overlaps) {
          overlapPairs.push(`${i}-${j}`);
        }
      }
    }

    expect(overlapPairs).toEqual([]);
  });
});
