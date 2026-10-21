import { test, expect } from '@playwright/test';
import { setupUi } from './helpers/uiFixture';

// Inspect the dialer href only. Never activate an emergency call in automation.
test('safety has its own space while menu and notifications remain clickable', async ({ page }, testInfo) => {
 const state = await setupUi(page, 'CUSTOMER');
 await page.goto('/customer/home');
 const help = page.getByRole('button', { name: 'Спешна помощ на 112', exact: true });
 for (const size of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1280,height:800}]) {
  await page.setViewportSize(size);
  await expect(page.locator('.customer-header')).toBeVisible();
  await expect(help).toBeVisible(); await expect(help).toBeInViewport();
  await expect(page.locator('.customer-header').getByRole('button', { name: /112/ })).toHaveCount(0);
  const bounds = await help.boundingBox(), header = await page.locator('.customer-header').boundingBox(), sheet = await page.locator('.customer-sheet').boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(44); expect(bounds!.height).toBeGreaterThanOrEqual(44);
  const separate = (b: NonNullable<typeof bounds>) => bounds!.x + bounds!.width <= b.x || b.x + b.width <= bounds!.x || bounds!.y + bounds!.height <= b.y || b.y + b.height <= bounds!.y;
  expect(separate(header!)).toBe(true); expect(separate(sheet!)).toBe(true);
  await help.click();
  await expect(page.getByRole('link', { name: 'Обади се на 112', exact: true })).toHaveAttribute('href', 'tel:112');
  await page.keyboard.press('Escape'); await expect(help).toBeFocused();
  if (size.width===390) await page.screenshot({path:testInfo.outputPath('safety-map-mobile.png')});
 }
 await page.getByRole('button', {name:'Известия',exact:true}).click();
 await expect(page.getByRole('dialog', {name:'Известия',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await page.getByRole('button', {name:'Отвори менюто',exact:true}).click();
 await expect(page.getByRole('dialog', {name:'Отвори менюто',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 expect(state.errors).toEqual([]);
});

test('keyboard leaves one reachable safety action on the map and secondary screens', async ({page},testInfo) => {
 const state=await setupUi(page,'CUSTOMER'); await page.setViewportSize({width:390,height:844});
 for(const path of ['/customer/home','/customer/settings']) {
  await page.goto(path);
  await expect(page.getByRole('button',{name:'Спешна помощ на 112',exact:true})).toBeVisible();
  await page.evaluate(()=>{
   Object.defineProperty(window.visualViewport!,'height',{configurable:true,value:340});
   window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  if(path==='/customer/home') await expect(page.locator('.customer-header')).toBeHidden();
  else await expect.poll(async()=>(await page.locator('.emergency-dock').boundingBox())!.y).toBeLessThan(340);
  const help=page.getByRole('button',{name:'Спешна помощ на 112',exact:true});
  await expect(page.locator('.emergency-trigger:visible')).toHaveCount(1);
  const bounds=await help.boundingBox(); expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(340);
  await help.click();await expect(page.getByRole('link',{name:'Обади се на 112',exact:true})).toHaveAttribute('href','tel:112');
  await page.keyboard.press('Escape');
  if(path==='/customer/home') await page.screenshot({path:testInfo.outputPath('safety-with-keyboard.png')});
 }
 expect(state.errors).toEqual([]);
});

test('an unavailable ride history still keeps emergency help reachable',async({page})=>{
 await setupUi(page,'CUSTOMER');
 await page.route('**/rest/v1/taxi_requests*',route=>route.abort());
 await page.goto('/customer/orders');
 await expect(page.getByRole('button',{name:'Спешна помощ на 112',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Спешна помощ на 112',exact:true}).click();
 await expect(page.getByRole('link',{name:'Обади се на 112',exact:true})).toHaveAttribute('href','tel:112');
});
