#!/usr/bin/env node
'use strict';
// Official historical distribution, separate from region-restricted live APIs.
// Local artifact acquisition only. No remote database writes, trades or deployment.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const identity=require('../../js/content-identity.js');
const DAY=86400000,MAX_ZIP=64*1024*1024,MAX_CSV=128*1024*1024;
function parseArgs(args){
  const settings={product:'um',kind:'metrics',symbol:'BTCUSDT',interval:'5m'};
  for(const argument of args){const match=/^--(date|product|kind|interval|out)=(.+)$/.exec(argument);if(!match)throw Error('Unknown argument: '+argument);settings[match[1]]=match[2];}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(settings.date||'')||new Date(settings.date).toISOString().slice(0,10)!==settings.date)throw Error('Valid --date=YYYY-MM-DD required');
  if(!['um','spot'].includes(settings.product)||!['metrics','klines'].includes(settings.kind)||settings.interval!=='5m'||(settings.kind==='metrics'&&settings.product!=='um'))throw Error('Only USD-M metrics and USD-M/spot 5m klines supported');
  return settings;
}
function archiveUrl({product,kind,symbol='BTCUSDT',interval='5m',date}){
  if(!['um','spot'].includes(product)||!['metrics','klines'].includes(kind)||symbol!=='BTCUSDT'||interval!=='5m')throw Error('Unsupported archive scope');
  const prefix=product==='um'?'futures/um':'spot';
  const filename=kind==='metrics'?`${symbol}-metrics-${date}.zip`:`${symbol}-${interval}-${date}.zip`;
  return `https://data.binance.vision/data/${prefix}/daily/${kind}/${symbol}/${kind==='klines'?interval+'/':''}${filename}`;
}
function verifyChecksum(zip,checksum,expectedName){
  const match=/^([a-fA-F0-9]{64})\s+\*?([^\r\n]+)\s*$/.exec(checksum.trim());
  if(!match||match[2].trim()!==expectedName)throw Error('Archive checksum identity mismatch');
  const actual=crypto.createHash('sha256').update(zip).digest('hex');
  if(actual!==match[1].toLowerCase())throw Error('Archive SHA256 mismatch');return actual;
}
function unzipCsv(zip,expectedName){
  if(zip.length>MAX_ZIP)throw Error('Archive oversized');
  const end=zip.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if(end<0||end+22>zip.length||end+22+zip.readUInt16LE(end+20)!==zip.length)throw Error('Invalid ZIP directory');
  if(zip.readUInt16LE(end+8)!==1||zip.readUInt16LE(end+10)!==1||zip.readUInt16LE(end+4)||zip.readUInt16LE(end+6))throw Error('Expected one CSV in single-disk ZIP');
  const directory=zip.readUInt32LE(end+16);
  if(directory+46>end||zip.readUInt32LE(directory)!==0x02014b50)throw Error('Invalid central directory');
  const flags=zip.readUInt16LE(directory+8),method=zip.readUInt16LE(directory+10),compressed=zip.readUInt32LE(directory+20),size=zip.readUInt32LE(directory+24);
  const nameLength=zip.readUInt16LE(directory+28),name=zip.subarray(directory+46,directory+46+nameLength).toString('utf8');
  if(flags&1||![0,8].includes(method)||size>MAX_CSV||name!==expectedName)throw Error('Unsupported archive entry');
  const local=zip.readUInt32LE(directory+42);
  if(local+30>directory||zip.readUInt32LE(local)!==0x04034b50)throw Error('Invalid local ZIP entry');
  const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
  if(start+compressed>directory)throw Error('Truncated ZIP payload');
  const data=method===0?zip.subarray(start,start+compressed):zlib.inflateRawSync(zip.subarray(start,start+compressed),{maxOutputLength:MAX_CSV});
  if(data.length!==size)throw Error('Archive inflated size mismatch');return data.toString('utf8');
}
function csv(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const char=text[i];if(char==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(char===','&&!quoted){row.push(field);field='';}else if(char==='\n'&&!quoted){row.push(field.replace(/\r$/,''));if(row.some(v=>v!==''))rows.push(row);row=[];field='';}else field+=char;}
  if(quoted)throw Error('Unterminated CSV quote');if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}return rows;
}
const numeric=value=>value===undefined||value===''||value==='.'?null:Number.isFinite(Number(value))?Number(value):null;
function parseArchive(text,settings){
  const {date,product,kind,interval='5m'}=settings;
  const from=Date.parse(date+'T00:00:00Z'),to=from+DAY,step=300000;
  const records=csv(text),rows=[];let timestampUnit='millisecond';
  if(kind==='metrics'){
    const header=records.shift();
    for(const name of ['create_time','symbol','sum_open_interest','sum_open_interest_value'])if(!header.includes(name))throw Error('Missing metrics field: '+name);
    for(const cells of records){const native=Object.fromEntries(header.map((key,i)=>[key,cells[i]]));if(native.symbol!=='BTCUSDT')throw Error('Archive instrument mismatch');
      const timestamp=Date.parse(native.create_time.replace(' ','T')+'Z');
      rows.push({key:String(timestamp),observedAt:new Date(timestamp).toISOString(),values:{
        openInterest:numeric(native.sum_open_interest),openInterestValue:numeric(native.sum_open_interest_value),
        topAccountRatio5m:numeric(native.count_toptrader_long_short_ratio),topPositionRatio5m:numeric(native.sum_toptrader_long_short_ratio),
        accountRatio5m:numeric(native.count_long_short_ratio),takerBuySellRatio5m:numeric(native.sum_taker_long_short_vol_ratio),
        takerBuyVolume:null,takerSellVolume:null,period:'5m',native}});
    }
  }else{
    timestampUnit=product==='spot'&&date>='2025-01-01'?'microsecond':'millisecond';
    if(records[0]&&!/^\d+$/.test(records[0][0]))records.shift();
    for(const r of records){if(r.length<11)throw Error('Invalid kline row');const scale=timestampUnit==='microsecond'?1000:1;
      const timestamp=Number(r[0])/scale;
      rows.push({key:String(timestamp),observedAt:new Date(timestamp).toISOString(),values:{open:numeric(r[1]),high:numeric(r[2]),low:numeric(r[3]),close:numeric(r[4]),
        baseVolume:numeric(r[5]),closeTime:new Date(Number(r[6])/scale).toISOString(),quoteVolume:numeric(r[7]),trades:numeric(r[8]),
        takerBuyBase:numeric(r[9]),takerBuyQuote:numeric(r[10]),interval,marketType:product==='spot'?'spot':'usdm-perpetual',archiveTimestampUnit:timestampUnit}});
    }
  }
  rows.sort((a,b)=>Number(a.key)-Number(b.key));const gaps=[];
  for(let i=0;i<rows.length;i++){const t=Number(rows[i].key);if(!Number.isSafeInteger(t)||t<from||t>=to||t%step!==0)throw Error('Archive time/window mismatch');
    if(i&&rows[i-1].key===rows[i].key)throw Error('Duplicate archive observation');if(i&&t-Number(rows[i-1].key)!==step)gaps.push({from:Number(rows[i-1].key)+step,to:t});
    if(kind==='metrics'&&(rows[i].values.openInterest===null||rows[i].values.openInterest<0))throw Error('Invalid archive OI');
    if(kind==='klines'){const v=rows[i].values;if(!['open','high','low','close','baseVolume'].every(k=>Number.isFinite(v[k]))||v.low>Math.min(v.open,v.close)||v.high<Math.max(v.open,v.close)||v.baseVolume<0||v.takerBuyBase>v.baseVolume)throw Error('Invalid archive OHLC/volume');}
  }
  const complete=rows.length===DAY/step&&Number(rows[0]?.key)===from&&Number(rows.at(-1)?.key)===to-step&&!gaps.length;
  return {rows,timestampUnit,coverage:{from,to,period:'5m',expected:288,returned:rows.length,gaps,complete},
    units:kind==='metrics'?{openInterest:'BTC',openInterestValue:'USDT',ratios:'5m ratio; absolute volumes unavailable'}:{price:product==='um'?'USDT/BTC':'USDT/BTC',baseVolume:'BTC',quoteVolume:'USDT'},
    limitations:kind==='metrics'?['5m ratios cannot be directly aggregated to 1h without numerators/denominators.','Not historical order book or liquidation events.']:['Ex-post archive, not a reconstructed publication vintage.']};
}
async function download(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(25000),redirect:'error'});if(!response.ok)throw Error('HTTP '+response.status);
  if(Number(response.headers.get('content-length'))>MAX_ZIP)throw Error('Archive oversized');
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>MAX_ZIP)throw Error('Archive oversized');chunks.push(chunk);}return Buffer.concat(chunks);
}
async function main(){
  if(process.argv.includes('--help')){console.log('node scripts/research/binance-archive.cjs --date=YYYY-MM-DD --product=um|spot --kind=metrics|klines [--out=<directory>]');return;}
  const settings=parseArgs(process.argv.slice(2)),url=archiveUrl(settings),name=new URL(url).pathname.split('/').pop();
  const [zip,checksum]=await Promise.all([download(url),download(url+'.CHECKSUM')]);
  const receivedAt=new Date().toISOString(),sha256=verifyChecksum(zip,checksum.toString('utf8'),name),text=unzipCsv(zip,name.replace(/\.zip$/,'.csv'));
  const parsed=parseArchive(text,settings),directory=path.resolve(settings.out||'.artifacts/archive/'+sha256);
  fs.mkdirSync(path.dirname(directory),{recursive:true});fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory,name),zip,{flag:'wx'});fs.writeFileSync(path.join(directory,name+'.CHECKSUM'),checksum,{flag:'wx'});
  const manifest={schema:'binance-archive-evidence.v1',parserVersion:'binance-archive.2026-09-30.1',...settings,url,sha256,receivedAt,publicAvailableAt:null,
    knowledgeBasis:'first local receipt; archive date is not the date the system knew it',product:settings.product,...parsed};
  manifest.contentId=identity.contentId(manifest);
  fs.writeFileSync(path.join(directory,'evidence.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
  console.log(JSON.stringify({directory,sha256,count:parsed.rows.length,coverage:parsed.coverage,timestampUnit:parsed.timestampUnit,contentId:manifest.contentId}));
}
module.exports={parseArgs,archiveUrl,verifyChecksum,unzipCsv,csv,parseArchive};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
