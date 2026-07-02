import { test, expect } from "@playwright/test";

test.describe("{{FEATURE_NAME}} acceptance", () => {
  test("AC-001 {{TITLE}}", async ({ page }) => {
    const requests: Array<{ url: string; method: string; postData: string | null }> = [];

    page.on("request", request => {
      requests.push({
        url: request.url(),
        method: request.method(),
        postData: request.postData()
      });
    });

    await page.goto("{{ROUTE}}");
    await page.getByTestId("{{TEST_ID}}").click();

    await expect(page.getByTestId("{{EXPECTED_TEST_ID}}")).toBeVisible();
    expect(requests.some(request => request.url.includes("{{API_PATH}}"))).toBe(false);
  });
});
