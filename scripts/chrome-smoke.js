async(page)=>{
  await page.goto('http://127.0.0.1:4318/manager.html?demo=1');
  await page.setViewportSize({width:1340,height:920});
  await page.evaluate(()=>{document.body.classList.add('desktop');document.querySelector('.page-scroll').scrollTop=10000});
  const measure=()=>{const h=document.querySelector('.topbar'),s=document.querySelector('.page-scroll'),r=h.getBoundingClientRect();return {y:r.top,bottom:r.bottom,scrollTop:s.scrollTop,scrollStart:s.getBoundingClientRect().top,rootScroll:window.scrollY,hit:h.contains(document.elementFromPoint(r.left+20,20)),controlsSafe:document.querySelector('.top-right').getBoundingClientRect().right<=innerWidth-138}};
  let m=await page.evaluate(measure);if(!m.scrollTop||m.y!==0||m.scrollStart<m.bottom||m.rootScroll!==0||!m.hit||!m.controlsSafe)throw Error('Caption overlaps content: '+JSON.stringify(m));
  await page.screenshot({path:'output/playwright/titlebar-scrolled.png',animations:'disabled'});
  await page.getByRole('button',{name:'应用设置',exact:true}).click();
  if(await page.locator('.page-scroll').evaluate(el=>el.scrollTop)!==0)throw Error('Navigation retained old scroll');
  await page.setViewportSize({width:860,height:620});
  await page.evaluate(()=>document.querySelector('.page-scroll').scrollTop=10000);
  m=await page.evaluate(measure);if(m.y!==0||!m.controlsSafe||m.scrollStart<m.bottom)throw Error('Small caption unsafe');
  await page.goto('http://127.0.0.1:4318/meter.html?demo=1');await page.setViewportSize({width:360,height:560});
  await page.evaluate(()=>{localStorage.setItem('meter-dark','0');localStorage.setItem('demo-pro-five-hour','0')});await page.reload();
  await page.locator('#session').filter({hasText:'97%'}).waitFor();
  if(await page.locator('.stat-icon svg').count()!==3)throw Error('Missing statistic vectors');
  if(await page.locator('.meter-logo svg').count()!==1)throw Error('Missing logo vector');
  const aligned=await page.locator('.stat-icon').evaluateAll(items=>items.every(e=>{const a=e.getBoundingClientRect(),b=e.querySelector('svg').getBoundingClientRect();return a.width===28&&a.height===28&&Math.abs(a.x+a.width/2-b.x-b.width/2)<1&&Math.abs(a.y+a.height/2-b.y-b.height/2)<1}));if(!aligned)throw Error('Icons are not centered');
  await page.screenshot({path:'output/playwright/meter-icons.png',animations:'disabled'});
  await page.goto('http://127.0.0.1:4318/manager.html?demo=1');await page.setViewportSize({width:1340,height:920});
  console.log('PASS: fixed native caption clearance at large/small widths, separate page scroll, navigation reset, SVG icon alignment.');
}
