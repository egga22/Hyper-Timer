import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, validatePatch, safeAccount } from '../backend/api.mjs';
import { prepareRecords, canonical } from '../backend/migrate.mjs';
import { readFileSync } from 'node:fs';

const row = { user_id:'a', legacy_id:'legacy-a', email_original:'a@example.com', role_original:'Beta Tester', payload:{password:'must-not-leak',Role:'Owner',timers:[{id:'t',paused:true}],Settings:{custom:1},secret:'private'}, revision:1 };
function setup(user = 'a', ready = true) {
  const queries=[];
  const pool={query:async (sql,args)=>{queries.push({sql,args}); if(sql.startsWith('SELECT ready')) return {rows:[{ready}]}; if(sql.startsWith('SELECT *')) return {rows:args[0] === 'a' ? [row]:[]}; if(sql.startsWith('UPDATE')) return {rows:args[0]==='a' && args[2]==='1' ? [{...row,revision:2,payload:{...row.payload,...JSON.parse(args[1])}}]:[]}; return {rows:[]};}};
  const auth={api:{getSession:async ({headers})=>headers.get('Authorization')==='Bearer valid' && user ? {user:{id:user,email:'a@example.com'}}:null},handler:async()=>Response.json({ok:true})};
  return { app:createApp({pool,auth,origins:['https://timer.example']}),queries };
}
const headers={Authorization:'Bearer valid','Content-Type':'application/json','If-Match':'1'};
test('ordinary account updates cannot change roles, credentials, identities or unknown fields',()=>{
  for(const field of ['Role','role','password','email','_id','user_id','revision','__proto__','constructor']) {
    assert.throws(()=>validatePatch(JSON.parse(`{"${field}":"Owner"}`)));
  }
  assert.throws(()=>validatePatch({timers:{}}));
  assert.throws(()=>validatePatch({Settings:[]}));
  assert.throws(()=>validatePatch({last_modified:'not a date'}));
  assert.deepEqual(validatePatch({timers:[]}),{timers:[]});
});
test('responses never expose password, raw payload, auth secret or source metadata',()=>{
  const safe=safeAccount(row);
  assert.equal(safe.Role,'Beta Tester');
  for(const key of ['password','payload','secret','source_digest','user_id']) assert.equal(key in safe,false);
});
test('forged or missing sessions cannot read or write any account',async()=>{
  const {app,queries}=setup();
  for(const method of ['GET','PATCH']) {
    const response=await app.request('/account',{method,headers:{...headers,Authorization:'Bearer forged'},...(method==='PATCH'?{body:'{"timers":[]}'}:{})});
    assert.equal(response.status,401);
  }
  assert.equal(queries.some(q=>q.sql.includes('FROM timer_accounts')||q.sql.startsWith('UPDATE')),false);
});
test('user identity always comes from session; account IDs cannot select another user',async()=>{
  const {app,queries}=setup();
  const response=await app.request('/account?user_id=b&id=b',{headers});
  assert.equal(response.status,200);
  assert.equal((await response.json())._id,'legacy-a');
  assert.equal(queries.at(-1).args[0],'a');
  assert.equal((await app.request('/account/b',{headers})).status,404);
});
test('role injection rejected and stale writes cannot overwrite cloud data',async()=>{
  const {app}=setup();
  assert.equal((await app.request('/account',{method:'PATCH',headers,body:'{"Role":"Owner"}'})).status,400);
  assert.equal((await app.request('/account',{method:'PATCH',headers:{...headers,'If-Match':'0'},body:'{"timers":[]}'})).status,409);
  assert.equal((await app.request('/account',{method:'PATCH',headers:{Authorization:'Bearer valid','Content-Type':'application/json'},body:'{"timers":[]}'})).status,428);
  const response=await app.request('/account',{method:'PATCH',headers,body:'{"timers":[]}'});
  assert.equal(response.status,200); assert.equal((await response.json()).Role,'Beta Tester');
});
test('disallowed origins and unverified migration targets fail closed',async()=>{
  assert.equal((await setup().app.request('/account',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
  assert.equal((await setup('a',false).app.request('/account',{headers})).status,503);
  assert.equal((await setup().app.request('/auth/update-user',{method:'POST',headers,body:'{}'})).status,404);
  assert.equal((await setup().app.request('/auth/sign-up/email',{method:'POST',headers,body:'{}'})).status,503);
});
test('migration retains IDs, exact role spelling, complete nested payload, and original password',()=>{
  const source={_id:'legacy',email:'USER@example.com',password:' x ',Role:'Beta Tester',timers:[{paused:true,sound:'data:audio/wav;base64,abc',triggers:[1]}],Settings:{unknown:'retained'},custom:{nested:[1,2]}};
  const [r]=prepareRecords([source]);
  assert.equal(r.password,' x '); assert.equal(r.role,source.Role); assert.equal(r.originalEmail,source.email); assert.equal(r.id,'legacy');
  const {password,...expected}=source; assert.equal(canonical(r.payload),canonical(expected));
  assert.equal('password' in r.payload,false);
  assert.throws(()=>prepareRecords([source,{...source,_id:'other'}]));
  assert.throws(()=>prepareRecords([]));
});
test('static client has no direct database credentials or password comparison; password change stays optional',()=>{
  const script=readFileSync(new URL('../script.js',import.meta.url),'utf8');
  assert.doesNotMatch(script,/restdb\.io|x-apikey|user\.password\s*!==/);
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<details[^>]+id="settingsPasswordSection">/);
  assert.doesNotMatch(html,/<details[^>]+id="settingsPasswordSection"[^>]*\bopen/);
});
