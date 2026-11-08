import { chromium } from "playwright";

const requestedCount = Number.parseInt(process.argv[2] ?? "2", 10);
const windowCount = Number.isFinite(requestedCount) ? Math.min(4, Math.max(1, requestedCount)) : 2;
const screenWidth = 1920;
const screenHeight = 1080;
const columns = windowCount === 1 ? 1 : 2;
const rows = Math.ceil(windowCount / columns);
const windowWidth = Math.floor(screenWidth / columns);
const windowHeight = Math.floor(screenHeight / rows);
const browsers = [];

for (let index = 0; index < windowCount; index += 1) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const browser = await chromium.launch({
    headless: false,
    args: [
      `--window-size=${windowWidth},${windowHeight}`,
      `--window-position=${column * windowWidth},${row * windowHeight}`,
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto("http://localhost:5173");
  } catch (_e) {
    console.log("Dev server not running yet, keeping window open.");
  }
  browsers.push(browser);
}

console.log(`Opened ${windowCount} browser window${windowCount === 1 ? "" : "s"}.`);
await new Promise(() => {});
