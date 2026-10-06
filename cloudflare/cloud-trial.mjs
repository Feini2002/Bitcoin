// Optional absolute deadline for an explicitly prepared cost trial. Restarting
// an isolate never extends it. This stops new work, not already billed/in-flight
// work; the external pause/readback procedure is still required.
export function cloudTrialExpired(env, now=Date.now()) {
  const value=env?.BTC_TRIAL_END_AT;
  if(value===undefined || value===null || value==='') return false;
  const end=Date.parse(value);
  return !Number.isFinite(end) || now>=end;
}
