import { expect, test } from "@playwright/test";

test("server health check", async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBeTruthy();
});
