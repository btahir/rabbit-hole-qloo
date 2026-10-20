import { test, expect } from "./fixtures";
for (const width of [1440, 390])
  test(`keepsake, instant share preview, recipient and independent fork at ${width}`, async ({
    page,
    browser,
  }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "In the Mood for Love", exact: true })
      .click();
    const doors = page
      .locator(".discovery-doors > li")
      .filter({ visible: true });
    await expect(doors).toHaveCount(3);
    const original = await doors.first().getByRole("heading").innerText();
    await page
      .getByRole("button", { name: /^I know this:/ })
      .filter({ visible: true })
      .first()
      .click();
    await expect(doors.first().getByRole("heading")).not.toHaveText(original);
    await doors
      .first()
      .getByRole("button", { name: /^Add to trail:/ })
      .click();
    await page
      .getByRole("button", { name: "Finish my trail", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page.locator(".keepsake").filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.locator(".story-trail > li").filter({ visible: true }),
    ).toHaveCount(2);
    if (process.env.RABBIT_SHOTS_DIR)
      await page.screenshot({
        path: `${process.env.RABBIT_SHOTS_DIR}/22-short-finish-${width}.png`,
        animations: "disabled",
        fullPage: true,
      });
    await page
      .getByRole("button", { name: "Share this trail", exact: true })
      .filter({ visible: true })
      .click();
    const link = page.getByLabel("Trail link", { exact: true });
    await expect(link).toBeVisible();
    const shareUrl = await link.inputValue();
    await expect(page.locator(".share-preview")).toHaveJSProperty(
      "complete",
      true,
    );
    await expect(page.locator(".share-preview")).not.toHaveJSProperty(
      "naturalWidth",
      0,
    );
    if (process.env.RABBIT_SHOTS_DIR)
      await page.screenshot({
        path: `${process.env.RABBIT_SHOTS_DIR}/23-short-share-${width}.png`,
        animations: "disabled",
      });
    const visitorContext = await browser.newContext({
      viewport: { width, height: width === 1440 ? 900 : 844 },
    });
    const visitor = await visitorContext.newPage();
    await visitor.goto(shareUrl);
    await expect(
      visitor.locator(".keepsake").filter({ visible: true }),
    ).toBeVisible();
    await expect(
      visitor.locator(".story-trail > li").filter({ visible: true }),
    ).toHaveCount(2);
    if (process.env.RABBIT_SHOTS_DIR)
      await visitor.screenshot({
        path: `${process.env.RABBIT_SHOTS_DIR}/24-short-visitor-${width}.png`,
        animations: "disabled",
        fullPage: true,
      });
    const image = await visitor
      .locator('meta[property="og:image"]')
      .getAttribute("content");
    const response = await visitor.request.get(image!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    expect(response.headers()["cache-control"]).toContain("no-store");
    await visitor
      .getByRole("button", { name: "Take a different turn →", exact: true })
      .click();
    await visitor
      .getByRole("button", { name: "Make my version", exact: true })
      .click();
    await expect(visitor).toHaveURL(/\/t\//);
    await expect(
      visitor
        .getByRole("button", { name: "Find the next doors", exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await visitor.goto(shareUrl);
    await expect(
      visitor.locator(".keepsake").filter({ visible: true }),
    ).toBeVisible();
    await expect(
      visitor.locator(".story-trail > li").filter({ visible: true }),
    ).toHaveCount(2);
    await visitorContext.close();
  });
