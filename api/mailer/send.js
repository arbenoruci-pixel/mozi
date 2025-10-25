
export default async function handler(req,res){
  try{
    if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
    const { provider, from, subject, body, to=[], bcc=[], dry=false } = req.body||{};
    const recips = (bcc.length? bcc : to);
    if(!provider||!subject||!body) return res.status(400).json({error:'Missing fields'});
    if(!recips.length) return res.status(400).json({error:'No recipients'});
    if(dry) return res.status(200).json({ok:true, provider, recipients: recips.length, dry:true});

    if(provider==='sendgrid'){
      const key=process.env.SENDGRID_API_KEY, fromAddr=from||process.env.SENDGRID_FROM;
      if(!key||!fromAddr) return res.status(200).json({ok:false, note:'Missing SENDGRID env'});
      const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method:'POST',
        headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
        body: JSON.stringify({
          personalizations:[{ to:[], bcc: recips.map(e=>({email:e})) }],
          from:{email:fromAddr}, subject,
          content:[{type:'text/plain', value: body}]
        })
      });
      const ok=r.ok; const t=await r.text(); return res.status(r.status).json({ok, detail:t});
    }

    if(provider==='mailgun'){
      const key=process.env.MAILGUN_API_KEY, domain=process.env.MAILGUN_DOMAIN, fromAddr=from||process.env.MAILGUN_FROM;
      if(!key||!domain||!fromAddr) return res.status(200).json({ok:false, note:'Missing MAILGUN env'});
      const params=new URLSearchParams();
      params.set('from',fromAddr); params.set('subject',subject); params.set('text',body);
      params.set('bcc', recips.join(','));
      const r = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
        method:'POST',
        headers:{'Authorization':'Basic '+Buffer.from('api:'+key).toString('base64')},
        body: params
      });
      const ok=r.ok; const t=await r.text(); return res.status(r.status).json({ok, detail:t});
    }

    return res.status(400).json({error:'Unknown provider'});
  }catch(e){ return res.status(500).json({error:String(e)}); }
}
