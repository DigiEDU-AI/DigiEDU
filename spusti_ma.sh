#!/bin/bash
cd "$(dirname "$0")"
PORT=8765
URL="http://localhost:$PORT"
echo "DigiEDU AI Assistant v3 – Cloud Edition"
open_browser() { sleep 1; if [ "$(uname)" = "Darwin" ]; then open "$URL"; else xdg-open "$URL" 2>/dev/null || google-chrome "$URL" 2>/dev/null & fi; }
if command -v python3 &>/dev/null; then
  open_browser & python3 -m http.server $PORT --bind 127.0.0.1; exit 0
fi
if command -v python &>/dev/null && python -c "import sys; sys.exit(0 if sys.version_info.major==3 else 1)"; then
  open_browser & python -m http.server $PORT --bind 127.0.0.1; exit 0
fi
if command -v node &>/dev/null; then
  open_browser &
  node -e "const h=require('http'),f=require('fs'),p=require('path'),root=process.cwd();const m={'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json'};h.createServer((q,r)=>{let fp=p.join(root,decodeURIComponent(q.url==='/'?'/index.html':q.url));try{const d=f.readFileSync(fp);r.writeHead(200,{'Content-Type':m[p.extname(fp)]||'text/plain','Access-Control-Allow-Origin':'*'});r.end(d);}catch{r.writeHead(404);r.end('Not found');}}).listen($PORT,'127.0.0.1',()=>console.log('Beží na $URL'));"
  exit 0
fi
echo "CHYBA: Nainštalujte Python 3"
