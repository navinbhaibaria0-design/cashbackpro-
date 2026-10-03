
const app=document.getElementById('app');
const token=()=>localStorage.getItem('token');
async function api(url,opt={}){opt.headers={...(opt.headers||{}),'Content-Type':'application/json',...(token()?{Authorization:'Bearer '+token()}:{})};const r=await fetch(url,opt);const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
async function render(){
 if(!token()) return login();
 const me=await api('/api/me'); me.role==='admin'?admin(me):user(me);
}
function login(){app.innerHTML=`<div class="wrap" style="max-width:430px"><div class="card"><h1>Cashback Pro</h1><p class="muted">Project earning platform</p><div class="tabs"><button class="btn" onclick="showLogin()">Login</button><button class="btn secondary" onclick="showRegister()">Register</button></div><div id="form"></div></div></div>`;showLogin()}
function showLogin(){document.getElementById('form').innerHTML=`<input class="input" id="email" placeholder="Email"><input class="input" id="password" type="password" placeholder="Password"><button class="btn" onclick="doLogin()">Login</button>`}
function showRegister(){document.getElementById('form').innerHTML=`<input class="input" id="name" placeholder="Name"><input class="input" id="email" placeholder="Email"><input class="input" id="password" type="password" placeholder="Password"><input class="input" id="ref" placeholder="Referral code (optional)"><button class="btn" onclick="doRegister()">Create account</button>`}
async function doLogin(){try{let d=await api('/api/login',{method:'POST',body:JSON.stringify({email:email.value,password:password.value})});localStorage.token=d.token;render()}catch(e){alert(e.message)}}
async function doRegister(){try{let d=await api('/api/register',{method:'POST',body:JSON.stringify({name:document.getElementById('name').value,email:document.getElementById('email').value,password:document.getElementById('password').value,referralCode:document.getElementById('ref').value})});localStorage.token=d.token;render()}catch(e){alert(e.message)}}
function nav(title){return `<div class="nav"><div class="brand">Cashback Pro</div><div>${esc(title)} <button class="btn secondary" onclick="logout()">Logout</button></div></div>`}
function logout(){localStorage.clear();render()}
async function user(me){
 const projects=await api('/api/projects'), comps=await api('/api/completions');
 app.innerHTML=nav(me.name)+`<div class="wrap"><div class="grid">
 <div class="card"><div class="muted">Available balance</div><div class="money">₹${Number(me.balance).toFixed(2)}</div></div>
 <div class="card"><div class="muted">Referral code</div><div class="money" style="font-size:22px">${esc(me.referral_code)}</div><div class="muted">Share: ${location.origin}/?ref=${esc(me.referral_code)}</div></div>
 </div><div class="card"><h2>Projects</h2><div class="grid">${projects.map(p=>`<div class="card"><h3>${esc(p.title)}</h3><p>${esc(p.description)}</p><b>Reward ₹${p.reward}</b><br><br><button class="btn" onclick="startProject(${p.id})">Start Project</button></div>`).join('')}</div></div>
 <div class="card"><h2>Withdraw</h2><input class="input" id="upi" placeholder="UPI ID e.g. name@upi"><input class="input" id="amount" type="number" min="10" placeholder="Amount"><button class="btn" onclick="withdraw()">Request payout</button></div>
 <div class="card"><h2>My activity</h2><table class="table"><tr><th>Project</th><th>Reward</th><th>Status</th></tr>${comps.map(c=>`<tr><td>${esc(c.title)}</td><td>₹${c.reward}</td><td>${c.status}</td></tr>`).join('')}</table></div></div>`
}
async function startProject(id){try{alert((await api('/api/projects/'+id+'/start',{method:'POST'})).message);render()}catch(e){alert(e.message)}}
async function withdraw(){try{alert((await api('/api/withdraw',{method:'POST',body:JSON.stringify({upi:upi.value,amount:Number(amount.value)})})).message);render()}catch(e){alert(e.message)}}
async function admin(me){
 const s=await api('/api/admin/stats'), cs=await api('/api/admin/completions'), ws=await api('/api/admin/withdrawals');
 app.innerHTML=nav('Admin')+`<div class="wrap"><div class="grid">
 <div class="card"><div class="muted">Users</div><div class="money">${s.users}</div></div><div class="card"><div class="muted">Pending completions</div><div class="money">${s.pendingCompletions}</div></div><div class="card"><div class="muted">Pending withdrawals</div><div class="money">${s.pendingWithdrawals}</div></div></div>
 <div class="card"><h2>Add project</h2><input class="input" id="pt" placeholder="Title"><input class="input" id="pd" placeholder="Description"><input class="input" id="pr" type="number" placeholder="Reward"><button class="btn" onclick="addProject()">Add</button></div>
 <div class="card"><h2>Completions</h2><table class="table"><tr><th>User</th><th>Project</th><th>Reward</th><th>Status</th><th></th></tr>${cs.map(c=>`<tr><td>${esc(c.email)}</td><td>${esc(c.title)}</td><td>₹${c.reward}</td><td>${c.status}</td><td>${c.status==='pending'?`<button class="btn" onclick="approve(${c.id})">Approve</button>`:''}</td></tr>`).join('')}</table></div>
 <div class="card"><h2>Withdrawals</h2><table class="table"><tr><th>User</th><th>Amount</th><th>UPI</th><th>Status</th><th></th></tr>${ws.map(w=>`<tr><td>${esc(w.email)}</td><td>₹${w.amount}</td><td>${esc(w.upi_id)}</td><td>${w.status}</td><td>${w.status==='pending'?`<button class="btn" onclick="paid(${w.id})">Mark paid</button>`:''}</td></tr>`).join('')}</table></div></div>`
}
async function addProject(){try{await api('/api/admin/projects',{method:'POST',body:JSON.stringify({title:pt.value,description:pd.value,reward:Number(pr.value)})});alert('Project added');render()}catch(e){alert(e.message)}}
async function approve(id){try{await api('/api/admin/completions/'+id+'/approve',{method:'POST'});render()}catch(e){alert(e.message)}}
async function paid(id){try{await api('/api/admin/withdrawals/'+id+'/paid',{method:'POST',body:JSON.stringify({providerRef:'MANUAL'})});render()}catch(e){alert(e.message)}}
render();
