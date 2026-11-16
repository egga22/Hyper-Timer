const { chromium }=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try {
  const page=await browser.newPage({serviceWorkers:'block'}); const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='api.test' || (process.env.REAL_API_URL && url.hostname === new URL(process.env.REAL_API_URL).hostname)) {
    requests.push({path:url.pathname,body:route.request().postDataJSON()});
    if(process.env.REAL_API_URL) return route.continue();
    const cors={'access-control-allow-origin':'https://hypertimer.test','access-control-allow-headers':'authorization,content-type,if-match','access-control-expose-headers':'set-auth-token'};
    if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    if(url.pathname==='/auth/sign-in/email') return route.fulfill({json:{},headers:{...cors,'set-auth-token':'fixture-session'}});
    if(url.pathname==='/auth/change-password') return route.fulfill({json:{},headers:cors});
    if(url.pathname==='/account') return route.fulfill({json:{_id:'legacy-fixture',email:'fixture@example.test',Role:'Beta Tester',timers:[],revision:'1'},headers:cors});
   }
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
   if(!['index.html','script.js','style.css','cloud.js','cloud-config.js','sw.js'].includes(file)) return route.fulfill({status:404,body:''});
   let body=fs.readFileSync(file,'utf8'); if(file==='cloud-config.js')body="window.HYPER_TIMER_API_URL="+JSON.stringify(process.env.REAL_API_URL || "https://api.test")+";";
   return route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});
  });
  page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));
  await page.goto('https://hypertimer.test');
  await page.locator('#settingsBtn').click(); await page.locator('#settingsLoginBtn').click();
  await page.locator('#auth_email').fill(process.env.REAL_API_URL?'beta@example.test':'fixture@example.test'); await page.locator('#auth_password').fill(process.env.REAL_API_URL?'beta-password':'original-password'); await page.locator('#authSubmitBtn').click();
  await page.waitForFunction(()=>!document.querySelector('#authDialog').open && !document.querySelector('#settingsSyncBtn').disabled);
  await page.locator('#settingsBtn').click();
  await page.reload({waitUntil:'commit'});
  await page.waitForFunction(()=>!!window.HyperTimerCloud && !!document.querySelector('#settingsRoleDisplay'));
  await page.waitForFunction(()=>document.querySelector('#settingsRoleDisplay').textContent.includes('Beta Tester'));
  await page.locator('#settingsBtn').click();
  const details=page.locator('#settingsPasswordSection'); assert.equal(await details.getAttribute('open'),null);
  await details.locator('summary').click();
  await page.locator('#settingsCurrentPassword').fill(process.env.REAL_API_URL?'beta-password':'original-password');
  await page.locator('#settingsNewPassword').fill('new-password'); await page.locator('#settingsConfirmPassword').fill('wrong');
  await page.locator('#settingsPasswordSave').click();
  assert.equal(requests.filter(r=>r.path==='/auth/change-password').length,0);
  await page.locator('#settingsConfirmPassword').fill('new-password'); await page.locator('#settingsPasswordSave').click();
  await page.waitForFunction(()=>document.querySelector('#settingsPasswordStatus').textContent.includes('Password changed'));
  assert.equal(await page.locator('#settingsCurrentPassword').inputValue(),'');
  assert.equal(requests.filter(r=>r.path==='/auth/change-password').length,1);
  assert.equal(requests.find(r=>r.path==='/auth/change-password').body.revokeOtherSessions,true);
  assert.deepEqual(errors,[]);
  if(process.env.REAL_API_URL) await page.evaluate(()=>window.HyperTimerCloud.changePassword('new-password','beta-password'));
  console.log('PASS optional password UI: no automatic opening, mismatch blocked, change saved, inputs cleared, no browser errors. Backend: '+(process.env.REAL_API_URL?'deployed synthetic integration':'mocked'));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
