const fs=require('fs'), vm=require('vm'), assert=require('node:assert/strict');
let html=fs.readFileSync('index.html','utf8');
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
function extract(name){const start=html.indexOf('function '+name+'(');assert.ok(start>=0);const body=html.indexOf('{',start);let depth=1,end=body+1;while(depth){if(html[end]==='{')depth++;if(html[end]==='}')depth--;end++;}return html.slice(start,end)}
const items=[{duration:900,legs:[{mode:'BUS'},{mode:'BUS'}]},{duration:300,legs:[{mode:'WALK'},{mode:'BUS'}]},{duration:500,legs:[{mode:'WALK'}]}];
const ctx={journeyItems:items,connectionFilter:'direct',renderJourneys:x=>ctx.result=x,renderEmpty:()=>ctx.empty=true};vm.createContext(ctx);vm.runInContext(extract('filteredJourneys'),ctx);ctx.filteredJourneys();assert.equal(ctx.result.length,2);assert.equal(ctx.result[0].duration,300);ctx.connectionFilter='fastest';ctx.filteredJourneys();assert.deepEqual(Array.from(ctx.result,x=>x.duration),[300,500,900]);assert.equal(items[0].duration,900);ctx.connectionFilter='direct';ctx.journeyItems=[items[0]];ctx.filteredJourneys();assert.equal(ctx.empty,true);
const elements={searchTrips:{disabled:true},connectionFilters:{hidden:false}};Object.assign(ctx,{$:id=>elements[id],journeysAbort:{abort(){ctx.aborted=true}}});vm.runInContext(extract('invalidateJourneys'),ctx);ctx.invalidateJourneys();assert.equal(ctx.aborted,true);assert.equal(ctx.journeyItems,null);assert.equal(elements.searchTrips.disabled,false);assert.equal(elements.connectionFilters.hidden,true);
Object.assign(ctx,{getLocal:()=>JSON.stringify([null,{}, {from:'custom',to:'zob'},{from:'home',to:'zob',custom:''}]),STORAGE_ROUTES:'saved',P:{home:{},zob:{},custom:{}}});vm.runInContext(extract('getSaved'),ctx);assert.equal(ctx.getSaved().length,1);
assert.ok(!html.includes('user-scalable=no'));assert.ok(html.includes("document.createElement('details')"));assert.ok(!html.includes("card.setAttribute('role','button')"));
console.log('PASS: script syntax, direct filter, duration sort, source order preservation, empty filter, request invalidation, malformed saved data, accessible controls.');

