
export default async function handler(req,res){
  try{
    const key = process.env.GOOGLE_MAPS_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || 'AIzaSyAzYDKjl8bMWYREsqvKV9OWPMlvv1fRKSw';
    const { origin, destination } = req.query;
    if(!origin||!destination) return res.status(400).json({error:'Missing origin/destination'});
    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    url.searchParams.set('origins', origin);
    url.searchParams.set('destinations', destination);
    url.searchParams.set('units','imperial');
    url.searchParams.set('key', key);
    const r = await fetch(url);
    const data = await r.json();
    let miles=null, status=data.status;
    try{
      const row = data.rows && data.rows[0] && data.rows[0].elements && data.rows[0].elements[0];
      if(row && row.status==='OK'){ miles = Number(String(row.distance && row.distance.text || '').replace(/[^0-9.]/g,'')); status='OK'; }
      else { status = row && row.status || status; }
    }catch(e){}
    return res.status(200).json({ok:true, status, miles});
  }catch(e){ return res.status(500).json({error:String(e)}); }
}
