import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../assets/js/app.js',import.meta.url),'utf8');
const start=source.indexOf('function updateStatsBoxColor() {');
const colour=source.slice(start,source.indexOf('processedStatsDiv?.addEventListener',start));
const observerStart=source.indexOf('if (processedStatsDiv) {',source.indexOf('checkAndSendScheduledWebhook();',start));
const observerCode=source.slice(observerStart,source.indexOf('closePaymentPopupBtn?.addEventListener',observerStart));

function fixture(){
  const values={display:'none'},pending=new Set(),observers=[];let writes=0,callbacks=0,days=10;
  class MutationObserver {
    constructor(fn){this.fn=fn;this.active=false;observers.push(this);}
    observe(target,options){this.active=true;this.target=target;this.options=options;}
    disconnect(){this.active=false;pending.delete(this);}
  }
  const style=new Proxy(values,{set(target,key,value){
    target[key]=value;writes++;
    // Browsers may emit a style-attribute mutation even for a repeated value.
    // Deliberately do so here; a self-observing colour callback must still settle.
    for(const o of observers)if(o.active&&o.options.attributes&&o.options.attributeFilter.includes('style'))pending.add(o);
    return true;
  }});
  const sandbox={processedStatsDiv:{style},calculateDaysRemaining:()=>days,MutationObserver};
  vm.createContext(sandbox);vm.runInContext(colour+'\n'+observerCode,sandbox);
  const flush=()=>{
    let deliveries=0;
    while(pending.size){
      if(++deliveries>20)throw Error('Style observer does not settle: self-triggering mutation loop');
      const batch=[...pending];pending.clear();
      for(const o of batch)if(o.active){callbacks++;o.fn([{type:'attributes',attributeName:'style',target:o.target}]);}
    }
    return deliveries;
  };
  return{style,values,observers,flush,update:()=>sandbox.updateStatsBoxColor(),setDays:v=>{days=v;},
    get writes(){return writes;},get callbacks(){return callbacks;}};
}

test('showing stats settles after one observer delivery, including repeated identical style assignments',()=>{
  const f=fixture();f.style.display='block';assert.equal(f.flush(),1);
  const before=f.writes;
  for(let i=0;i<10;i++)f.update();
  assert.equal(f.writes,before,'already-correct colours must not mutate styles');assert.equal(f.flush(),0);
  f.style.display='block';assert.equal(f.flush(),1);assert.equal(f.callbacks,2);
});

test('external colours are corrected once and remain observed after internal colour writes',()=>{
  const f=fixture();f.style.display='block';f.flush();
  f.style.background='orange';const before=f.writes;
  assert.equal(f.flush(),1);assert.equal(f.writes-before,1);
  assert.equal(f.values.background,'rgba(255, 255, 255, 0.15)');
  assert.equal(f.observers[0].active,true);
  f.style.borderColor='purple';assert.equal(f.flush(),1);
  assert.equal(f.values.borderColor,'rgba(255, 255, 255, 0.2)');
});

test('deadline states retain red, amber and neutral colours without observing their own changes',()=>{
  const f=fixture();f.style.display='block';f.flush();
  for(const [days,bg,border]of[
    [3,'rgba(231, 76, 60, 0.25)','rgba(231, 76, 60, 0.4)'],
    [5,'rgba(243, 156, 18, 0.25)','rgba(243, 156, 18, 0.4)'],
    [6,'rgba(255, 255, 255, 0.15)','rgba(255, 255, 255, 0.2)']
  ]){
    f.setDays(days);f.style.display='block';assert.equal(f.flush(),1);
    assert.equal(f.values.background,bg);assert.equal(f.values.borderColor,border);
  }
});

test('hidden stats do not recolour external changes; showing them resumes normal updates',()=>{
  const f=fixture();f.style.background='blue';assert.equal(f.flush(),1);
  assert.equal(f.values.background,'blue');
  f.style.display='block';assert.equal(f.flush(),1);
  assert.equal(f.values.background,'rgba(255, 255, 255, 0.15)');
});
