import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AuditLog} from '../js/audit-log.mjs';
test('engine diagnostic export only includes structural allowlisted fields',async()=>{
 const log=new AuditLog(await mkdtemp(join(tmpdir(),'engine-audit-')));
 await log.record({action:'installer:engine',outcome:'error',code:'ENGINE_RUNTIME_MISSING',engine:{action:'version',exitCode:3221225781,timedOut:false,resultReceived:false,runtimeMissing:true,stderr:'private credentials',params:{token:'private'},path:'C:/Users/private'}});
 const row=(await log.list()).entries[0];
 assert.equal(row.engine.exitCode,3221225781);assert.equal(row.engine.runtimeMissing,true);
 assert.doesNotMatch(JSON.stringify(row),/private|stderr|params/);
});
