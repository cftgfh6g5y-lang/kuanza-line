const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const url = require('node:url');
const { createClient } = require('@supabase/supabase-js');

const ROOT = __dirname;
const PUBLIC = ROOT;
const DB = path.join(ROOT, 'data', 'db.json');
fs.mkdirSync(path.dirname(DB), { recursive: true });

// ============================================================
// SUPABASE — AUTHENTICATION SOURCE OF TRUTH
// ============================================================
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_PUBLISHABLE_KEY = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
const SUPABASE_SECRET_KEY = String(
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ''
).trim();
const SUPABASE_PRODUCT_IMAGES_BUCKET = String(process.env.SUPABASE_PRODUCT_IMAGES_BUCKET || 'product-images').trim();

const supabaseAuth =
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : null;

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SECRET_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : null;

const demoProducts = [
  {id:'p1',name:'iPhone 13 128GB',price:450000,cat:'Eletrónicos',emoji:'📱',seller:'Beni Store',sellerId:'demo1',verified:true,rating:4.9,description:'iPhone 13 128GB em excelente estado.',photos:[]},
  {id:'p2',name:'Smart TV 43"',price:320000,cat:'Eletrónicos',emoji:'📺',seller:'Casa Digital',sellerId:'demo2',verified:true,rating:4.8,description:'Smart TV 43 polegadas, imagem nítida e excelente para entretenimento.',photos:[]},
  {id:'p3',name:'Conjunto Streetwear',price:45000,cat:'Moda',emoji:'👕',seller:'Style AO',sellerId:'demo3',verified:true,rating:4.7,description:'Conjunto streetwear moderno.',photos:[]}
];

if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify({users:[],stores:[],products:demoProducts,orders:[],sessions:[],favorites:[],carts:[],conversations:[],messages:[],reviews:[],notifications:[],disputes:[],wallets:[],walletTransactions:[],deliveries:[],securityEvents:[],reports:[],blockedUsers:[]}, null, 2));

function read(){return JSON.parse(fs.readFileSync(DB,'utf8'));}
function write(d){fs.writeFileSync(DB,JSON.stringify(d,null,2));}
function ensureDB(db){
  for(const k of ['users','stores','products','orders','sessions','favorites','carts','conversations','messages','reviews','notifications','disputes','wallets','walletTransactions','deliveries','securityEvents','reports','blockedUsers']) if(!Array.isArray(db[k])) db[k]=[];
  for(const p of db.products){ if(!Array.isArray(p.photos)) p.photos=[]; if(!p.description) p.description='Produto disponível na Kuanza Line.'; }
  return db;
}
function json(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(),microphone=(),geolocation=(self)','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function body(req,max=8*1024*1024){return new Promise((resolve,reject)=>{let s='',size=0;req.on('data',c=>{size+=c.length;if(size>max){reject(new Error('Dados demasiado grandes.'));req.destroy();return;}s+=c});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(new Error('JSON inválido.'))}});req.on('error',reject)})}
function token(){return crypto.randomBytes(24).toString('hex');}

async function migrateFavoritesAndCart(db){
  if(!supabaseAdmin)return;
  try{
    const favorites=Array.isArray(db.favorites)?db.favorites:[];
    const carts=Array.isArray(db.carts)?db.carts:[];
    if(favorites.length){
      const productIds=[...new Set(favorites.map(x=>String(x.productId||'')).filter(Boolean))];
      const userIds=[...new Set(favorites.map(x=>String(x.userId||'')).filter(Boolean))];
      if(productIds.length&&userIds.length){
        const {data:products,error:pe}=await supabaseAdmin.from('products').select('id').in('id',productIds);
        if(pe)throw pe;
        const validProducts=new Set((products||[]).map(x=>String(x.id)));
        const rows=favorites.filter(x=>userIds.includes(String(x.userId))&&validProducts.has(String(x.productId))).map(x=>({user_id:String(x.userId),product_id:String(x.productId)}));
        if(rows.length){const {error}=await supabaseAdmin.from('favorites').upsert(rows,{onConflict:'user_id,product_id'});if(error)throw error;}
      }
    }
    if(carts.length){
      const productIds=[...new Set(carts.map(x=>String(x.productId||'')).filter(Boolean))];
      const userIds=[...new Set(carts.map(x=>String(x.userId||'')).filter(Boolean))];
      if(productIds.length&&userIds.length){
        const {data:products,error:pe}=await supabaseAdmin.from('products').select('id').in('id',productIds);
        if(pe)throw pe;
        const validProducts=new Set((products||[]).map(x=>String(x.id)));
        const rows=carts.filter(x=>userIds.includes(String(x.userId))&&validProducts.has(String(x.productId))).map(x=>({user_id:String(x.userId),product_id:String(x.productId),quantity:Math.max(1,Math.min(99,Number(x.qty||x.quantity||1)))}));
        if(rows.length){
          const {error}=await supabaseAdmin.from('cart_items').upsert(rows,{onConflict:'user_id,product_id'});if(error)throw error;
        }
      }
    }
  }catch(e){console.error('Migração inicial de favoritos/carrinho:',e.message||e);}
}

