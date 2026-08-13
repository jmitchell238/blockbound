import pw from '/mnt/c/Users/jmitc/node_modules/playwright/index.js'; const {chromium}=pw;
const SP='/tmp/claude-1000/-mnt-c-Users-jmitc-workspace-Games-blockbound/0ff151cf-1cfa-4973-ab6e-4c20697b6332/scratchpad/';
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1280,height:800}});
const logs=[]; p.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
p.on('console',m=>{if(m.type()==='error')logs.push('err: '+m.text().slice(0,150))});
const sel='button,[role=button]';
const txt=async t=>{await p.waitForFunction(([s,t])=>[...document.querySelectorAll(s)].some(e=>e.offsetParent&&e.textContent.includes(t)),[sel,t],{timeout:8000});
  return p.evaluate(([s,t])=>[...document.querySelectorAll(s)].filter(e=>e.offsetParent).find(e=>e.textContent.includes(t)).click(),[sel,t])};
await p.goto('http://localhost:8080/'); await p.waitForTimeout(2500);
await p.evaluate(()=>document.getElementById('btnSingleplayer').click());
await txt('Create New World'); await p.waitForTimeout(700);
await p.fill('#inputSeed','42'); await txt('Creative'); await txt('Tour');
await p.evaluate(()=>document.getElementById('btnCreatePlay').click()); await p.waitForTimeout(4000);
const coord=()=>p.evaluate(()=>{const m=document.querySelector('canvas');return null});
// Tour world = 1024 wide. sprint right for a long time, sampling the HUD coords via screenshots
await p.keyboard.down('Shift'); await p.keyboard.down('d');
for(let i=0;i<12;i++){ await p.waitForTimeout(5000); if(i%4===3) await p.screenshot({path:SP+'wrap-'+i+'.png'}); }
await p.keyboard.up('d'); await p.keyboard.up('Shift');
await p.waitForTimeout(600); await p.screenshot({path:SP+'wrap-end.png'});
console.log('LOGS:',logs.slice(0,10).join('\n')||'(none)');
await b.close();
