export {localDay,scheduleSlot,nextSlots} from '../../js/agent-team/schedule.mjs';
export class Presence {
  constructor({leaseMs=180000,graceMs=15000,clock=()=>Date.now(),onResume=()=>{}}={}){this.clients=new Map();this.leaseMs=leaseMs;this.graceMs=graceMs;this.clock=clock;this.onResume=onResume;this.lostAt=null;this.generation=0;this.resumedAt=null;}
  connect(id,nonce){const wasAlive=this.alive();this.clients.set(id,{nonce,confirmedAt:0,connected:true});if(wasAlive&&!this.alive())this.lostAt??=this.clock();}
  ack(id,nonce){const row=this.clients.get(id);if(!row||row.nonce!==nonce||!row.connected)throw Error('invalid_presence');if(this.state()==='absent'){this.generation++;this.resumedAt=this.clock();this.onResume(this.resumedAt);}row.confirmedAt=this.clock();this.lostAt=null;}
  disconnect(id,nonce){const row=this.clients.get(id);if(row&&(!nonce||row.nonce===nonce))row.connected=false;if(!this.alive())this.lostAt??=this.clock();}
  alive(){return [...this.clients.values()].some(x=>x.connected&&x.confirmedAt>0&&this.clock()-x.confirmedAt<this.leaseMs);}
  state(){if(this.alive())return 'present';if(this.lostAt!==null&&this.clock()-this.lostAt<this.graceMs)return 'grace';return 'absent';}
}
