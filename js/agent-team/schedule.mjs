const formatters=new Map();
function parts(at,zone){let f=formatters.get(zone);if(!f){f=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});formatters.set(zone,f);}return Object.fromEntries(f.formatToParts(at).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));}
export function localDay(at,zone){const p=parts(at,zone);return p.year+'-'+p.month+'-'+p.day;}
export function scheduleSlot(config,at){if(!config.enabled)return null;
  if(config.mode==='interval'){const slot=Math.floor(at/(config.intervalMinutes*60000));return {id:config.version+':interval:'+slot,at:slot*config.intervalMinutes*60000};}
  const p=parts(at,config.timezone),time=p.hour+':'+p.minute;if(!config.dailyTimes.includes(time))return null;
  return {id:config.version+':daily:'+p.year+p.month+p.day+':'+time,at:Math.floor(at/60000)*60000};
}
export function nextSlots(config,at){const c={...config,enabled:true},out=[],seen=new Set();let t=Math.floor(at/60000)*60000+60000;
  for(let i=0;i<4320&&out.length<3;i++,t+=60000){const slot=scheduleSlot(c,t);if(slot&&slot.at>=t&&!seen.has(slot.id)){seen.add(slot.id);out.push(new Date(slot.at).toISOString());}}return out;
}
