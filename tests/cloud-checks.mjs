export async function checks({Portal,safePath,equal,assert}) {
  assert.equal(safePath('SERV_RS11_41220/photo.jpg'),'SERV_RS11_41220/photo.jpg');
  for (const path of ['../secret','SERV_x/../secret','SERV_x/a/b','SERV_x/https://x','SERV_x/a%2Fb','SERV_x/a\\b','other/a','SERV_x/#a'])
    assert.throws(()=>safePath(path));
  assert.equal(equal('abc','abc'),true);
  assert.equal(equal('abc','abd'),false);
  assert.equal(equal('abc','ab'),false);
  const memory=new Map();
  const storage={get:async k=>memory.get(k),put:async(k,v)=>memory.set(k,v),setAlarm:async()=>{},delete:async k=>memory.delete(k)};
  const p=new Portal({storage},{});
  for(let i=0;i<5;i++) await p.limit('rate:test',5,900000);
  await assert.rejects(()=>p.limit('rate:test',5,900000),e=>e.status===429);
  p.graph=async path=>path===':/portal-state.json'?{status:404}:{status:200,json:async()=>path.includes('servisni')?[{id:'SERV_old',serial:'41220'}]:[{qty:5}]};
  assert.deepEqual(await p.readState(),{schema:1,servis:[{id:'SERV_old',serial:'41220'}],dily:[{qty:5}],version:'missing'});
  p.graph=async path=>({status:200,json:async()=>path===':/portal-state.json'?{eTag:'v1'}:{schema:1,servis:[{serial:'new'}],dily:[]}});
  assert.equal((await p.readState()).servis[0].serial,'new');
  p.graph=async()=>({status:200,json:async()=>({schema:9})});
  await assert.rejects(()=>p.readState(),e=>e.status===422);
  const state={schema:1,servis:[{serial:'41220'}],dily:[{qty:4}],version:'v1'};
  p.session=async()=>({});
  p.limit=async()=>{};
  p.readState=async()=>state;
  let writes=0,body;
  p.graph=async(_path,options)=>{writes++;body=JSON.parse(options.body);return {json:async()=>({eTag:'v2'})};};
  const request=version=>({url:'https://worker.test/api/state',method:'PUT',
    headers:{get:name=>name==='X-Portal-Version'?version:null},text:async()=>JSON.stringify({servis:[{serial:'55804'}],dily:[{qty:3}]})});
  await assert.rejects(()=>p.handle(request('old')),e=>e.status===409);
  assert.equal(writes,0);
  const response=await p.handle(request('v1'));
  assert.deepEqual(await response.json(),{version:'v2'});
  assert.deepEqual(body,{schema:1,servis:[{serial:'55804'}],dily:[{qty:3}]});
  assert.equal(writes,1);
  const order=[];
  const queue=new Portal({storage},{});
  queue.handle=async value=>{order.push('start'+value);await Promise.resolve();order.push('end'+value);return value;};
  await Promise.all([queue.fetch(1),queue.fetch(2)]);
  assert.deepEqual(order,['start1','end1','start2','end2']);
  return 8;
}
