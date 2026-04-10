@echo off
chcp 65001 >nul
title DigiEDU AI Assistant v3
cd /d "%~dp0"
set PORT=8765
set URL=http://localhost:%PORT%
echo.
echo  DigiEDU AI Assistant v3 – Cloud Edition
echo  =========================================
echo.
python --version >nul 2>&1 && (
  echo [OK] Python najdeny – spustam server...
  start "" "%URL%"
  python -m http.server %PORT% --bind 127.0.0.1
  goto :end
)
py --version >nul 2>&1 && (
  start "" "%URL%"
  py -m http.server %PORT% --bind 127.0.0.1
  goto :end
)
node --version >nul 2>&1 && (
  start "" "%URL%"
  node -e "const h=require('http'),f=require('fs'),p=require('path'),root=process.cwd();const m={'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json'};h.createServer((q,r)=>{let fp=p.join(root,decodeURIComponent(q.url==='/'?'/index.html':q.url));try{const d=f.readFileSync(fp);r.writeHead(200,{'Content-Type':m[p.extname(fp)]||'text/plain','Access-Control-Allow-Origin':'*'});r.end(d);}catch{r.writeHead(404);r.end('Not found');}}).listen(%PORT%,'127.0.0.1',()=>console.log('http://localhost:%PORT%'));"
  goto :end
)
echo [CHYBA] Nainštalujte Python 3: https://www.python.org/downloads/
echo Zaškrtnite "Add Python to PATH"
pause
:end
