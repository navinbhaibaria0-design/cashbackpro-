
const express=require('express');
const path=require('path');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const Database=require('better-sqlite3');

const app=express();
const db=new Database('data.db');
const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||'CHANGE_THIS_SECRET_BEFORE_PRODUCTION';

app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));
app.use((req,res,next)=>{ if(req.path.startsWith('/api/')) res.setHeader('Cache-Control','no-store'); next(); });

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT UNIQUE NOT NULL,
 password TEXT NOT NULL,
 referral_code TEXT UNIQUE NOT NULL,
 referred_by TEXT,
 balance REAL DEFAULT 0,
 role TEXT DEFAULT 'user',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS projects(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 description TEXT NOT NULL,
 reward REAL NOT NULL,
 active INTEGER DEFAULT 1,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS completions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 project_id INTEGER NOT NULL,
 status TEXT DEFAULT 'pending',
 reward REAL NOT NULL,
 external_id TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id,project_id)
);
CREATE TABLE IF NOT EXISTS withdrawals(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 amount REAL NOT NULL,
 upi_id TEXT NOT NULL,
 status TEXT DEFAULT 'pending',
 provider_ref TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings(
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL
);
`);

const admin=db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
if(!admin){
  const hash=bcrypt.hashSync('ChangeMe123!',10);
  db.prepare("INSERT INTO users(name,email,password,referral_code,role) VALUES(?,?,?,?,?)")
    .run('Admin','admin@example.com',hash,'ADMIN001','admin');
}
if(!db.prepare("SELECT id FROM projects LIMIT 1").get()){
  const add=db.prepare("INSERT INTO projects(title,description,reward) VALUES(?,?,?)");
  add.run('Welcome Project','Demo project — replace this with your real offer.',25);
  add.run('Survey Project','Demo completion flow for testing.',50);
}
db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('referral_percent','5')").run();

function tokenFor(u){return jwt.sign({id:u.id,role:u.role},JWT_SECRET,{expiresIn:'7d'});}
function auth(req,res,next){
  try{
    const h=req.headers.authorization||'';
    if(!h.startsWith('Bearer ')) throw Error();
    req.user=jwt.verify(h.slice(7),JWT_SECRET);
    next();
  }catch(e){res.status(401).json({error:'Unauthorized'});}
}
function adminOnly(req,res,next){ if(req.user.role!=='admin') return res.status(403).json({error:'Admin only'}); next(); }

app.post('/api/register',(req,res)=>{
  const {name,email,password,referralCode}=req.body;
  if(!name||!email||!password||password.length<6) return res.status(400).json({error:'Name, valid email and 6+ character password required'});
  try{
    const code='U'+Math.random().toString(36).slice(2,10).toUpperCase();
    const hash=bcrypt.hashSync(password,10);
    const r=db.prepare("INSERT INTO users(name,email,password,referral_code,referred_by) VALUES(?,?,?,?,?)")
      .run(name,email.toLowerCase(),hash,code,referralCode||null);
    const u=db.prepare("SELECT id,name,email,referral_code,balance,role FROM users WHERE id=?").get(r.lastInsertRowid);
    res.json({token:tokenFor(u),user:u});
  }catch(e){res.status(400).json({error:'Email already registered'});}
});

app.post('/api/login',(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE email=?").get((req.body.email||'').toLowerCase());
  if(!u||!bcrypt.compareSync(req.body.password||'',u.password)) return res.status(401).json({error:'Invalid login'});
  const safe={id:u.id,name:u.name,email:u.email,referral_code:u.referral_code,balance:u.balance,role:u.role};
  res.json({token:tokenFor(safe),user:safe});
});

app.get('/api/me',auth,(req,res)=>{
  const u=db.prepare("SELECT id,name,email,referral_code,referred_by,balance,role,created_at FROM users WHERE id=?").get(req.user.id);
  res.json(u);
});
app.get('/api/projects',auth,(req,res)=>res.json(db.prepare("SELECT * FROM projects WHERE active=1 ORDER BY id DESC").all()));
app.get('/api/completions',auth,(req,res)=>res.json(db.prepare(`
SELECT c.*,p.title FROM completions c JOIN projects p ON p.id=c.project_id
WHERE c.user_id=? ORDER BY c.id DESC`).all(req.user.id)));

app.post('/api/projects/:id/start',auth,(req,res)=>{
  const p=db.prepare("SELECT * FROM projects WHERE id=? AND active=1").get(req.params.id);
  if(!p) return res.status(404).json({error:'Project not found'});
  try{
    db.prepare("INSERT INTO completions(user_id,project_id,reward,status) VALUES(?,?,?,'pending')")
      .run(req.user.id,p.id,p.reward);
    res.json({message:'Project started. Completion will be verified by webhook/admin.'});
  }catch(e){res.status(400).json({error:'Already started or completed'});}
});

app.post('/api/withdraw',auth,(req,res)=>{
  const amount=Number(req.body.amount), upi=(req.body.upi||'').trim();
  if(!Number.isFinite(amount)||amount<10||!upi) return res.status(400).json({error:'Minimum withdrawal is ₹10 and UPI is required'});
  const tx=db.transaction(()=>{
    const u=db.prepare("SELECT balance FROM users WHERE id=?").get(req.user.id);
    if(u.balance<amount) throw Error('Insufficient balance');
    db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(amount,req.user.id);
    return db.prepare("INSERT INTO withdrawals(user_id,amount,upi_id) VALUES(?,?,?)").run(req.user.id,amount,upi);
  });
  try{ const r=tx(); res.json({message:'Withdrawal queued',id:r.lastInsertRowid}); }
  catch(e){res.status(400).json({error:e.message});}
});

/* Third-party offer completion webhook.
   Production: validate provider signature before accepting this request. */
app.post('/api/webhooks/offer-complete',(req,res)=>{
  const {externalId,projectId,userId}=req.body;
  if(!externalId||!projectId||!userId) return res.status(400).json({error:'Missing fields'});
  const c=db.prepare("SELECT * FROM completions WHERE user_id=? AND project_id=?").get(userId,projectId);
  if(!c) return res.status(404).json({error:'Completion not found'});
  if(c.status==='approved') return res.json({ok:true,duplicate:true});
  const tx=db.transaction(()=>{
    db.prepare("UPDATE completions SET status='approved',external_id=? WHERE id=?").run(externalId,c.id);
    db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(c.reward,userId);
    const u=db.prepare("SELECT referred_by FROM users WHERE id=?").get(userId);
    const pct=Number(db.prepare("SELECT value FROM settings WHERE key='referral_percent'").get().value);
    if(u && u.referred_by){
      const ref=db.prepare("SELECT id FROM users WHERE referral_code=?").get(u.referred_by);
      if(ref) db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(c.reward*pct/100,ref.id);
    }
  });
  tx(); res.json({ok:true});
});

/* Admin */
app.get('/api/admin/stats',auth,adminOnly,(req,res)=>{
  res.json({
    users:db.prepare("SELECT COUNT(*) n FROM users WHERE role='user'").get().n,
    pendingCompletions:db.prepare("SELECT COUNT(*) n FROM completions WHERE status='pending'").get().n,
    pendingWithdrawals:db.prepare("SELECT COUNT(*) n FROM withdrawals WHERE status='pending'").get().n,
    paid:db.prepare("SELECT COALESCE(SUM(amount),0) n FROM withdrawals WHERE status='paid'").get().n
  });
});
app.post('/api/admin/projects',auth,adminOnly,(req,res)=>{
  const {title,description,reward}=req.body;
  if(!title||!description||Number(reward)<=0) return res.status(400).json({error:'Invalid project'});
  const r=db.prepare("INSERT INTO projects(title,description,reward) VALUES(?,?,?)").run(title,description,Number(reward));
  res.json({id:r.lastInsertRowid});
});
app.get('/api/admin/completions',auth,adminOnly,(req,res)=>res.json(db.prepare(`
SELECT c.*,u.name,u.email,p.title FROM completions c
JOIN users u ON u.id=c.user_id JOIN projects p ON p.id=c.project_id
ORDER BY c.id DESC`).all()));
app.post('/api/admin/completions/:id/approve',auth,adminOnly,(req,res)=>{
  const c=db.prepare("SELECT * FROM completions WHERE id=?").get(req.params.id);
  if(!c||c.status==='approved') return res.status(400).json({error:'Invalid completion'});
  const tx=db.transaction(()=>{
    db.prepare("UPDATE completions SET status='approved' WHERE id=?").run(c.id);
    db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(c.reward,c.user_id);
  });
  tx(); res.json({ok:true});
});
app.get('/api/admin/withdrawals',auth,adminOnly,(req,res)=>res.json(db.prepare(`
SELECT w.*,u.name,u.email FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC`).all()));
app.post('/api/admin/withdrawals/:id/paid',auth,adminOnly,(req,res)=>{
  db.prepare("UPDATE withdrawals SET status='paid',provider_ref=? WHERE id=?")
    .run(req.body.providerRef||'MANUAL',req.params.id);
  res.json({ok:true});
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Running on http://localhost:${PORT}`));
