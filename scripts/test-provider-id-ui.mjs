import { chromium } from '../tmp/document-browser-audit/node_modules/playwright-core/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const fixture = JSON.parse(readFileSync('tmp/provider-public-id/ui-fixture.json', 'utf8'));
assert.ok(fixture.email.endsWith('@example.invalid'));
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await page.goto('http://127.0.0.1:3187/login');
  await page.getByLabel('Email', { exact: false }).fill(fixture.email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/admin\//, { timeout: 60000 });
  await page.goto('http://127.0.0.1:3187/admin/drivers');
  await page.getByPlaceholder('Public ID, name, email or phone').fill(fixture.publicId);
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await page.getByText('Driver ID: ' + fixture.publicId, { exact: true }).waitFor();
  await page.getByRole('link', { name: 'View driver' }).click();
  await page.waitForURL('**/admin/drivers/' + fixture.driver);
  await page.getByText('Driver ID: ' + fixture.publicId, { exact: true }).waitFor();
  assert.ok(!(await page.locator('body').innerText()).includes('Driver ' + fixture.driver));
  await page.screenshot({ path: 'tmp/provider-public-id/admin-driver.png', fullPage: true });
  await page.goto('http://127.0.0.1:3187/admin/partners/' + fixture.partner);
  await page.getByText('Partner ID: ' + fixture.publicId, { exact: true }).waitFor();
  await page.screenshot({ path: 'tmp/provider-public-id/admin-partner.png', fullPage: true });
  writeFileSync(
    'tmp/provider-public-id/admin-browser-result.json',
    JSON.stringify(
      {
        status: 'PASS',
        realBackend: true,
        driverSearch: true,
        driverDetail: true,
        partnerDetail: true,
        combinedRoleSameId: true,
        uuidRoutingRetained: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Admin browser: PASS (real login, public-ID search, Driver/Partner details and UUID navigation)',
  );
} finally {
  await browser.close();
}
