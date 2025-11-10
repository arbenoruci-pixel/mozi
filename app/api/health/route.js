export async function GET(){return new Response(JSON.stringify({ok:true,app:'mozi',deployed:true,at:new Date().toISOString()}),{headers:{'content-type':'application/json'}})}
