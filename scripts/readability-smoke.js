async(page)=>{
  await page.goto('http://127.0.0.1:4318/manager.html?demo=1');
  await page.setViewportSize({width:860,height:620});
  for(const name of ['用量概览','订阅额度','应用设置']){
    await page.getByRole('button',{name,exact:true}).click();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if(overflow)throw Error('Horizontal overflow: '+name);
  }
  if(await page.locator('body').evaluate(el=>el.classList.contains('dark')))await page.getByRole('button',{name:'切换明暗',exact:true}).click();
  await page.getByRole('button',{name:'切换明暗',exact:true}).click();
  if(!await page.locator('body').evaluate(el=>el.classList.contains('dark')))throw Error('Dark toggle failed');
  await page.screenshot({path:'output/playwright/readable-dark.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'切换明暗',exact:true}).click();
  await page.setViewportSize({width:1280,height:1000});
  await page.getByRole('button',{name:'账号管理',exact:false}).first().click();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'output/playwright/readable-dashboard.png',fullPage:true,animations:'disabled'});
  console.log('PASS: narrow desktop pages without horizontal overflow; dark and light layouts.');
}
