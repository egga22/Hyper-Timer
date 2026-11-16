import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { hashPassword } from 'better-auth/crypto';
import { createAuth } from '../backend/auth.mjs';
import { createApp } from '../backend/api.mjs';

// Explicitly opt in against the synthetic-only security-integration branch.
test('real Postgres auth: unchanged short legacy password, isolation, optional password change, revocation', { skip: process.env.SECURITY_INTEGRATION !== 'yes' }, async () => {
  const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
  const auth=createAuth(pool,process.env);
  const app=createApp({pool,auth,origins:['http://localhost:8787'],signupsEnabled:true});
  async function call(path,method='GET',body,token) {
    return app.request(path,{method,headers:{Origin:'http://localhost:8787',...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  }
  async function login(email,password) {
    const response=await call('/auth/sign-in/email','POST',{email,password});
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const token=response.headers.get('set-auth-token'); assert.ok(token); return token;
  }
  try {
    await pool.query('UPDATE "rateLimit" SET count=0,"lastRequest"=0');
    await pool.query(`UPDATE account SET password=$1 WHERE "userId"='fixture-owner' AND "providerId"='credential'`, [await hashPassword('old')]);
    const token=await login('owner@example.test','old'); // existing passwords below new-signup minimum must still work
    const otherSession=await login('owner@example.test','old');
    const betaToken=await login('beta@example.test','beta-password');
    const owner=await (await call('/account','GET',null,token)).json();
    assert.equal(owner.Role,'Owner'); assert.equal(owner._id,'fixture-owner');
    assert.equal(owner.timers[0].id,'timer-preserved'); assert.equal('password' in owner,false);
    assert.equal((await (await call('/account?user_id=fixture-owner','GET',null,betaToken)).json()).Role,'Beta Tester');
    assert.equal((await call('/account','GET',null,'forged')).status,401);
    assert.equal((await call('/account','PATCH',{Role:'Owner'},betaToken)).status,400);
    const patch=(revision)=>app.request('/account',{method:'PATCH',headers:{Origin:'http://localhost:8787','Content-Type':'application/json',Authorization:`Bearer ${token}`,'If-Match':revision},body:JSON.stringify({timers:owner.timers})});
    assert.equal((await patch(owner.revision)).status,200);
    assert.equal((await patch(owner.revision)).status,409);
    const wrong=await call('/auth/change-password','POST',{currentPassword:'wrong',newPassword:'changed-password',revokeOtherSessions:true},token);
    assert.notEqual(wrong.status,200);
    const change=await call('/auth/change-password','POST',{currentPassword:'old',newPassword:'changed-password',revokeOtherSessions:true},token);
    assert.equal(change.status,200,JSON.stringify(await change.clone().json()));
    const freshToken=change.headers.get('set-auth-token') || token;
    assert.equal((await call('/account','GET',null,otherSession)).status,401);
    assert.notEqual((await call('/auth/sign-in/email','POST',{email:'owner@example.test',password:'old'})).status,200);
    const changedToken=await login('owner@example.test','changed-password');
    const after=await (await call('/account','GET',null,changedToken)).json();
    assert.equal(after.Role,'Owner'); assert.deepEqual(after.timers,owner.timers); assert.deepEqual(after.Settings,owner.Settings);
    await call('/auth/sign-out','POST',{},changedToken);
    assert.equal((await call('/account','GET',null,changedToken)).status,401);
    assert.equal((await call('/account','GET',null,freshToken)).status,200);
    const newEmail=`new-${Date.now()}@example.test`;
    const signup=await call('/auth/sign-up/email','POST',{email:newEmail,password:'new-password',name:'New',role:'Owner',Role:'Owner'});
    assert.equal(signup.status,200,JSON.stringify(await signup.clone().json()));
    const limited=await call('/auth/sign-in/email','POST',{email:newEmail,password:'new-password'});
    assert.equal(limited.status,429); // sixth login in one minute is blocked by the production limiter
    // Trusted server API bypasses the HTTP limiter; use it only to finish the signup permission assertion.
    const newSession=await auth.api.signInEmail({body:{email:newEmail,password:'new-password'}});
    const newToken=newSession.token;
    assert.equal((await (await call('/account','GET',null,newToken)).json()).Role,'Standard');
    assert.equal((await call('/auth/update-user','POST',{role:'Owner'},newToken)).status,404);
  } finally { await pool.end(); }
});