async function auth(db,req){
  const accessToken=(req.headers.authorization||'').replace('Bearer ','').trim();
  if(!accessToken || !supabaseAuth) return null;

  const { data, error } = await supabaseAuth.auth.getUser(accessToken);
  if(error || !data?.user) return null;

  const au=data.user;
  const supabaseUser=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
    global:{headers:{Authorization:`Bearer ${accessToken}`}},
    auth:{persistSession:false,autoRefreshToken:false}
  });

  const { data: profile, error: profileError } = await supabaseUser
    .from('profiles')
    .select('id,full_name,phone,avatar_url,role,verified,score,created_at,updated_at')
    .eq('id',au.id)
    .maybeSingle();

  if(profileError){
    console.error('Erro ao carregar perfil Supabase:',profileError.message);
    return null;
  }

  const p=profile||{};
  const user={
    id:au.id,
    name:String(p.full_name||au.user_metadata?.full_name||au.user_metadata?.name||au.email?.split('@')[0]||'Utilizador'),
    email:String(au.email||''),
    role:['buyer','seller','admin'].includes(p.role)?p.role:'buyer',
    score:Number(p.score||50),
    verified:!!p.verified,
    avatar:String(p.avatar_url||''),
    phone:String(p.phone||''),
    createdAt:p.created_at||au.created_at||new Date().toISOString()
  };

  // Compatibility mirror for the current marketplace modules.
  // Supabase Auth/Profile remains the source of truth for identity.
  const i=db.users.findIndex(x=>String(x.id)===String(user.id));
  if(i>=0) db.users[i]={...db.users[i],...user};
  else db.users.push(user);

  return user;
}
function calculateScore(db,u){
  if(!u)return 0;
  const completed=db.orders.filter(o=>o.status==='Concluído'&&Array.isArray(o.items)&&o.items.some(i=>i.sellerId===u.id||i.seller===u.name)).length;
  const reviews=db.reviews.filter(r=>r.sellerId===u.id);
  const avg=reviews.length?reviews.reduce((a,r)=>a+Number(r.rating||0),0)/reviews.length:0;
  const cancellations=db.orders.filter(o=>o.sellerId===u.id&&o.status==='Cancelado').length;
  const complaints=Number(u.complaints||0);
  const response=Number(u.responseTimeMinutes||0);
  let score=50;
  score+=Math.min(25,completed*3);
  score+=reviews.length?Math.round((avg/5)*20):0;
  score-=Math.min(15,cancellations*4);
  score-=Math.min(20,complaints*8);
  if(response>0&&response<=30)score+=5;
  else if(response>30&&response<=120)score+=3;
  else if(response>720)score-=5;
  if(u.verified)score+=5;
  return Math.max(0,Math.min(100,Math.round(score)));
}
function scoreLabel(score){if(score>=90)return'Excelente';if(score>=75)return'Bom';if(score>=50)return'Regular';if(score>=25)return'Baixo';return'Crítico';}
function publicUser(u,db){if(!u)return null;const completedOrders=db.orders.filter(o=>o.status==='Concluído'&&((o.userId===u.id)|| (Array.isArray(o.items)&&o.items.some(i=>i.sellerId===u.id||i.seller===u.name)))).length;const receivedReviews=db.reviews.filter(r=>r.sellerId===u.id).length;const cancelledOrders=db.orders.filter(o=>o.userId===u.id&&o.status==='Cancelado').length;const score=calculateScore(db,u);return{id:u.id,name:u.name,email:u.email,role:u.role,score,scoreLabel:scoreLabel(score),avatar:u.avatar||'',verified:!!u.verified,completedOrders,receivedReviews,cancelledOrders};}
function getStore(db,ownerId){return db.stores.find(x=>x.ownerId===ownerId)||null;}
function publicProduct(db,p){
  const seller=db.users.find(u=>String(u.id)===String(p.sellerId));
  const store=getStore(db,p.sellerId);
  return {
    ...p,
    seller:seller?seller.name:(p.seller||'Vendedor'),
    verified:seller?!!seller.verified:!!p.verified,
    rating:Number(p.rating||5),
    score:seller?calculateScore(db,seller):Number(p.score||100),
    storeName:store?.name||p.seller||'Loja',
    storeLogo:store?.logo||store?.logoUrl||'',
    photos:Array.isArray(p.photos)?p.photos:[]
  };
}
function slugify(value){
  return String(value||'')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0,70) || 'item';
}
function productSlug(name){
  return `${slugify(name)}-${crypto.randomUUID().slice(0,8)}`;
}
function storeSlug(name,ownerId){
  return `${slugify(name)}-${String(ownerId||'').replace(/[^a-zA-Z0-9]/g,'').slice(0,8) || crypto.randomUUID().slice(0,8)}`;
}
async function supabaseSellerMaps(sellerIds){
  const ids=[...new Set((sellerIds||[]).filter(Boolean).map(String))];
  const profilesById=new Map();
  const storesByOwner=new Map();
  if(!supabaseAdmin||!ids.length)return {profilesById,storesByOwner};
  const [{data:profiles,error:profilesError},{data:stores,error:storesError}]=await Promise.all([
    supabaseAdmin.from('profiles').select('id,full_name,verified,score,avatar_url,phone,role').in('id',ids),
    supabaseAdmin.from('stores').select('id,owner_id,name,slug,description,logo_url,location,phone,verified,created_at,updated_at').in('owner_id',ids)
  ]);
  if(profilesError)throw new Error('Não foi possível carregar os vendedores no Supabase: '+profilesError.message);
  if(storesError)throw new Error('Não foi possível carregar as lojas no Supabase: '+storesError.message);
  for(const row of profiles||[])profilesById.set(String(row.id),row);
  for(const row of stores||[])storesByOwner.set(String(row.owner_id),row);
  return {profilesById,storesByOwner};
}
async function supabaseCategory(categoryValue){
  if(!supabaseAdmin)return null;
  const value=String(categoryValue||'').trim();
  if(!value)return null;
  if(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)){
    const byId=await supabaseAdmin.from('categories').select('id,name,slug,active').eq('id',value).eq('active',true).maybeSingle();
    if(byId.error)throw new Error('Não foi possível consultar a categoria: '+byId.error.message);
    if(byId.data)return byId.data;
  }
  const slug=slugify(value);
  const bySlug=await supabaseAdmin.from('categories').select('id,name,slug,active').eq('slug',slug).eq('active',true).maybeSingle();
  if(bySlug.error)throw new Error('Não foi possível consultar a categoria: '+bySlug.error.message);
  if(bySlug.data)return bySlug.data;
  const byName=await supabaseAdmin.from('categories').select('id,name,slug,active').ilike('name',value).eq('active',true).maybeSingle();
  if(byName.error)throw new Error('Não foi possível consultar a categoria: '+byName.error.message);
  return byName.data||null;
}
async function supabaseCategoryMap(categoryIds){
  const ids=[...new Set((categoryIds||[]).filter(Boolean).map(String))];
  const map=new Map();
  if(!supabaseAdmin||!ids.length)return map;
  const {data,error}=await supabaseAdmin.from('categories').select('id,name,slug,active').in('id',ids);
  if(error)throw new Error('Não foi possível carregar as categorias: '+error.message);
  for(const row of data||[])map.set(String(row.id),row);
  return map;
}
function isDataImage(value){
  return typeof value==='string' && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value);
}
function dataImageParts(dataUrl){
  const m=String(dataUrl||'').match(/^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/i);
  if(!m)return null;
  const mime=m[1].toLowerCase();
  const ext=mime==='image/jpeg'?'jpg':mime.split('/')[1].replace('jpeg','jpg');
  return {mime,ext,buffer:Buffer.from(m[3],'base64')};
}
async function getProductImages(productIds){
  const ids=[...new Set((productIds||[]).filter(Boolean).map(String))];
  const map=new Map();
  if(!supabaseAdmin||!ids.length)return map;
  const {data,error}=await supabaseAdmin
    .from('product_images')
    .select('id,product_id,image_url,position,created_at')
    .in('product_id',ids)
    .order('position',{ascending:true});
  if(error)throw new Error('Não foi possível carregar as fotos dos produtos: '+error.message);
  for(const row of data||[]){
    const key=String(row.product_id);
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(String(row.image_url||''));
  }
  return map;
}
async function uploadProductImages(productId,photos){
  if(!supabaseAdmin)return {ok:false,error:'Supabase não está configurado no servidor.'};
  if(!Array.isArray(photos)||photos.length<5||photos.length>10)return {ok:false,error:'O produto precisa de pelo menos 5 fotos reais e no máximo 10.'};
  const uploaded=[];
  try{
    for(let i=0;i<photos.length;i++){
      const parts=dataImageParts(photos[i]);
      if(!parts)return {ok:false,error:'Uma das fotos tem um formato inválido.'};
      const filePath=`products/${String(productId)}/${i+1}-${crypto.randomUUID()}.${parts.ext}`;
      const {error}=await supabaseAdmin.storage.from(SUPABASE_PRODUCT_IMAGES_BUCKET).upload(filePath,parts.buffer,{contentType:parts.mime,upsert:false});
      if(error)throw new Error(error.message);
      const {data:publicData}=supabaseAdmin.storage.from(SUPABASE_PRODUCT_IMAGES_BUCKET).getPublicUrl(filePath);
      const imageUrl=String(publicData?.publicUrl||'').trim();
      if(!imageUrl)throw new Error('Não foi possível obter a URL pública da foto.');
      uploaded.push({filePath,imageUrl,position:i});
    }
    const {data,error}=await supabaseAdmin.from('product_images').insert(uploaded.map(x=>({product_id:String(productId),image_url:x.imageUrl,position:x.position}))).select('id,product_id,image_url,position,created_at');
    if(error)throw new Error(error.message);
    return {ok:true,rows:data||[],files:uploaded};
  }catch(e){
    for(const file of uploaded){
      try{await supabaseAdmin.storage.from(SUPABASE_PRODUCT_IMAGES_BUCKET).remove([file.filePath]);}catch(_){}
    }
    return {ok:false,error:e.message||'Falha ao guardar as fotos.'};
  }
}
async function replaceProductImages(productId,photos){
  if(!supabaseAdmin)return {ok:false,error:'Supabase não está configurado no servidor.'};
  const current=await getProductImages([productId]);
  const oldUrls=current.get(String(productId))||[];
  const uploaded=await uploadProductImages(productId,photos);
  if(!uploaded.ok)return uploaded;
  const {error}=await supabaseAdmin.from('product_images').delete().eq('product_id',String(productId));
  if(error)return {ok:false,error:'As novas fotos foram enviadas, mas não foi possível substituir as fotos antigas: '+error.message};
  const oldPaths=[];
  for(const url of oldUrls){
    const marker=`/${SUPABASE_PRODUCT_IMAGES_BUCKET}/`;
    const idx=String(url).indexOf(marker);
    if(idx>=0)oldPaths.push(String(url).slice(idx+marker.length));
  }
  if(oldPaths.length){try{await supabaseAdmin.storage.from(SUPABASE_PRODUCT_IMAGES_BUCKET).remove(oldPaths);}catch(_){}
  }
  return uploaded;
}
async function attachProductImages(products){
  const list=Array.isArray(products)?products:[];
  const map=await getProductImages(list.map(p=>p.id));
  return list.map(p=>({...p,photos:(map.get(String(p.id))||[]).length?(map.get(String(p.id))||[]):(Array.isArray(p.photos)?p.photos:[])}));
}
function supabaseProductToPublic(row,profile,store,legacy,category){
  const sellerName=String(profile?.full_name||legacy?.seller||'Vendedor');
  const categoryName=String(category?.name||legacy?.cat||legacy?.category||'');
  return {
    id:String(row.id),
    name:String(row.name||''),
    price:Number(row.price||0),
    stock:Number(row.stock||0),
    status:String(row.status||'active'),
    views:Number(row.views||0),
    cat:categoryName,
    category:categoryName,
    categoryId:row.category_id?String(row.category_id):'',
    emoji:String(legacy?.emoji||'📦'),
    seller:sellerName,
    sellerId:String(row.seller_id),
    verified:!!profile?.verified,
    rating:Number(legacy?.rating||5),
    score:Number(profile?.score||legacy?.score||50),
    description:String(row.description||''),
    condition:String(legacy?.condition||'Usado'),
    location:String(legacy?.location||''),
    photos:Array.isArray(legacy?.photos)?legacy.photos:[],
    storeName:String(store?.name||sellerName+' Store'),
    storeLogo:String(store?.logo_url||legacy?.storeLogo||''),
    createdAt:row.created_at||null,
    updatedAt:row.updated_at||null
  };
}
function supabaseStoreToPublic(row,legacy){
  if(!row)return null;
  return {
    id:String(row.id),
    ownerId:String(row.owner_id),
    name:String(row.name||''),
    slug:String(row.slug||''),
    logo:String(row.logo_url||legacy?.logo||''),
    logoUrl:String(row.logo_url||legacy?.logoUrl||legacy?.logo||''),
    description:String(row.description||''),
    location:String(row.location||''),
    phone:String(row.phone||''),
    verified:!!row.verified,
    rating:Number(legacy?.rating||5),
    createdAt:row.created_at||null,
    updatedAt:row.updated_at||null
  };
}
function mirrorProductToLegacy(db,p){
  if(!p)return;
  const item={
    id:String(p.id),
    name:p.name,
    price:Number(p.price||0),
    cat:p.cat||p.category||'',
    category:p.category||p.cat||'',
    categoryId:p.categoryId||'',
    emoji:p.emoji||'📦',
    seller:p.seller||'Vendedor',
    sellerId:String(p.sellerId),
    verified:!!p.verified,
    rating:Number(p.rating||5),
    score:Number(p.score||50),
    description:p.description||'',
    condition:p.condition||'Usado',
    location:p.location||'',
    photos:Array.isArray(p.photos)?p.photos:[],
    stock:Number(p.stock||0),
    status:p.status||'active',
    views:Number(p.views||0),
    createdAt:p.createdAt||new Date().toISOString(),
    updatedAt:p.updatedAt||new Date().toISOString(),
    supabaseManaged:true
  };
  const i=db.products.findIndex(x=>String(x.id)===String(item.id));
  if(i>=0)db.products[i]={...db.products[i],...item};else db.products.push(item);
}
function mirrorStoreToLegacy(db,st){
  if(!st)return;
  const item={
    id:String(st.id),
    ownerId:String(st.ownerId),
    name:st.name,
    slug:st.slug||'',
    logo:st.logo||st.logoUrl||'',
    logoUrl:st.logoUrl||st.logo||'',
    description:st.description||'',
    location:st.location||'',
    phone:st.phone||'',
    verified:!!st.verified,
    rating:Number(st.rating||5),
    createdAt:st.createdAt||new Date().toISOString(),
    updatedAt:st.updatedAt||new Date().toISOString(),
    supabaseManaged:true
  };
  const i=db.stores.findIndex(x=>String(x.id)===String(item.id));
  if(i>=0)db.stores[i]={...db.stores[i],...item};else db.stores.push(item);
}

