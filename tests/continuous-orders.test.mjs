import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../assets/js/order-glass.js',import.meta.url),'utf8');
const s={window:{},Intl};vm.createContext(s);vm.runInContext(source,s);const G=s.window.MGOrderGlass;

function events(){
  const map=new Map();return {map,addEventListener(type,fn){if(!map.has(type))map.set(type,new Set());map.get(type).add(fn);},
    removeEventListener(type,fn){map.get(type)?.delete(fn);},emit(type,event={}){for(const fn of map.get(type)||[])fn(event);},
    count(){return [...map.values()].reduce((n,set)=>n+set.size,0);}};
}
function fixture(){
  const frames=new Map(),intersections=[];let seq=0;
  const win={...events(),requestAnimationFrame(fn){frames.set(++seq,fn);return seq;},cancelAnimationFrame(id){frames.delete(id);},
    getComputedStyle:el=>({display:el.style?.display||'block',visibility:el.style?.visibility||'visible'}),
    IntersectionObserver:class{constructor(fn){this.fn=fn;this.cards=[];this.disconnected=false;intersections.push(this);}observe(card){this.cards.push(card);}disconnect(){this.disconnected=true;}}};
  const doc={...events(),defaultView:win},cards=[];win.document=doc;
  const container={contains:target=>cards.includes(target)||target?.inside===true};
  for(let i=0;i<3;i++){
    const classes=new Set(i===1?['mg-order-inactive']:[]),style={};
    const card={dataset:{orderId:String(4912-i)},ownerDocument:doc,style,hidden:false,
      classList:{contains:k=>classes.has(k),toggle(k,on){on?classes.add(k):classes.delete(k);}},
      rect:{top:i*1000,bottom:(i+1)*1000},getBoundingClientRect(){
        // Native DOMRect properties are inherited getters, not enumerable own fields.
        return Object.create({get top(){return card.rect.top;},get bottom(){return card.rect.bottom;}});
      }};
    cards.push(card);
  }
  container.querySelectorAll=()=>cards;
  const flush=()=>{const q=[...frames.values()];frames.clear();q.forEach(fn=>fn());};
  return {win,doc,container,cards,frames,intersections,flush};
}

test('all cards stay in document flow while only genuine operator/desk filters limit scope',()=>{
  const f=fixture(),before=f.cards.map(c=>({style:{...c.style},hidden:c.hidden}));
  assert.deepEqual([...G.deskCards(f.container)].map(c=>c.dataset.orderId),['4912','4911','4910']);
  assert.equal(f.cards[1].classList.contains('mg-order-inactive'),false,'obsolete single-card hiding is removed');
  const menu=G.navigationSelection(f.cards.map(c=>({id:c.dataset.orderId,text:c.dataset.orderId})),'4912','4911');
  assert.deepEqual([...menu.ids],['4911']);assert.equal(menu.active,'4912');
  assert.deepEqual([...G.deskCards(f.container)].map(c=>c.dataset.orderId),['4912','4911','4910']);
  assert.deepEqual(f.cards.map(c=>({style:{...c.style},hidden:c.hidden})),before,'menu search does not write card visibility');
  f.cards[2].style.display='none';assert.deepEqual([...G.deskCards(f.container)].map(c=>c.dataset.orderId),['4912','4911']);
  f.cards[1].hidden=true;assert.deepEqual([...G.deskCards(f.container)].map(c=>c.dataset.orderId),['4912']);
});

test('active order follows the reading line across large cards, gaps and document ends',()=>{
  const ranges=[{id:'4912',top:0,bottom:900},{id:'4911',top:920,bottom:2200},{id:'4910',top:2220,bottom:3100}];
  assert.equal(G.activeOrderAtLine(ranges,100),'4912');
  assert.equal(G.activeOrderAtLine(ranges,1000),'4911');
  assert.equal(G.activeOrderAtLine(ranges,910),'4912');
  assert.equal(G.activeOrderAtLine(ranges,4000),'4910');
  assert.equal(G.activeOrderAtLine(ranges,-100,'4910'),'4912');
  assert.equal(G.activeOrderAtLine([],100,'4912'),'');
});

test('document and right-pane scroll update only active navigation, never hide another order',()=>{
  const f=fixture(),active=[],before=f.cards.map(c=>({...c.style}));
  const tracker=G.createOrderTracker({...f,onActive:id=>active.push(id),offset:()=>100});
  assert.deepEqual(active,['4912']);
  f.cards.forEach(c=>{c.rect.top-=1000;c.rect.bottom-=1000;});
  f.doc.emit('scroll',{target:f.doc});f.win.emit('scroll',{target:f.win});f.intersections[0].fn([]);
  assert.equal(f.frames.size,1,'scroll and intersection notifications share one frame');
  f.flush();assert.deepEqual(active,['4912','4911']);
  f.cards.forEach(c=>{c.rect.top-=1000;c.rect.bottom-=1000;});
  f.doc.emit('scroll',{target:{inside:true}});f.flush();assert.deepEqual(active,['4912','4911','4910']);
  assert.deepEqual(f.cards.map(c=>({...c.style})),before);assert.ok(f.cards.every(c=>!c.hidden));
  f.doc.emit('scroll',{target:{id:'mg-order-navigation'}});assert.equal(f.frames.size,0,'scrolling the menu cannot select a different right-hand order');
  tracker.dispose();
});

test('desk changes and disposal remove observers, listeners and queued stale callbacks',()=>{
  const f=fixture(),active=[];
  const first=G.createOrderTracker({...f,onActive:id=>active.push('E1:'+id),offset:()=>100});
  f.win.emit('scroll',{target:f.win});assert.equal(f.frames.size,1);
  first.dispose();first.dispose();
  assert.equal(f.frames.size,0);assert.equal(f.win.count(),0);assert.equal(f.doc.count(),0);
  assert.equal(f.intersections[0].disconnected,true);
  f.cards.forEach(c=>{c.rect.top-=1000;c.rect.bottom-=1000;});
  f.intersections[0].fn([]);f.flush();assert.deepEqual(active,['E1:4912']);
  const second=G.createOrderTracker({...f,onActive:id=>active.push('E2:'+id),offset:()=>100});
  assert.equal(f.win.count(),2);assert.equal(f.doc.count(),1);assert.equal(f.intersections.length,2);
  assert.equal(active.at(-1),'E2:4911');second.dispose();
});

test('continuous desk CSS has no rule hiding inactive cards or restoring a single-card mode',()=>{
  const css=readFileSync(new URL('../assets/css/order-glass.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/\.mg-order-inactive[^}]*display\s*:\s*none/i);
  assert.doesNotMatch(source,/showAll|class="mg-all-orders"/);
  assert.match(css,/position:sticky/);assert.match(source,/mg:navigate',stopTracking/);
});
