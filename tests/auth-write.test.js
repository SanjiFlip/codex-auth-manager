const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function fixture(failures,code='EPERM') {
  const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
  const start=source.indexOf('async function atomicWriteAuth(content)');
  const end=source.indexOf('\nasync function refreshStoredActiveAccount',start);
  const files=new Map([['/synthetic/auth.json','previous-synthetic-auth']]);
  let attempts=0;
  const context={isWindows:true,path:path.posix,crypto:{randomUUID:()=> 'fixture'},
    codexDir:()=>'/synthetic',authPath:()=>'/synthetic/auth.json',validateAuthJson:()=>{},
    setTimeout:callback=>{callback()},
    fs:{mkdir:async()=>{},writeFile:async(file,content)=>files.set(file,content),
      rename:async(from,to)=>{attempts++;assert.equal(files.get(to),'previous-synthetic-auth');if(attempts<=failures)throw Object.assign(Error('synthetic lock'),{code});files.set(to,files.get(from));files.delete(from)},
      rm:async file=>{assert.notEqual(file,'/synthetic/auth.json','Previous credentials must never be unlinked');files.delete(file)},
    },
  };
  vm.runInNewContext(source.slice(start,end),context);
  return {context,files,get attempts(){return attempts}};
}

test('auth replacement retries a transient Windows sharing failure without removing the old login',async()=>{
  const f=fixture(2);await f.context.atomicWriteAuth('replacement-synthetic-auth');
  assert.equal(f.attempts,3);
  assert.deepEqual([...f.files],[['/synthetic/auth.json','replacement-synthetic-auth']]);
});

test('persistent sharing failures stop after the bounded retries and preserve the previous login',async()=>{
  const f=fixture(Infinity);await assert.rejects(f.context.atomicWriteAuth('replacement-synthetic-auth'),{code:'EPERM'});
  assert.equal(f.attempts,7);
  assert.deepEqual([...f.files],[['/synthetic/auth.json','previous-synthetic-auth']]);
});

test('other auth replacement errors are reported immediately',async()=>{
  const f=fixture(Infinity,'ENOSPC');await assert.rejects(f.context.atomicWriteAuth('replacement-synthetic-auth'),{code:'ENOSPC'});
  assert.equal(f.attempts,1);
  assert.deepEqual([...f.files],[['/synthetic/auth.json','previous-synthetic-auth']]);
});
