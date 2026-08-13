import pw from '/mnt/c/Users/jmitc/node_modules/playwright/index.js'; const {chromium}=pw;
const b=await chromium.launch();
for(const mode of ['kids','classic']){
 const p=await b.newPage({viewport:{width:1280,height:800}});
 const sel='button,[role=button]';
 const txt=async t=>{await p.waitForFunction(([s,t])=>[...document.querySelectorAll(s)].some(e=>e.offsetParent&&e.textContent.includes(t)),[sel,t],{timeout:8000});
  return p.evaluate(([s,t])=>[...document.querySelectorAll(s)].filter(e=>e.offsetParent).find(e=>e.textContent.includes(t)).click(),[sel,t])};
 await p.goto('http://localhost:8080/'); await p.waitForTimeout(2000);
 await p.evaluate(m=>localStorage.setItem('bb-mode-probe',m),mode);
 if(mode==='classic'){ await p.evaluate(()=>document.getElementById('btnOptions').click()); await p.waitForTimeout(500);
   await p.evaluate(()=>{const b=document.getElementById('btnControlMode'); if(b.textContent.includes('Kids')) b.click();}); await p.waitForTimeout(300);
   console.log('mode btn:',await p.evaluate(()=>document.getElementById('btnControlMode').textContent.trim()));
   await p.evaluate(()=>document.getElementById('btnOptionsBack').click()); await p.waitForTimeout(500);}
 await p.evaluate(()=>document.getElementById('btnSingleplayer').click());
 await txt('Create New World'); await p.waitForTimeout(600);
 await p.fill('#inputSeed','42'); await txt('Creative'); await txt('Tour');
 await p.evaluate(()=>document.getElementById('btnCreatePlay').click()); await p.waitForTimeout(4000);
 const read=()=>p.evaluate(()=>{const c=document.createElement('canvas');return null});
 await p.keyboard.down('d'); await p.waitForTimeout(6000); await p.keyboard.up('d'); await p.waitForTimeout(500);
 await p.screenshot({path:'/tmp/claude-1000/-mnt-c-Users-jmitc-workspace-Games-blockbound/0ff151cf-1cfa-4973-ab6e-4c20697b6332/scratchpad/kbd-'+mode+'.png',clip:{x:0,y:0,width:300,height:60}});
 await p.close();
}
await b.close();
