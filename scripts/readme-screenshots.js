// Run with playwright-cli run-code --filename=scripts/readme-screenshots.js.
// Capture the browser demo only; no desktop IPC or real account data is used.
async (page) => {
  const origin = 'http://127.0.0.1:4318';
  await page.goto(`${origin}/manager.html?demo=1`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.setViewportSize({width:1380,height:1180});
  await page.getByRole('heading',{name:'账号管理',exact:true}).waitFor();
  await page.locator('.account-card').last().waitFor();
  if (await page.evaluate(() => Boolean(window.codexAuth))) throw Error('Screenshots require isolated browser demo');
  const capture = async name => {
    await page.evaluate(() => document.fonts.ready);
    if (page.url().includes('/manager.html')) {
      const overflow = await page.locator('.page-scroll').evaluate(el => Math.max(0,el.scrollHeight-el.clientHeight));
      if (overflow) await page.setViewportSize({width:1380,height:page.viewportSize().height+overflow});
    }
    await page.screenshot({path:`output/playwright/readme-${name}.png`,animations:'disabled'});
  };
  await capture('accounts');
  await page.getByRole('button',{name:'用量概览',exact:true}).click();
  await page.getByRole('heading',{name:'模型用量分布'}).waitFor();
  await capture('statistics');
  await page.getByRole('button',{name:'订阅额度',exact:true}).click();
  await page.getByRole('heading',{name:'订阅额度',exact:true}).waitFor();
  await page.setViewportSize({width:1380,height:1000});
  await capture('quotas');
  await page.getByRole('button',{name:'应用设置',exact:true}).click();
  await page.getByRole('checkbox',{name:'Pro 显示 5 小时额度'}).waitFor();
  await capture('settings');
  await page.goto(`${origin}/meter.html?demo=1`);
  await page.setViewportSize({width:360,height:560});
  await page.locator('#session').filter({hasText:'97%'}).waitFor();
  await capture('meter-weekly');
  await page.getByRole('button',{name:'选择账号',exact:true}).click();
  await page.getByRole('option').filter({hasText:'创作空间'}).click();
  await page.getByRole('button',{name:'切换并重启 Codex',exact:true}).click();
  await page.getByRole('button',{name:'确认切换',exact:true}).click();
  await page.locator('#session').filter({hasText:'62%'}).waitFor();
  await page.locator('#message').waitFor({state:'hidden'});
  await capture('meter-plus');
  await page.getByRole('button',{name:'切换主题'}).click();
  await page.getByRole('button',{name:'选择账号',exact:true}).click();
  await capture('meter-picker');
  console.log('Captured seven README images using synthetic demo data.');
}