function validPhotos(photos){return Array.isArray(photos)&&photos.length>=5&&photos.length<=10&&photos.every(x=>typeof x==='string'&&x.startsWith('data:image/'));}
function conversationKey(a,b){return [a,b].sort().join(':');}
function notify(db,userId,type,title,message,data={}){
  if(!userId)return;
  if(!Array.isArray(db.notifications))db.notifications=[];
  db.notifications.unshift({id:crypto.randomUUID(),userId,type,title,message,read:false,createdAt:new Date().toISOString(),data});
  if(db.notifications.length>500)db.notifications=db.notifications.slice(0,500);
}
function orderStatusLabel(status){return String(status||'Pendente');}
function orderTimeline(order){
  const base=['Pendente','Confirmado','Em preparação','Enviado','Entregue'];
  const history=Array.isArray(order.statusHistory)?order.statusHistory:[];
  return base.map(status=>{
    const item=history.find(x=>x.status===status);
    return {status,done:!!item||status===order.status,at:item?.at||null};
  });
}

const PLATFORM_COMMISSION_RATE=0.10;
function ensureWallet(db,userId){
  let w=db.wallets.find(x=>x.userId===userId);
  if(!w){w={id:'WAL-'+crypto.randomUUID(),userId,available:0,pending:0,totalEarned:0,totalWithdrawn:0,createdAt:new Date().toISOString()};db.wallets.push(w);}
  return w;
}
function walletSummary(db,userId){
  const w=ensureWallet(db,userId);
  const tx=db.walletTransactions.filter(x=>x.userId===userId).slice(0,50);
  return {...w,available:Number(w.available||0),pending:Number(w.pending||0),totalEarned:Number(w.totalEarned||0),totalWithdrawn:Number(w.totalWithdrawn||0),transactions:tx};
}
function deliveryStatusFromOrderStatus(status){
  const map={
    'Pendente':'A preparar',
    'Confirmado':'A preparar',
    'Em preparação':'A preparar',
    'Enviado':'Em trânsito',
    'Entregue':'Entregue',
    'Cancelado':'Cancelada'
  };
  return map[status]||'A preparar';
}

function ensureDeliveryForOrder(db,order){
  if(!Array.isArray(db.deliveries))db.deliveries=[];

  const sellerIds=[...new Set((order.items||[]).map(i=>i.sellerId).filter(Boolean))];
  let d=db.deliveries.find(x=>x.orderId===order.id);

  if(!d){
    const now=new Date().toISOString();
    d={
      id:'DEL-'+crypto.randomUUID(),
      orderId:order.id,
      buyerId:order.userId,
      sellerIds,
      recipient:order.delivery?.recipient||'',
      phone:order.delivery?.phone||'',
      address:order.delivery?.address||'',
      method:order.delivery?.method||'delivery',
      fee:Number(order.delivery?.fee||0),
      status:deliveryStatusFromOrderStatus(order.status),
      statusHistory:[{status:deliveryStatusFromOrderStatus(order.status),at:order.createdAt||now}],
      confirmationCode:String(Math.floor(100000+Math.random()*900000)),
      createdAt:order.createdAt||now,
      updatedAt:now
    };
    db.deliveries.unshift(d);
  }else{
    d.buyerId=order.userId;
    d.sellerIds=[...new Set([...(Array.isArray(d.sellerIds)?d.sellerIds:[]),...sellerIds])];
    if(!d.status)d.status=deliveryStatusFromOrderStatus(order.status);
    if(!Array.isArray(d.statusHistory))d.statusHistory=[];
    d.updatedAt=new Date().toISOString();
  }

  return d;
}

function addWalletTx(db,userId,type,amount,description,meta={}){
  const tx={id:'TX-'+Date.now().toString(36)+'-'+crypto.randomBytes(3).toString('hex'),userId,type,amount:Number(amount||0),description,meta,createdAt:new Date().toISOString()};
  db.walletTransactions.unshift(tx);return tx;
}
function calculateSellerShare(order,sellerId){
  const items=(Array.isArray(order.items)?order.items:[]).filter(i=>String(i.sellerId||'')===String(sellerId));
  const gross=items.reduce((sum,i)=>sum+Number(i.price||0)*Math.max(1,Number(i.quantity||1)),0);
  const commission=Math.round(gross*PLATFORM_COMMISSION_RATE);
  return {gross,commission,net:gross-commission};
}
function settleDeliveredOrder(db,order){
  if(!order||order.status!=='Entregue'||order.financials?.settled)return false;
  const sellerIds=[...new Set((order.items||[]).map(i=>i.sellerId).filter(Boolean))];
  order.financials={...(order.financials||{}),settled:true,settledAt:new Date().toISOString(),sellers:{}};
  for(const sellerId of sellerIds){
    const share=calculateSellerShare(order,sellerId); const wallet=ensureWallet(db,sellerId);
    wallet.pending=Math.max(0,Number(wallet.pending||0)-share.net);
    wallet.available=Number(wallet.available||0)+share.net;
    wallet.totalEarned=Number(wallet.totalEarned||0)+share.net;
    order.financials.sellers[sellerId]=share;
    addWalletTx(db,sellerId,'sale_released',share.net,`Venda #${String(order.id).slice(-8)} libertada após entrega`,{orderId:order.id,gross:share.gross,commission:share.commission});
    notify(db,sellerId,'wallet','Valor libertado',`Kz ${share.net.toLocaleString('pt-AO')} foram adicionados ao teu saldo disponível.`,{orderId:order.id,amount:share.net});
  }
  return true;
}

