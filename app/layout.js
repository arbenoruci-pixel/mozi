export const metadata = { title: 'MOZI', description: 'Crypto Toolkit' };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{margin:0, fontFamily:'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', background:'#0b0b0b', color:'#eaeaea'}}>
        <div style={{maxWidth:880, margin:'40px auto', padding:'0 20px'}}>{children}</div>
      </body>
    </html>
  );
}
