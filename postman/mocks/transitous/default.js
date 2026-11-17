// Contract-shaped test data; no real bus positions or passenger information.
const http = require('node:http');
let failure = false, slow = false, empty = false;
const a={name:'Passau Test A',stopId:'test-a',lat:48.566,lon:13.436};
const b={name:'Passau Test B',stopId:'test-b',lat:48.573,lon:13.456};
function encode(points,precision=6){let last=[0,0],result='';for(const point of points)for(let i=0;i<2;i++){let n=Math.round(point[i]*10**precision);let d=n-last[i];last[i]=n;d=d<0?-d*2-1:d*2;while(d>=32){result+=String.fromCharCode((d%32)+32+63);d=Math.floor(d/32)}result+=String.fromCharCode(d+63)}return result}
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/__control'){failure=url.searchParams.get('failure')==='true';slow=url.searchParams.get('slow')==='true';empty=url.searchParams.get('empty')==='true';res.end('{}');return}
  res.setHeader('Content-Type','application/json');
  const send=(code,body)=>{res.statusCode=code;res.end(JSON.stringify(body))};
  if(failure){send(503,{error:'Simulated provider outage'});return}
  const now=Date.now(),start=new Date(now-60000).toISOString(),end=new Date(now+60000).toISOString();
  if(url.pathname==='/api/v6/map/stops'){if(!url.searchParams.has('min')||!url.searchParams.has('max'))return send(400,{});return send(200,empty?[]:[a,b])}
  if(url.pathname==='/api/v6/map/trips'){
    for(const key of ['min','max','zoom','startTime','endTime'])if(!url.searchParams.has(key))return send(400,{error:key});
    return send(200,empty?[]:[{trips:[{tripId:'test-bus',displayName:'Bus 5'}],mode:'BUS',distance:1600,from:a,to:b,departure:start,arrival:end,scheduledDeparture:start,scheduledArrival:end,realTime:false,polyline:encode([[a.lat,a.lon],[b.lat,b.lon]],5)}]);
  }
  if(url.pathname==='/api/v6/plan'){
    if(!url.searchParams.has('fromPlace')||!url.searchParams.has('toPlace'))return send(400,{});
    const reversed=url.searchParams.get('fromPlace')==='test-b',from=reversed?b:a,to=reversed?a:b;
    const data={itineraries:empty?[]:[{duration:120,startTime:start,endTime:end,transfers:0,legs:[{mode:'BUS',from,to,startTime:start,endTime:end,duration:120,routeShortName:'5',legGeometry:{points:encode([[from.lat,from.lon],[to.lat,to.lon]]),precision:6,length:2}}]}]};
    if(slow)return setTimeout(()=>send(200,data),450);
    return send(200,data);
  }
  send(501,{error:'Endpoint outside this simulation'});
}).listen(process.env.PORT || 4500);