const rateBuckets=new Map();
function rateLimit(req,key,limit=60,windowMs=60000){const now=Date.now();const id=key+'|'+(req.socket.remoteAddress||'unknown');const a=rateBuckets.get(id)||[];const fresh=a.filter(t=>now-t<windowMs);fresh.push(now);rateBuckets.set(id,fresh);return fresh.length<=limit;}
function audit(db,req,userId,event,meta={}){if(!Array.isArray(db.securityEvents))db.securityEvents=[];db.securityEvents.unshift({id:crypto.randomUUID(),userId:userId||null,event,ip:req.socket.remoteAddress||'unknown',at:new Date().toISOString(),meta});if(db.securityEvents.length>1000)db.securityEvents=db.securityEvents.slice(0,1000);}
function isBlocked(db,userId){return Array.isArray(db.blockedUsers)&&db.blockedUsers.some(x=>String(x.userId)===String(userId)&&x.active!==false);}
function adminOnly(user){return !!user&&user.role==='admin';}
const server=http.createServer(async(req,res)=>{
  const u=url.parse(req.url,true);
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'});return res.end();}
  try{
    let db=ensureDB(read());
    if(!globalThis.__kuanzaFavCartMigrationStarted){globalThis.__kuanzaFavCartMigrationStarted=true;migrateFavoritesAndCart(db);}
    if(!rateLimit(req, u.pathname.startsWith('/api/login')?'login':u.pathname.startsWith('/api/register')?'register':'api', u.pathname.startsWith('/api/login')?12:u.pathname.startsWith('/api/register')?8:120, 60000)) return json(res,429,{error:'Muitas solicitações. Tenta novamente em instantes.'});
    const currentUser=await auth(db,req);
    if(currentUser && isBlocked(db,currentUser.id)) return json(res,403,{error:'A tua conta está temporariamente bloqueada.'});
    if(u.pathname==='/api/health') return json(res,200,{ok:true,service:'Kuanza Line API',version:'1.9.3',status:'healthy',supabase:!!(supabaseAuth&&supabaseAdmin),timestamp:new Date().toISOString()});
    if(u.pathname==='/api/ready') return json(res,200,{ok:true,ready:fs.existsSync(DB),database:fs.existsSync(DB)?'ready':'missing',version:'1.9.3',supabase:!!(supabaseAuth&&supabaseAdmin)});

    if(u.pathname==='/api/register'&&req.method==='POST'){
      if(!supabaseAdmin || !supabaseAuth) return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const b=await body(req);
      const name=String(b.name||'').trim();
      const email=String(b.email||'').trim().toLowerCase();
      const password=String(b.password||'');
      const role=b.role==='seller'?'seller':'buyer';
      if(!name||!email||!password)return json(res,400,{error:'Preenche nome, email e palavra-passe.'});
      if(password.length<6)return json(res,400,{error:'A palavra-passe deve ter pelo menos 6 caracteres.'});

      // REGISTRATION uses the public Auth API, not auth.admin.
      // This is the correct browser/server flow with Supabase publishable keys.
      const { data: created, error: createError } = await supabaseAuth.auth.signUp({
        email,
        password,
        options:{
          data:{full_name:name,name,role}
        }
      });
      if(createError){
        const msg=String(createError.message||'');
        if(/already|registered|exists|duplicate/i.test(msg)) return json(res,409,{error:'Este email já está registado.'});
        return json(res,400,{error:msg||'Não foi possível criar a conta.'});
      }

      const uid=created?.user?.id;
      if(!uid) return json(res,400,{error:'O Supabase não devolveu o utilizador criado.'});

      // The database trigger creates profiles automatically. If the server secret
      // is available, we also synchronize the selected role without making signup
      // depend on the privileged key.
      if(supabaseAdmin){
        const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
          id:uid,
          full_name:name,
          role,
          verified:false,
          score:50
        },{onConflict:'id'});
        if(profileError) console.warn('Profile sync after signup:',profileError.message);
      }

      const session=created.session;
      if(!session){
        audit(db,req,uid,'supabase_register_pending',{role});
        write(db);
        return json(res,201,{ok:true,user:{id:uid,name,email,role,score:50,verified:false},token:null,requiresEmailConfirmation:true,message:'Conta criada. Confirma o teu email para iniciar sessão.'});
      }

      const user={id:uid,name,email,role,score:50,verified:false,avatar:'',createdAt:new Date().toISOString()};
      const i=db.users.findIndex(x=>x.id===uid);
      if(i>=0)db.users[i]={...db.users[i],...user}; else db.users.push(user);
      write(db);
      audit(db,req,uid,'supabase_register',{role});
      write(db);
      return json(res,201,{token:session.access_token,user:publicUser(user,db)});
    }

    if(u.pathname==='/api/login'&&req.method==='POST'){
      if(!supabaseAuth) return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const b=await body(req);
      const email=String(b.email||'').trim().toLowerCase();
      const password=String(b.password||'');
      if(!email||!password)return json(res,400,{error:'Preenche email e palavra-passe.'});
      const { data, error } = await supabaseAuth.auth.signInWithPassword({email,password});
      if(error || !data?.session) return json(res,401,{error:'Email ou palavra-passe incorretos.'});
      const user=await auth(db,{headers:{authorization:`Bearer ${data.session.access_token}`}});
      if(!user)return json(res,401,{error:'Não foi possível carregar o teu perfil.'});
      audit(db,req,user.id,'supabase_login');
      write(db);
      return json(res,200,{token:data.session.access_token,user:publicUser(user,db)});
    }
    if(u.pathname==='/api/me'&&req.method==='GET'){const user=await auth(db,req);if(!user)return json(res,401,{error:'Não autenticado.'});const pu=publicUser(user,db);return json(res,200,{...pu,user:pu});}
    if(u.pathname==='/api/me/score'&&req.method==='GET'){
      const user=await auth(db,req); if(!user)return json(res,401,{error:'Não autenticado.'});
      const completed=db.orders.filter(o=>o.status==='Concluído'&&Array.isArray(o.items)&&o.items.some(i=>i.sellerId===user.id||i.seller===user.name)).length;
      const reviews=db.reviews.filter(r=>r.sellerId===user.id);
      const avg=reviews.length?reviews.reduce((a,r)=>a+Number(r.rating||0),0)/reviews.length:0;
      const cancellations=db.orders.filter(o=>o.sellerId===user.id&&o.status==='Cancelado').length;
      const complaints=Number(user.complaints||0); const response=Number(user.responseTimeMinutes||0);
      const factors={base:50,completedOrders:Math.min(25,completed*3),reviews:reviews.length?Math.round((avg/5)*20):0,cancellations:-Math.min(15,cancellations*4),complaints:-Math.min(20,complaints*8),responseTime:response>0&&response<=30?5:(response>30&&response<=120?3:(response>720?-5:0)),verified:user.verified?5:0};
      const score=calculateScore(db,user);
      return json(res,200,{score,scoreLabel:scoreLabel(score),reviewCount:reviews.length,averageRating:Number(avg.toFixed(2)),factors});
    }
    if(u.pathname==='/api/me/role'&&req.method==='PATCH'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Não autenticado.'});
      if(!supabaseAuth)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const b=await body(req);
      if(!['buyer','seller'].includes(b.role))return json(res,400,{error:'Tipo de conta inválido.'});

      // A alteração do próprio perfil é feita com o token do utilizador.
      // Assim a política RLS profiles_update_own aplica-se corretamente:
      // auth.uid() = id.
      const accessToken=(req.headers.authorization||'').replace('Bearer ','').trim();
      if(!accessToken)return json(res,401,{error:'Sessão inválida.'});

      const supabaseUser=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
        global:{headers:{Authorization:`Bearer ${accessToken}`}},
        auth:{persistSession:false,autoRefreshToken:false}
      });

      const { data: updatedProfile, error }=await supabaseUser
        .from('profiles')
        .update({role:b.role})
        .eq('id',user.id)
        .select('id,full_name,phone,avatar_url,role,verified,score,created_at,updated_at')
        .maybeSingle();

      if(error)return json(res,403,{error:error.message||'Não foi possível mudar o tipo de conta.'});
      if(!updatedProfile)return json(res,403,{error:'O teu perfil não foi atualizado. Verifica as permissões da tua conta.'});

      user.role=String(updatedProfile.role||b.role);
      user.name=String(updatedProfile.full_name||user.name||'Utilizador');
      user.phone=String(updatedProfile.phone||user.phone||'');
      user.avatar=String(updatedProfile.avatar_url||user.avatar||'');
      user.verified=!!updatedProfile.verified;
      user.score=Number(updatedProfile.score||user.score||50);

      const i=db.users.findIndex(x=>x.id===user.id);
      if(i>=0)db.users[i]={...db.users[i],...user};else db.users.push(user);
      audit(db,req,user.id,'role_changed',{role:user.role});write(db);
      const pu=publicUser(user,db);return json(res,200,{...pu,user:pu,ok:true});
    }

    // ============================================================
    // SUPABASE MIGRATION — STORES + PRODUCTS
    // Supabase is the source of truth for core store/product fields.
    // db.json remains a compatibility mirror for legacy fields/modules.
    // ============================================================
    if(u.pathname==='/api/stores'&&req.method==='GET'){
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const ownerId=String(u.query.ownerId||'').trim();
      if(!ownerId)return json(res,400,{error:'Vendedor inválido.'});
      const [{data:st,error:storeError},{data:products,error:productsError}]=await Promise.all([
        supabaseAdmin.from('stores').select('id,owner_id,name,slug,description,logo_url,location,phone,verified,created_at,updated_at').eq('owner_id',ownerId).maybeSingle(),
        supabaseAdmin.from('products').select('id,seller_id,store_id,category_id,name,slug,description,price,stock,status,views,created_at,updated_at').eq('seller_id',ownerId).order('created_at',{ascending:false})
      ]);
      if(storeError)return json(res,500,{error:'Não foi possível carregar a loja.',details:storeError.message});
      if(productsError)return json(res,500,{error:'Não foi possível carregar os produtos da loja.',details:productsError.message});
      const {profilesById,storesByOwner}=await supabaseSellerMaps([ownerId]);
      const ownerProfile=profilesById.get(ownerId)||null;
      const legacyStore=db.stores.find(x=>String(x.ownerId)===ownerId)||null;
      const store=supabaseStoreToPublic(st,legacyStore);
      const categoryMap=await supabaseCategoryMap((products||[]).map(p=>p.category_id));
      const publicProducts=(products||[]).map(p=>{
        const legacy=db.products.find(x=>String(x.id)===String(p.id));
        return supabaseProductToPublic(p,ownerProfile,storesByOwner.get(ownerId)||st,legacy,categoryMap.get(String(p.category_id)));
      });
      for(const p of publicProducts)mirrorProductToLegacy(db,p);
      if(store)mirrorStoreToLegacy(db,store);
      write(db);
      const owner=ownerProfile?publicUser({...ownerProfile,id:ownerId,name:ownerProfile.full_name||'Vendedor',avatar:ownerProfile.avatar_url||'',verified:!!ownerProfile.verified,score:Number(ownerProfile.score||50),role:ownerProfile.role||'seller'},db):null;
      return json(res,200,{store,stores:store?[store]:[],owner,products:publicProducts});
    }

    if(u.pathname==='/api/stores'&&(req.method==='POST'||req.method==='PATCH')){
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(user.role!=='seller')return json(res,403,{error:'Muda a tua conta para Vendedor.'});
      const b=await body(req,6*1024*1024);
      const {data:existing,error:findError}=await supabaseAdmin.from('stores').select('id,owner_id,name,slug,description,logo_url,location,phone,verified,created_at,updated_at').eq('owner_id',user.id).maybeSingle();
      if(findError)return json(res,500,{error:'Não foi possível consultar a loja.',details:findError.message});
      const now=new Date().toISOString();
      const payload={
        owner_id:user.id,
        name:b.name!==undefined?String(b.name).trim():String(existing?.name||user.name+' Store').trim(),
        slug:b.slug!==undefined?slugify(b.slug):String(existing?.slug||storeSlug(b.name||existing?.name||user.name+' Store',user.id)),
        description:b.description!==undefined?String(b.description).trim():String(existing?.description||''),
        logo_url:b.logo!==undefined?String(b.logo||''):String(existing?.logo_url||''),
        location:b.location!==undefined?String(b.location||'').trim():String(existing?.location||''),
        phone:b.phone!==undefined?String(b.phone||'').trim():String(existing?.phone||''),
        verified:existing?.verified===true
      };
      if(payload.name.length<2)return json(res,400,{error:'O nome da loja deve ter pelo menos 2 caracteres.'});
      if(payload.name.length>100)return json(res,400,{error:'O nome da loja é demasiado longo.'});
      if(payload.description.length>500)return json(res,400,{error:'A descrição deve ter no máximo 500 caracteres.'});
      if(payload.location.length>200)return json(res,400,{error:'A localização deve ter no máximo 200 caracteres.'});
      if(payload.phone.length>40)return json(res,400,{error:'O telefone deve ter no máximo 40 caracteres.'});
      if(payload.logo_url&&!payload.logo_url.startsWith('data:image/'))return json(res,400,{error:'O logotipo deve ser uma imagem válida.'});
      if(payload.logo_url.length>5500000)return json(res,400,{error:'A imagem da loja é demasiado grande.'});
      let result;
      if(existing){
        result=await supabaseAdmin.from('stores').update({...payload,updated_at:now}).eq('id',existing.id).eq('owner_id',user.id).select('id,owner_id,name,slug,description,logo_url,location,phone,verified,created_at,updated_at').single();
      }else{
        result=await supabaseAdmin.from('stores').insert({...payload,id:crypto.randomUUID(),created_at:now,updated_at:now}).select('id,owner_id,name,slug,description,logo_url,location,phone,verified,created_at,updated_at').single();
      }
      if(result.error)return json(res,500,{error:'Não foi possível guardar a loja no Supabase.',details:result.error.message});
      const store=supabaseStoreToPublic(result.data,db.stores.find(x=>String(x.id)===String(result.data.id)));
      mirrorStoreToLegacy(db,store);write(db);
      return json(res,200,{...store,store,ok:true});
    }

    if(u.pathname==='/api/products'&&req.method==='GET'){
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const q=String(u.query.search||'').trim().toLowerCase();
      const cat=String(u.query.cat||'Todos').trim();
      const sort=String(u.query.sort||'').trim();
      let query=supabaseAdmin.from('products').select('id,seller_id,store_id,category_id,name,slug,description,price,stock,status,views,created_at,updated_at');
      if(cat&&cat!=='Todos'){
        const category=await supabaseCategory(cat);
        if(!category)return json(res,200,[]);
        query=query.eq('category_id',category.id);
      }
      if(sort==='low')query=query.order('price',{ascending:true});
      else if(sort==='high')query=query.order('price',{ascending:false});
      else query=query.order('created_at',{ascending:false});
      const {data:rows,error}=await query;
      if(error)return json(res,500,{error:'Não foi possível carregar os produtos do Supabase.',details:error.message});
      let list=rows||[];
      if(q)list=list.filter(p=>{
        const legacy=db.products.find(x=>String(x.id)===String(p.id));
        return (String(p.name||'')+' '+String(p.description||'')+' '+String(legacy?.cat||legacy?.category||'')).toLowerCase().includes(q);
      });
      const {profilesById,storesByOwner}=await supabaseSellerMaps(list.map(p=>p.seller_id));
      const categoryMap=await supabaseCategoryMap(list.map(p=>p.category_id));
      const out=list.map(p=>{
        const legacy=db.products.find(x=>String(x.id)===String(p.id));
        return supabaseProductToPublic(p,profilesById.get(String(p.seller_id)),storesByOwner.get(String(p.seller_id)),legacy,categoryMap.get(String(p.category_id)));
      });
      for(const p of out)mirrorProductToLegacy(db,p);
      write(db);
      return json(res,200,out);
    }

    const pm=u.pathname.match(/^\/api\/products\/([^/]+)$/);

    if(pm&&req.method==='GET'){
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const id=decodeURIComponent(pm[1]);
      const {data:p,error}=await supabaseAdmin.from('products').select('id,seller_id,store_id,category_id,name,slug,description,price,stock,status,views,created_at,updated_at').eq('id',id).maybeSingle();
      if(error)return json(res,500,{error:'Não foi possível carregar o produto.',details:error.message});
      if(!p)return json(res,404,{error:'Produto não encontrado.'});
      const {profilesById,storesByOwner}=await supabaseSellerMaps([p.seller_id]);
      const categoryMap=await supabaseCategoryMap([p.category_id]);
      const legacy=db.products.find(x=>String(x.id)===String(p.id));
      const out=supabaseProductToPublic(p,profilesById.get(String(p.seller_id)),storesByOwner.get(String(p.seller_id)),legacy,categoryMap.get(String(p.category_id)));
      mirrorProductToLegacy(db,out);write(db);
      return json(res,200,out);
    }

    if(u.pathname==='/api/products'&&req.method==='POST'){
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const user=await auth(db,req);
      if(!user)return json(res,401,{error:'Inicia sessão para publicar.'});
      if(user.role!=='seller')return json(res,403,{error:'Muda a tua conta para Vendedor antes de publicar.'});
      const b=await body(req,10*1024*1024);
      const name=String(b.name||'').trim();
      const categoryValue=String(b.categoryId||b.cat||b.category||'').trim();
      const price=Number(b.price||0);
      const stock=Math.max(0,Number.isFinite(Number(b.stock))?Math.floor(Number(b.stock)):0);
      const description=String(b.description||'').trim();
      const photos=Array.isArray(b.photos)?b.photos.slice(0,10):[];
      const condition=String(b.condition||'Usado').trim();
      const location=String(b.location||'').trim();
      if(!name||price<=0||!categoryValue)return json(res,400,{error:'Preenche nome, preço e categoria.'});
      if(!validPhotos(photos))return json(res,400,{error:'O produto precisa de pelo menos 5 fotos reais. Podes adicionar até 10.'});
      if(description.length<15)return json(res,400,{error:'A descrição é obrigatória e deve ter pelo menos 15 caracteres.'});
      if(description.length>5000)return json(res,400,{error:'A descrição é demasiado longa.'});
      if(condition.length<2||condition.length>50)return json(res,400,{error:'A condição do produto é inválida.'});
      if(location.length>200)return json(res,400,{error:'A localização deve ter no máximo 200 caracteres.'});
      const category=await supabaseCategory(categoryValue);
      if(!category)return json(res,400,{error:'Categoria não encontrada ou inativa.'});
      const {data:store,error:storeError}=await supabaseAdmin.from('stores').select('id,name,logo_url').eq('owner_id',user.id).maybeSingle();
      if(storeError)return json(res,500,{error:'Não foi possível verificar a loja do vendedor.',details:storeError.message});
      if(!store)return json(res,400,{error:'Cria a tua loja antes de publicar produtos.'});
      const now=new Date().toISOString();
      const payload={
        id:crypto.randomUUID(),
        seller_id:user.id,
        store_id:store.id,
        category_id:category.id,
        name,
        slug:productSlug(name),
        description,
        price,
        stock,
        status:'active',
        views:0,
        created_at:now,
        updated_at:now
      };
      const {data:p,error}=await supabaseAdmin.from('products').insert(payload).select('id,seller_id,store_id,category_id,name,slug,description,price,stock,status,views,created_at,updated_at').single();
      if(error)return json(res,500,{error:'Não foi possível publicar o produto no Supabase.',details:error.message});
      const {profilesById,storesByOwner}=await supabaseSellerMaps([p.seller_id]);
      const out=supabaseProductToPublic(p,profilesById.get(String(p.seller_id)),storesByOwner.get(String(p.seller_id)),{emoji:String(b.emoji||'📦'),rating:5,score:Number(user.score||50),seller:user.name,cat:category.name,category:category.name,condition,location,photos},category);
      mirrorProductToLegacy(db,out);write(db);
      return json(res,201,out);
    }

    if(pm&&req.method==='PATCH'){
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const user=await auth(db,req);
      if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(user.role!=='seller')return json(res,403,{error:'Apenas vendedores podem editar produtos.'});
      const id=decodeURIComponent(pm[1]);
      const {data:existing,error:findError}=await supabaseAdmin.from('products').select('id,seller_id,store_id,category_id,name,slug,description,price,stock,status,views,created_at,updated_at').eq('id',id).maybeSingle();
      if(findError)return json(res,500,{error:'Não foi possível consultar o produto.',details:findError.message});
      if(!existing)return json(res,404,{error:'Produto não encontrado.'});
      if(String(existing.seller_id)!==String(user.id))return json(res,403,{error:'Sem permissão para editar este produto.'});
      const legacy=db.products.find(x=>String(x.id)===String(existing.id))||{};
      const b=await body(req,10*1024*1024);
      const name=b.name!==undefined?String(b.name).trim():existing.name;
      const categoryValue=b.categoryId!==undefined?String(b.categoryId).trim():(b.cat!==undefined?String(b.cat).trim():(b.category!==undefined?String(b.category).trim():String(existing.category_id||'')));
      const price=b.price!==undefined?Number(b.price):Number(existing.price);
      const description=b.description!==undefined?String(b.description).trim():String(existing.description||'');
      const stock=b.stock!==undefined?Math.max(0,Number.isFinite(Number(b.stock))?Math.floor(Number(b.stock)):0):Number(existing.stock||0);
      const status=b.status!==undefined?String(b.status||'active'):String(existing.status||'active');
      const condition=b.condition!==undefined?String(b.condition||'Usado').trim():String(legacy.condition||'Usado');
      const location=b.location!==undefined?String(b.location||'').trim():String(legacy.location||'');
      const photos=b.photos!==undefined?(Array.isArray(b.photos)?b.photos.slice(0,10):[]):(Array.isArray(legacy.photos)?legacy.photos:[]);
      if(!name||price<=0||!categoryValue)return json(res,400,{error:'Preenche nome, preço e categoria.'});
      if(!validPhotos(photos))return json(res,400,{error:'O produto precisa de pelo menos 5 fotos reais. Podes adicionar até 10.'});
      if(description.length<15)return json(res,400,{error:'A descrição é obrigatória e deve ter pelo menos 15 caracteres.'});
      if(description.length>5000)return json(res,400,{error:'A descrição é demasiado longa.'});
      if(condition.length<2||condition.length>50)return json(res,400,{error:'A condição do produto é inválida.'});
      if(location.length>200)return json(res,400,{error:'A localização deve ter no máximo 200 caracteres.'});
      const category=await supabaseCategory(categoryValue);
      if(!category)return json(res,400,{error:'Categoria não encontrada ou inativa.'});
      const patch={name,price,category_id:category.id,description,stock,status,updated_at:new Date().toISOString()};
      if(b.slug!==undefined)patch.slug=slugify(b.slug)||productSlug(name);
      else if(!existing.slug)patch.slug=productSlug(name);
      const {data:p,error}=await supabaseAdmin.from('products').update(patch).eq('id',id).eq('seller_id',user.id).select('id,seller_id,store_id,category_id,name,slug,description,price,stock,status,views,created_at,updated_at').single();
      if(error)return json(res,500,{error:'Não foi possível atualizar o produto.',details:error.message});
      const out=supabaseProductToPublic(p,undefined,undefined,{...legacy,emoji:b.emoji!==undefined?String(b.emoji||'📦'):legacy.emoji,rating:legacy.rating||5,score:legacy.score||50,seller:legacy.seller||user.name,condition,location,photos},category);
      const {profilesById,storesByOwner}=await supabaseSellerMaps([p.seller_id]);
      const finalOut=supabaseProductToPublic(p,profilesById.get(String(p.seller_id)),storesByOwner.get(String(p.seller_id)),{...legacy,emoji:b.emoji!==undefined?String(b.emoji||'📦'):legacy.emoji,rating:legacy.rating||5,score:legacy.score||50,seller:legacy.seller||user.name,condition,location,photos},category);
      mirrorProductToLegacy(db,finalOut);write(db);
      return json(res,200,finalOut);
    }

    const fav=u.pathname.match(/^\/api\/favorites\/([^/]+)$/);
    if(u.pathname==='/api/favorites'&&req.method==='GET'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const {data:rows,error}=await supabaseAdmin.from('favorites').select('product_id,created_at').eq('user_id',user.id).order('created_at',{ascending:false});
      if(error)return json(res,500,{error:'Não foi possível carregar os favoritos.',details:error.message});
      const ids=(rows||[]).map(x=>String(x.product_id));
      if(!ids.length)return json(res,200,[]);
      const {data:products,error:pe}=await supabaseAdmin.from('products').select('id,seller_id,store_id,category_id,name,slug,description,price,stock,status,views,created_at,updated_at').in('id',ids);
      if(pe)return json(res,500,{error:'Não foi possível carregar os produtos favoritos.',details:pe.message});
      const {profilesById,storesByOwner}=await supabaseSellerMaps((products||[]).map(p=>p.seller_id));
      const categoryMap=await supabaseCategoryMap((products||[]).map(p=>p.category_id));
      const byId=new Map((products||[]).map(p=>[String(p.id),p]));
      const out=ids.map(id=>byId.get(id)).filter(Boolean).map(p=>{const legacy=db.products.find(x=>String(x.id)===String(p.id));return supabaseProductToPublic(p,profilesById.get(String(p.seller_id)),storesByOwner.get(String(p.seller_id)),legacy,categoryMap.get(String(p.category_id)));});
      for(const p of out)mirrorProductToLegacy(db,p);write(db);return json(res,200,out);
    }
    if(fav&&req.method==='POST'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const productId=decodeURIComponent(fav[1]);
      const {data:product,error:pe}=await supabaseAdmin.from('products').select('id').eq('id',productId).maybeSingle();
      if(pe)return json(res,500,{error:'Não foi possível consultar o produto.',details:pe.message});
      if(!product)return json(res,404,{error:'Produto não encontrado.'});
      const {error}=await supabaseAdmin.from('favorites').upsert({user_id:user.id,product_id:productId},{onConflict:'user_id,product_id'});
      if(error)return json(res,500,{error:'Não foi possível guardar o favorito.',details:error.message});
      return json(res,201,{ok:true});
    }
    if(fav&&req.method==='DELETE'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const productId=decodeURIComponent(fav[1]);
      const {error}=await supabaseAdmin.from('favorites').delete().eq('user_id',user.id).eq('product_id',productId);
      if(error)return json(res,500,{error:'Não foi possível remover o favorito.',details:error.message});
      return json(res,200,{ok:true});
    }

    const cartItem=u.pathname.match(/^\/api\/cart\/([^/]+)$/);
    if(u.pathname==='/api/cart'&&req.method==='GET'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const {data:rows,error}=await supabaseAdmin.from('cart_items').select('id,product_id,quantity,created_at').eq('user_id',user.id).order('created_at',{ascending:true});
      if(error)return json(res,500,{error:'Não foi possível carregar o carrinho.',details:error.message});
      const ids=(rows||[]).map(x=>String(x.product_id));
      if(!ids.length)return json(res,200,[]);
      const {data:products,error:pe}=await supabaseAdmin.from('products').select('id,seller_id,store_id,category_id,name,slug,description,price,stock,status,views,created_at,updated_at').in('id',ids);
      if(pe)return json(res,500,{error:'Não foi possível carregar os produtos do carrinho.',details:pe.message});
      const {profilesById,storesByOwner}=await supabaseSellerMaps((products||[]).map(p=>p.seller_id));
      const categoryMap=await supabaseCategoryMap((products||[]).map(p=>p.category_id));
      const byId=new Map((products||[]).map(p=>[String(p.id),p]));
      const out=(rows||[]).map(row=>{const p=byId.get(String(row.product_id));if(!p)return null;const legacy=db.products.find(x=>String(x.id)===String(p.id));const product=supabaseProductToPublic(p,profilesById.get(String(p.seller_id)),storesByOwner.get(String(p.seller_id)),legacy,categoryMap.get(String(p.category_id)));return {id:String(row.id),userId:user.id,productId:String(row.product_id),qty:Number(row.quantity||1),quantity:Number(row.quantity||1),createdAt:row.created_at,product};}).filter(Boolean);
      for(const item of out)mirrorProductToLegacy(db,item.product);write(db);return json(res,200,out);
    }
    if(u.pathname==='/api/cart'&&req.method==='POST'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const b=await body(req);const productId=String(b.productId||'').trim();
      const {data:p,error:pe}=await supabaseAdmin.from('products').select('id,stock,status').eq('id',productId).maybeSingle();
      if(pe)return json(res,500,{error:'Não foi possível consultar o produto.',details:pe.message});
      if(!p)return json(res,404,{error:'Produto não encontrado.'});
      if(String(p.status||'active')!=='active')return json(res,400,{error:'Este produto não está disponível.'});
      const qty=Math.max(1,Math.min(99,Math.floor(Number(b.qty||b.quantity||1))));
      const {data:existing,error:ee}=await supabaseAdmin.from('cart_items').select('id,quantity').eq('user_id',user.id).eq('product_id',productId).maybeSingle();
      if(ee)return json(res,500,{error:'Não foi possível consultar o carrinho.',details:ee.message});
      const next=Math.min(99,Math.max(1,Number(existing?.quantity||0)+qty));
      if(Number(p.stock||0)>0&&next>Number(p.stock))return json(res,400,{error:'Quantidade superior ao stock disponível.'});
      let result;
      if(existing)result=await supabaseAdmin.from('cart_items').update({quantity:next}).eq('id',existing.id).eq('user_id',user.id).select('id,product_id,quantity,created_at').single();
      else result=await supabaseAdmin.from('cart_items').insert({user_id:user.id,product_id:productId,quantity:qty}).select('id,product_id,quantity,created_at').single();
      if(result.error)return json(res,500,{error:'Não foi possível guardar no carrinho.',details:result.error.message});
      return json(res,201,{ok:true,id:result.data.id,productId:productId,qty:Number(result.data.quantity),quantity:Number(result.data.quantity)});
    }
    if(cartItem&&req.method==='DELETE'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const productId=decodeURIComponent(cartItem[1]);
      const {error}=await supabaseAdmin.from('cart_items').delete().eq('user_id',user.id).eq('product_id',productId);
      if(error)return json(res,500,{error:'Não foi possível remover do carrinho.',details:error.message});
      return json(res,200,{ok:true});
    }

    if(u.pathname==='/api/orders'&&req.method==='POST'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão para comprar.'});
      const b=await body(req); const rawItems=Array.isArray(b.items)?b.items:[];
      if(!rawItems.length)return json(res,400,{error:'O carrinho está vazio.'});
      const items=[]; let total=0;
      for(const raw of rawItems){
        const product=db.products.find(p=>p.id===String(raw.productId||raw.id||''));
        const quantity=Math.max(1,Math.min(99,Number(raw.quantity||1)));
        if(!product)continue;
        total+=Number(product.price||0)*quantity;
        items.push({productId:product.id,productName:product.name,name:product.name,price:Number(product.price||0),quantity,sellerId:product.sellerId,seller:product.seller||'Vendedor',cat:product.cat,photos:Array.isArray(product.photos)?product.photos.slice(0,1):[]});
      }
      if(!items.length)return json(res,400,{error:'Nenhum produto válido no carrinho.'});
      const paymentMethods=['multicaixa_express','bank_transfer','card'];
      const deliveryMethods=['delivery','pickup'];
      const paymentMethod=String(b.paymentMethod||'');
      const deliveryMethod=String(b.deliveryMethod||'delivery');
      const deliveryAddress=String(b.deliveryAddress||'').trim().slice(0,500);
      const recipient=String(b.recipient||user.name||'').trim().slice(0,120);
      const phone=String(b.phone||'').trim().slice(0,40);
      if(!paymentMethods.includes(paymentMethod))return json(res,400,{error:'Método de pagamento inválido.'});
      if(!deliveryMethods.includes(deliveryMethod))return json(res,400,{error:'Forma de entrega inválida.'});
      if(!deliveryAddress)return json(res,400,{error:'Indica a morada ou ponto de entrega.'});
      const deliveryFee=deliveryMethod==='delivery'?1500:0;
      const grandTotal=total+deliveryFee;
      const now=new Date().toISOString();
      const order={id:'KL-'+Date.now().toString().slice(-7),userId:user.id,items,total:grandTotal,subtotal:total,deliveryFee,payment:{method:paymentMethod,status:'Pendente',reference:null},delivery:{method:deliveryMethod,address:deliveryAddress,fee:deliveryFee,recipient,phone},status:'Pendente',statusHistory:[{status:'Pendente',at:now}],createdAt:now};
      db.orders.unshift(order);
      const sellerIds=[...new Set(items.map(i=>i.sellerId).filter(Boolean))];
      ensureDeliveryForOrder(db,order);
        for(const sid of sellerIds){
        const share=calculateSellerShare(order,sid); const wallet=ensureWallet(db,sid);
        wallet.pending=Number(wallet.pending||0)+share.net;
        addWalletTx(db,sid,'sale_pending',share.net,`Venda #${String(order.id).slice(-8)} pendente de entrega`,{orderId:order.id,gross:share.gross,commission:share.commission});
        notify(db,sid,'sale','Novo pedido',`Recebeste um novo pedido #${String(order.id).slice(-8)}.`,{orderId:order.id});
      }
      write(db);return json(res,201,order);
    }
    if(u.pathname==='/api/orders'&&req.method==='GET'){const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão para ver pedidos.'});return json(res,200,db.orders.filter(x=>x.userId===user.id));}

    // Kuanza Score V1.2: avaliações reais de compradores sobre vendedores/produtos.
    if(u.pathname==='/api/notifications'&&req.method==='GET'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      const list=db.notifications.filter(n=>n.userId===user.id).slice(0,50);
      return json(res,200,{items:list,unread:list.filter(n=>!n.read).length});
    }
    const nr=u.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if(nr&&req.method==='PATCH'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      const n=db.notifications.find(x=>x.id===nr[1]&&x.userId===user.id);
      if(!n)return json(res,404,{error:'Notificação não encontrada.'});
      n.read=true;write(db);return json(res,200,n);
    }
    if(u.pathname==='/api/notifications/read-all'&&req.method==='PATCH'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      db.notifications.filter(n=>n.userId===user.id).forEach(n=>n.read=true);write(db);return json(res,200,{ok:true});
    }
    if(u.pathname==='/api/wallet'&&req.method==='GET'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      const summary=walletSummary(db,user.id);write(db);return json(res,200,summary);
    }
    if(u.pathname==='/api/wallet/transactions'&&req.method==='GET'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      return json(res,200,db.walletTransactions.filter(x=>x.userId===user.id).slice(0,100));
    }
    if(u.pathname==='/api/wallet/withdraw'&&req.method==='POST'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      const b=await body(req);const amount=Math.floor(Number(b.amount||0));
      if(amount<=0)return json(res,400,{error:'Valor de levantamento inválido.'});
      const wallet=ensureWallet(db,user.id);
      if(amount>wallet.available)return json(res,400,{error:'Saldo disponível insuficiente.'});
      if(amount<1000)return json(res,400,{error:'O levantamento mínimo é Kz 1.000.'});
      wallet.available-=amount;wallet.totalWithdrawn=Number(wallet.totalWithdrawn||0)+amount;
      const tx=addWalletTx(db,user.id,'withdrawal_request',-amount,'Pedido de levantamento criado',{amount,status:'Pendente'});
      notify(db,user.id,'wallet','Levantamento solicitado',`Pedido de levantamento de Kz ${amount.toLocaleString('pt-AO')} criado.`,{transactionId:tx.id,amount});
      write(db);return json(res,201,{ok:true,status:'Pendente',amount,transaction:tx,wallet:walletSummary(db,user.id)});
    }
    if(u.pathname==='/api/disputes'&&req.method==='GET'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      return json(res,200,db.disputes.filter(d=>d.userId===user.id||d.sellerId===user.id));
    }
    if(u.pathname==='/api/disputes'&&req.method==='POST'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      const b=await body(req);const orderId=String(b.orderId||'');const order=db.orders.find(o=>String(o.id)===orderId&&o.userId===user.id);
      if(!order)return json(res,404,{error:'Pedido não encontrado.'});
      const reason=String(b.reason||'').trim();
      const description=String(b.description||'').trim();
      const allowed=['Produto não recebido','Produto diferente do anunciado','Problema com vendedor','Outro'];
      if(!allowed.includes(reason))return json(res,400,{error:'Motivo inválido.'});
      if(description.length<10)return json(res,400,{error:'Explica o problema com pelo menos 10 caracteres.'});
      if(db.disputes.some(d=>d.orderId===orderId&&d.userId===user.id&&d.status==='Aberta'))return json(res,409,{error:'Já existe uma reclamação aberta para este pedido.'});
      const sellerId=Array.isArray(order.items)&&order.items[0]?.sellerId||null;
      const dispute={id:'DSP-'+Date.now().toString().slice(-7),orderId,userId:user.id,sellerId,reason,description,status:'Aberta',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      db.disputes.unshift(dispute);
      user.complaints=Number(user.complaints||0)+1;
      if(sellerId)notify(db,sellerId,'dispute','Nova reclamação',`Existe uma reclamação no pedido #${String(orderId).slice(-8)}.`,{orderId,disputeId:dispute.id});
      write(db);return json(res,201,dispute);
    }

    // V1.3 seller dashboard
    if(u.pathname==='/api/seller/dashboard'&&req.method==='GET'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(user.role!=='seller')return json(res,403,{error:'Muda a tua conta para Vendedor.'});
      const period=['7','30','90','all'].includes(String(u.query.period||''))?String(u.query.period):'30';
      const cutoff=period==='all'?0:Date.now()-Number(period)*86400000;
      const entries=[];
      for(const order of db.orders){
        const t=Date.parse(order.createdAt||0); if(cutoff && (!t||t<cutoff))continue;
        const sellerItems=(Array.isArray(order.items)?order.items:[]).filter(i=>String(i.sellerId||'')===String(user.id));
        if(sellerItems.length)entries.push({order,sellerItems});
      }
      let gross=0,commission=0,pending=0,cancelled=0,totalProductsSold=0,totalSales=0,completedSales=0;
      const top=new Map(),history=[];
      for(const {order,sellerItems} of entries){
        const orderGross=sellerItems.reduce((sum,i)=>sum+Number(i.price||0)*Math.max(1,Number(i.quantity||1)),0);
        const status=String(order.status||'Pendente');
        if(status==='Cancelado'){cancelled++;history.push({orderId:order.id,status,revenue:0,netRevenue:0,createdAt:order.createdAt});continue;}
        gross+=orderGross; commission+=orderGross*0.10; totalSales++; totalProductsSold+=sellerItems.reduce((sum,i)=>sum+Math.max(1,Number(i.quantity||1)),0);
        const net=orderGross*0.90; const isPending=['Pendente','Confirmado','Em preparação','Enviado'].includes(status);
        if(isPending)pending+=net; else completedSales++;
        for(const i of sellerItems){const qty=Math.max(1,Number(i.quantity||1));const key=String(i.productId||i.productName||i.name||'produto');const prev=top.get(key)||{name:i.productName||i.name||'Produto',quantity:0,revenue:0};prev.quantity+=qty;prev.revenue+=Number(i.price||0)*qty;top.set(key,prev);}
        history.push({orderId:order.id,status,revenue:orderGross,netRevenue:net,createdAt:order.createdAt});
      }
      history.sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));
      const available=Math.max(0,gross-commission-pending);
      return json(res,200,{seller:publicUser(user,db),commissionPercent:10,summary:{grossRevenue:gross,netRevenue:gross-commission,pendingRevenue:pending,commission,availableBalance:available,cancelledSales:cancelled,totalSales,totalProductsSold,averageTicket:completedSales?available/completedSales:0},topProducts:[...top.values()].sort((a,b)=>b.revenue-a.revenue).slice(0,5),salesHistory:history});
    }

    if(u.pathname==='/api/seller/orders'&&req.method==='GET'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(user.role!=='seller')return json(res,403,{error:'Muda a tua conta para Vendedor.'});
      return json(res,200,db.orders.filter(o=>Array.isArray(o.items)&&o.items.some(i=>String(i.sellerId||'')===String(user.id))).map(o=>({...o,items:o.items.filter(i=>String(i.sellerId||'')===String(user.id))})));
    }

    if(u.pathname.startsWith('/api/seller/orders/')&&req.method==='PATCH'){
      const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(user.role!=='seller')return json(res,403,{error:'Muda a tua conta para Vendedor.'});
      const id=decodeURIComponent(u.pathname.split('/').pop()||''); const order=db.orders.find(o=>String(o.id)===id);
      if(!order)return json(res,404,{error:'Pedido não encontrado.'});
      if(!Array.isArray(order.items)||!order.items.some(i=>String(i.sellerId||'')===String(user.id)))return json(res,403,{error:'Este pedido não pertence às tuas vendas.'});
      const b=await body(req); const allowed=['Pendente','Confirmado','Em preparação','Enviado','Entregue','Cancelado'];
      if(!allowed.includes(String(b.status||'')))return json(res,400,{error:'Estado inválido.'});
      const next=String(b.status);const previous=order.status;
      order.status=next;order.updatedAt=new Date().toISOString();
      if(!Array.isArray(order.statusHistory))order.statusHistory=[];
      if(previous!==next)order.statusHistory.push({status:next,at:order.updatedAt});
      if(previous!==next){
        if(next==='Entregue') settleDeliveredOrder(db,order);
        if(next==='Cancelado' && !order.financials?.cancelled){
          const sellerIds=[...new Set((order.items||[]).map(i=>i.sellerId).filter(Boolean))];
          order.financials={...(order.financials||{}),cancelled:true,cancelledAt:new Date().toISOString()};
          for(const sid of sellerIds){
            const share=calculateSellerShare(order,sid);const wallet=ensureWallet(db,sid);
            wallet.pending=Math.max(0,Number(wallet.pending||0)-share.net);
            addWalletTx(db,sid,'sale_cancelled',-share.net,`Venda #${String(order.id).slice(-8)} cancelada`,{orderId:order.id,amount:share.net});
          }
        }
        notify(db,order.userId,'order','Pedido atualizado',`O pedido #${String(order.id).slice(-8)} está agora: ${next}.`,{orderId:order.id,status:next});
        const delivery=ensureDeliveryForOrder(db,order); const ds=deliveryStatusFromOrderStatus(next); if(delivery.status!==ds){delivery.status=ds;delivery.updatedAt=new Date().toISOString(); if(!Array.isArray(delivery.statusHistory))delivery.statusHistory=[]; delivery.statusHistory.push({status:ds,at:delivery.updatedAt}); notify(db,order.userId,'delivery','Entrega atualizada',`A entrega do pedido #${String(order.id).slice(-8)} está agora: ${ds}.`,{orderId:order.id,deliveryId:delivery.id,status:ds});}
      }
      write(db);return json(res,200,order);
    }

    if(u.pathname==='/api/deliveries'&&req.method==='GET'){
      const user=await auth(db,req); if(!user)return json(res,401,{error:'Inicia sessão.'});
      const list=db.deliveries.filter(d=>d.buyerId===user.id||d.sellerIds?.includes(user.id));
      return json(res,200,list.slice(0,100));
    }

    if(u.pathname.startsWith('/api/deliveries/')&&req.method==='GET'){
      const user=await auth(db,req); if(!user)return json(res,401,{error:'Inicia sessão.'});
      const id=decodeURIComponent(u.pathname.split('/').pop()||''); const d=db.deliveries.find(x=>x.id===id);
      if(!d)return json(res,404,{error:'Entrega não encontrada.'});
      if(d.buyerId!==user.id&&!d.sellerIds?.includes(user.id))return json(res,403,{error:'Sem permissão.'});
      return json(res,200,d);
    }

    if(u.pathname.startsWith('/api/deliveries/')&&req.method==='PATCH'){
      const user=await auth(db,req); if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(user.role!=='seller')return json(res,403,{error:'Apenas vendedores podem atualizar a entrega.'});
      const id=decodeURIComponent(u.pathname.split('/').pop()||''); const d=db.deliveries.find(x=>x.id===id);
      if(!d)return json(res,404,{error:'Entrega não encontrada.'});
      if(!d.sellerIds?.includes(user.id))return json(res,403,{error:'Sem permissão.'});
      const b=await body(req); const allowed=['A preparar','Recolhida','Em trânsito','Chegou à zona','Entregue','Cancelada']; const next=String(b.status||'');
      if(!allowed.includes(next))return json(res,400,{error:'Estado de entrega inválido.'});
      if(d.status!==next){d.status=next;d.updatedAt=new Date().toISOString();d.statusHistory.push({status:next,at:d.updatedAt}); const order=db.orders.find(o=>o.id===d.orderId); if(order&&next==='Entregue'){order.status='Entregue';order.updatedAt=d.updatedAt;if(!Array.isArray(order.statusHistory))order.statusHistory=[];order.statusHistory.push({status:'Entregue',at:d.updatedAt});settleDeliveredOrder(db,order);} if(d.buyerId)notify(db,d.buyerId,'delivery','Estado da entrega',`A entrega do pedido #${String(d.orderId).slice(-8)} está agora: ${next}.`,{orderId:d.orderId,deliveryId:d.id,status:next});}
      write(db); return json(res,200,d);
    }

    if(u.pathname==='/api/reviews'&&req.method==='GET'){
      const productId=String(u.query.productId||''); const sellerId=String(u.query.sellerId||'');
      let list=db.reviews.slice(); if(productId)list=list.filter(r=>r.productId===productId); if(sellerId)list=list.filter(r=>r.sellerId===sellerId);
      list=list.map(r=>({...r,buyerName:(db.users.find(x=>x.id===r.buyerId)||{}).name||'Utilizador'})).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
      return json(res,200,list);
    }
    if(u.pathname==='/api/reviews'&&req.method==='POST'){
      const user=await auth(db,req); if(!user)return json(res,401,{error:'Inicia sessão para avaliar.'});
      const b=await body(req); const productId=String(b.productId||''); const product=db.products.find(x=>x.id===productId);
      if(!product)return json(res,404,{error:'Produto não encontrado.'});
      if(product.sellerId===user.id)return json(res,400,{error:'Não podes avaliar o teu próprio produto.'});
      const rating=Math.round(Number(b.rating||0)); if(rating<1||rating>5)return json(res,400,{error:'A avaliação deve ser de 1 a 5 estrelas.'});
      if(db.reviews.some(r=>r.productId===productId&&r.buyerId===user.id))return json(res,409,{error:'Já avalieste este produto.'});
      const comment=String(b.comment||'').trim().slice(0,500);
      const review={id:crypto.randomUUID(),productId,sellerId:product.sellerId,buyerId:user.id,rating,comment,createdAt:new Date().toISOString()};
      db.reviews.unshift(review); const seller=db.users.find(x=>x.id===product.sellerId); if(seller){seller.score=calculateScore(db,seller);notify(db,seller.id,'review','Nova avaliação',`Recebeste uma nova avaliação de ${review.rating} estrelas.`,{productId:product.id,rating:review.rating});} write(db);
      return json(res,201,{...review,buyerName:user.name,sellerScore:seller?calculateScore(db,seller):null});
    }

    // Security & moderation.
    if(u.pathname==='/api/reports'&&req.method==='GET'){const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});return json(res,200,adminOnly(user)?db.reports.slice(0,200):db.reports.filter(r=>r.reporterId===user.id).slice(0,100));}
    if(u.pathname==='/api/reports'&&req.method==='POST'){const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});const b=await body(req,256*1024);const targetType=String(b.targetType||'user');if(!['user','product','order','conversation'].includes(targetType))return json(res,400,{error:'Tipo de denúncia inválido.'});const targetId=String(b.targetId||'').trim();const reason=String(b.reason||'').trim().slice(0,120);const description=String(b.description||'').trim().slice(0,1000);if(!targetId||!reason)return json(res,400,{error:'Indica o alvo e o motivo da denúncia.'});const r={id:'REP-'+crypto.randomUUID(),reporterId:user.id,targetType,targetId,reason,description,status:'Aberta',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};db.reports.unshift(r);if(targetType==='user'){const t=db.users.find(x=>x.id===targetId);if(t)t.complaints=Number(t.complaints||0)+1;}audit(db,req,user.id,'report_created',{reportId:r.id,targetType,targetId});write(db);return json(res,201,r);}
    const rr=u.pathname.match(/^\/api\/reports\/([^/]+)$/);if(rr&&req.method==='PATCH'){const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});if(!adminOnly(user))return json(res,403,{error:'Apenas administradores.'});const r=db.reports.find(x=>x.id===decodeURIComponent(rr[1]));if(!r)return json(res,404,{error:'Denúncia não encontrada.'});const b=await body(req,64*1024);const allowed=['Aberta','Em análise','Resolvida','Rejeitada'];if(!allowed.includes(String(b.status||'')))return json(res,400,{error:'Estado inválido.'});r.status=String(b.status);r.adminNote=String(b.adminNote||'').trim().slice(0,1000);r.updatedAt=new Date().toISOString();audit(db,req,user.id,'report_updated',{reportId:r.id,status:r.status});write(db);return json(res,200,r);}
    if(u.pathname==='/api/admin/security'&&req.method==='GET'){const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});if(!adminOnly(user))return json(res,403,{error:'Apenas administradores.'});return json(res,200,{events:db.securityEvents.slice(0,200),reports:db.reports.slice(0,200),blockedUsers:db.blockedUsers.slice(0,200)});}
    if(u.pathname==='/api/admin/block'&&req.method==='POST'){const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});if(!adminOnly(user))return json(res,403,{error:'Apenas administradores.'});const b=await body(req,64*1024);const targetId=String(b.userId||'').trim();if(!targetId||targetId===user.id)return json(res,400,{error:'Utilizador inválido.'});if(!db.users.some(x=>x.id===targetId))return json(res,404,{error:'Utilizador não encontrado.'});let bl=db.blockedUsers.find(x=>x.userId===targetId);if(!bl){bl={id:'BLK-'+crypto.randomUUID(),userId:targetId,active:true,reason:String(b.reason||'').trim().slice(0,500),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};db.blockedUsers.push(bl);}else{bl.active=b.active!==false;bl.reason=String(b.reason||bl.reason||'').trim().slice(0,500);bl.updatedAt=new Date().toISOString();}audit(db,req,user.id,bl.active?'user_blocked':'user_unblocked',{userId:targetId,reason:bl.reason});write(db);return json(res,200,bl);}

    // Chat: one private conversation between a buyer and seller, linked optionally to a product.
    if(u.pathname==='/api/conversations'&&req.method==='GET'){const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});const list=db.conversations.filter(c=>c.participants.includes(user.id)).map(c=>{const otherId=c.participants.find(id=>id!==user.id);const other=db.users.find(x=>x.id===otherId);const last=db.messages.filter(m=>m.conversationId===c.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];const product=c.productId?db.products.find(p=>p.id===c.productId):null;return {...c,other:publicUser(other,db),otherName:other?.name||other?.full_name||'',lastMessage:last||null,lastMessageText:last?(last.type==='offer'?`Proposta: Kz ${Number(last.amount||0).toLocaleString('pt-AO')}`:(last.text||'')):'',product:product?publicProduct(db,product):null,productName:product?.name||'Conversa Kuanza Line'};}).sort((a,b)=>new Date(b.lastMessage?.createdAt||b.createdAt)-new Date(a.lastMessage?.createdAt||a.createdAt));return json(res,200,list);}
    if(u.pathname==='/api/conversations'&&req.method==='POST'){const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});const b=await body(req);const sellerId=String(b.sellerId||'');if(!sellerId||sellerId===user.id)return json(res,400,{error:'Vendedor inválido.'});const seller=db.users.find(x=>x.id===sellerId);if(!seller)return json(res,404,{error:'Vendedor não encontrado.'});const key=conversationKey(user.id,sellerId);let c=db.conversations.find(x=>x.key===key&&String(x.productId||'')===String(b.productId||''));if(!c){c={id:crypto.randomUUID(),key,participants:[user.id,sellerId],productId:b.productId||null,createdAt:new Date().toISOString()};db.conversations.push(c);write(db);}return json(res,201,c);}
    const conv=u.pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if(conv&&req.method==='GET'){const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});const c=db.conversations.find(x=>x.id===conv[1]&&x.participants.includes(user.id));if(!c)return json(res,404,{error:'Conversa não encontrada.'});const other=db.users.find(x=>x.id===c.participants.find(id=>id!==user.id));const product=c.productId?db.products.find(p=>p.id===c.productId):null;const messages=db.messages.filter(m=>m.conversationId===c.id).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));return json(res,200,{conversation:{...c,other:publicUser(other,db),otherName:other?.name||other?.full_name||'',product:product?publicProduct(db,product):null,productName:product?.name||'Conversa Kuanza Line'},messages});}
    if(conv&&req.method==='POST'){const user=await auth(db,req);if(!user)return json(res,401,{error:'Inicia sessão.'});const c=db.conversations.find(x=>x.id===conv[1]&&x.participants.includes(user.id));if(!c)return json(res,404,{error:'Conversa não encontrada.'});const b=await body(req);const text=String(b.text||'').trim();const type=b.type==='offer'?'offer':'text';if(!text&&type==='text')return json(res,400,{error:'Escreve uma mensagem.'});if(type==='offer'&&(!Number(b.amount)||Number(b.amount)<=0))return json(res,400,{error:'Valor da oferta inválido.'});const m={id:crypto.randomUUID(),conversationId:c.id,senderId:user.id,type,text:text||('Oferta de '+Number(b.amount)+' Kz'),amount:type==='offer'?Number(b.amount):null,createdAt:new Date().toISOString()};db.messages.push(m);const recipient=c.participants.find(id=>id!==user.id);if(recipient)notify(db,recipient,'message','Nova mensagem',type==='offer'?`Recebeste uma proposta de ${Number(b.amount).toLocaleString('pt-PT')} Kz.`:'Recebeste uma nova mensagem.',{conversationId:c.id});write(db);return json(res,201,m);}

    const file=path.join(PUBLIC,u.pathname==='/'?'index.html':u.pathname.replace(/^\//,''));
    if(!file.startsWith(PUBLIC)||!fs.existsSync(file)||fs.statSync(file).isDirectory())return json(res,404,{error:'Not found'});
    const ext=path.extname(file),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin'});fs.createReadStream(file).pipe(res);
  }catch(e){console.error(e);if(!res.headersSent)json(res,500,{error:e.message||'Erro interno'});}
});

const PORT=Number(process.env.PORT||3000);server.listen(PORT,'0.0.0.0',()=>console.log(`Kuanza Line API running on port ${PORT} | Supabase Auth enabled: ${!!(supabaseAuth&&supabaseAdmin)}`));
function shutdown(signal){console.log(`Received ${signal}; shutting down Kuanza Line API.`);server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
