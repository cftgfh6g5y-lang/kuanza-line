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
const SUPABASE_AVATARS_BUCKET = String(process.env.SUPABASE_AVATARS_BUCKET || 'avatars').trim();

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

if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify({stores:[],products:demoProducts,orders:[],sessions:[],favorites:[],carts:[],conversations:[],messages:[],reviews:[],notifications:[],disputes:[],wallets:[],walletTransactions:[],deliveries:[],securityEvents:[],reports:[],blockedUsers:[]}, null, 2));

function read(){return JSON.parse(fs.readFileSync(DB,'utf8'));}
function write(d){fs.writeFileSync(DB,JSON.stringify(d,null,2));}
function ensureDB(db){
  for(const k of ['stores','products','orders','sessions','favorites','carts','conversations','messages','reviews','notifications','disputes','wallets','walletTransactions','deliveries','securityEvents','reports','blockedUsers']) if(!Array.isArray(db[k])) db[k]=[];
  for(const p of db.products){ if(!Array.isArray(p.photos)) p.photos=[]; if(!p.description) p.description='Produto disponível na Kuanza Line.'; }
  return db;
}
const ALLOWED_ORIGIN=String(process.env.KUANZA_ALLOWED_ORIGIN||'https://kuanza-line.onrender.com').trim();
const KUANZA_PAYMENT_BENEFICIARY=String(process.env.KUANZA_PAYMENT_BENEFICIARY||'Kuanza Line').trim();
const KUANZA_PAYMENT_BANK=String(process.env.KUANZA_PAYMENT_BANK||'').trim();
const KUANZA_PAYMENT_ACCOUNT=String(process.env.KUANZA_PAYMENT_ACCOUNT||'').trim();
const KUANZA_PAYMENT_IBAN=String(process.env.KUANZA_PAYMENT_IBAN||'').trim();
const KUANZA_PAYMENT_ENTITY=String(process.env.KUANZA_PAYMENT_ENTITY||'').trim();
function json(res,code,data){const origin=ALLOWED_ORIGIN||'*';res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(),microphone=(),geolocation=(self)','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
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

async function auth(req={}){
  const headers=req&&req.headers&&typeof req.headers==='object'?req.headers:{};
  const accessToken=String(headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
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
  let permanentAdmin=false;
  if(supabaseAdmin){
    try{
      const {data:adminRow,error:adminError}=await supabaseAdmin
        .from('admin_users')
        .select('user_id,active')
        .eq('user_id',au.id)
        .eq('active',true)
        .maybeSingle();
      if(!adminError&&adminRow)permanentAdmin=true;
    }catch(e){}
  }
  const effectiveRole=permanentAdmin?'admin':(['buyer','seller','admin'].includes(p.role)?p.role:'buyer');
  const user={
    id:au.id,
    name:String(p.full_name||au.user_metadata?.full_name||au.user_metadata?.name||au.email?.split('@')[0]||'Utilizador'),
    email:String(au.email||''),
    role:effectiveRole,
    score:Number(p.score||50),
    verified:!!p.verified,
    avatar:String(p.avatar_url||''),
    phone:String(p.phone||''),
    createdAt:p.created_at||au.created_at||new Date().toISOString()
  };

  // Users/Profile/Auth migration: Supabase Auth + profiles are now the only
  // source of truth for identity. No user is written to db.json.
  return user;
}
async function getProfileById(userId){
  if(!supabaseAdmin||!userId)return null;
  const {data,error}=await supabaseAdmin.from('profiles').select('id,full_name,phone,avatar_url,role,verified,score,created_at,updated_at').eq('id',String(userId)).maybeSingle();
  if(error)throw new Error('Não foi possível carregar o perfil: '+error.message);
  return data||null;
}
function profileToUser(profile){
  if(!profile)return null;
  return {id:String(profile.id),name:String(profile.full_name||'Utilizador'),email:'',role:['buyer','seller','admin'].includes(profile.role)?profile.role:'buyer',score:Number(profile.score||50),verified:!!profile.verified,avatar:String(profile.avatar_url||''),phone:String(profile.phone||''),createdAt:profile.created_at||new Date().toISOString()};
}
async function getPublicUserById(userId,db){
  const profile=await getProfileById(userId);
  if(!profile)return null;
  return publicUser(profileToUser(profile),db);
}
function calculateScore(db,u){
  if(!u)return 0;
  const completed=db.orders.filter(o=>o.status==='Concluído'&&Array.isArray(o.items)&&o.items.some(i=>i.sellerId===u.id||i.seller===u.name)).length;
  const reviews=db.reviews.filter(r=>r.sellerId===u.id);
  const avg=reviews.length?reviews.reduce((a,r)=>a+Number(r.rating||0),0)/reviews.length:0;
  const cancellations=db.orders.filter(o=>o.sellerId===u.id&&o.status==='Cancelado').length;
  const complaints=Array.isArray(db.reports)?db.reports.filter(r=>r.targetType==='user'&&String(r.targetId)===String(u.id)&&r.status!=='Rejeitada').length:0;
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
function publicProduct(db,p){
  return {
    ...p,
    seller:String(p.seller||'Vendedor'),
    verified:!!p.verified,
    rating:Number(p.rating||5),
    score:Number(p.score||50),
    storeName:String(p.storeName||p.seller||'Loja'),
    storeLogo:String(p.storeLogo||''),
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
function supabaseStoreToPublic(row){
  if(!row)return null;
  const verified=!!row.verified;
  return {
    id:String(row.id),
    ownerId:String(row.owner_id),
    name:String(row.name||''),
    slug:String(row.slug||''),
    logo:String(row.logo_url||row.logo||''),
    logoUrl:String(row.logo_url||row.logo||''),
    description:String(row.description||''),
    location:String(row.location||''),
    phone:String(row.phone||''),
    verified,
    approvalStatus:verified?'Aprovada':'Aguardando aprovação',
    rating:Number(row.rating||5),
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

async function supabaseOrderItemsMap(orderIds){
  const ids=[...new Set((orderIds||[]).filter(Boolean).map(String))];
  const map=new Map();
  if(!supabaseAdmin||!ids.length)return map;
  const {data,error}=await supabaseAdmin
    .from('order_items')
    .select('id,order_id,product_id,seller_id,product_name,unit_price,quantity,total,created_at')
    .in('order_id',ids)
    .order('created_at',{ascending:true});
  if(error)throw new Error('Não foi possível carregar os itens dos pedidos: '+error.message);
  for(const row of data||[]){
    const key=String(row.order_id);
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(row);
  }
  return map;
}

async function supabaseOrdersToPublic(rows,db){
  const orders=Array.isArray(rows)?rows:[];
  if(!orders.length)return [];
  const itemMap=await supabaseOrderItemsMap(orders.map(o=>o.id));
  const out=[];
  for(const row of orders){
    const orderItems=itemMap.get(String(row.id))||[];
    const items=orderItems.map(item=>{
      const legacy=db.products.find(p=>String(p.id)===String(item.product_id));
      return {
        id:String(item.id),
        productId:item.product_id?String(item.product_id):'',
        productName:String(item.product_name||legacy?.name||'Produto'),
        name:String(item.product_name||legacy?.name||'Produto'),
        price:Number(item.unit_price||0),
        unitPrice:Number(item.unit_price||0),
        quantity:Math.max(1,Number(item.quantity||1)),
        total:Number(item.total||0),
        sellerId:item.seller_id?String(item.seller_id):String(legacy?.sellerId||''),
        seller:String(legacy?.seller||'Vendedor'),
        cat:String(legacy?.cat||legacy?.category||''),
        photos:Array.isArray(legacy?.photos)?legacy.photos.slice(0,1):[]
      };
    });
    const legacy=db.orders.find(o=>String(o.id)===String(row.id));
    const financials=await getOrderFinancials(row.id);
    out.push({
      id:String(row.id),
      userId:row.buyer_id?String(row.buyer_id):'',
      items,
      total:Number(row.total||0),
      subtotal:Number(row.subtotal||0),
      deliveryFee:Number(row.delivery_fee||0),
      payment:{
        method:String(row.payment_method||''),
        status:String(row.payment_status||'Pendente'),
        reference:row.payment_reference||null,
        internalReference:(()=>{const h=Array.isArray(row.status_history)?row.status_history:[];const x=h.find(v=>v&&v.paymentInternalReference);return String(x?.paymentInternalReference||'').trim()||null;})(),
        instructions:null
      },
      delivery:{
        method:String(row.delivery_method||'delivery'),
        address:String(row.delivery_address||''),
        fee:Number(row.delivery_fee||0),
        recipient:String(row.recipient_name||''),
        phone:String(row.recipient_phone||'')
      },
      status:String(row.status||'Pendente'),
      statusHistory:Array.isArray(row.status_history)?row.status_history:[],
      createdAt:row.created_at||null,
      updatedAt:row.updated_at||null,
      ...(financials?{financials}:legacy?.financials?{financials:legacy.financials}:{}),
    });
  }
  for(const order of out){ if(order.payment)order.payment.instructions=paymentInstructions(order); }
  return out;
}

async function getSupabaseOrdersForBuyer(userId,db){
  if(!supabaseAdmin)throw new Error('Supabase não está configurado no servidor.');
  const {data,error}=await supabaseAdmin
    .from('orders')
    .select('id,buyer_id,status,subtotal,delivery_fee,total,delivery_method,recipient_name,recipient_phone,delivery_address,payment_method,payment_status,payment_reference,status_history,created_at,updated_at')
    .eq('buyer_id',String(userId))
    .order('created_at',{ascending:false});
  if(error)throw new Error('Não foi possível carregar os pedidos: '+error.message);
  return supabaseOrdersToPublic(data||[],db);
}

async function getSupabaseOrderForId(orderId,db){
  if(!supabaseAdmin)throw new Error('Supabase não está configurado no servidor.');
  const {data,error}=await supabaseAdmin
    .from('orders')
    .select('id,buyer_id,status,subtotal,delivery_fee,total,delivery_method,recipient_name,recipient_phone,delivery_address,payment_method,payment_status,payment_reference,status_history,created_at,updated_at')
    .eq('id',String(orderId))
    .maybeSingle();
  if(error)throw new Error('Não foi possível consultar o pedido: '+error.message);
  if(!data)return null;
  const list=await supabaseOrdersToPublic([data],db);
  return list[0]||null;
}

async function mirrorOrderToLegacy(db,order){
  if(!order)return;
  const i=db.orders.findIndex(x=>String(x.id)===String(order.id));
  if(i>=0)db.orders[i]={...db.orders[i],...order};
  else db.orders.unshift({...order});
}

async function createSupabaseOrder(db,user,b){
  if(!supabaseAdmin)throw new Error('Supabase não está configurado no servidor.');
  const rawItems=Array.isArray(b.items)?b.items:[];
  if(!rawItems.length)return {error:'O carrinho está vazio.'};
  const requestedIds=[...new Set(rawItems.map(raw=>String(raw.productId||raw.id||'').trim()).filter(Boolean))];
  if(!requestedIds.length)return {error:'Nenhum produto válido no carrinho.'};
  const {data:products,error:productsError}=await supabaseAdmin
    .from('products')
    .select('id,seller_id,store_id,category_id,name,price,stock,status,description,created_at,updated_at')
    .in('id',requestedIds);
  if(productsError)throw new Error('Não foi possível consultar os produtos para o pedido: '+productsError.message);
  const productMap=new Map((products||[]).map(p=>[String(p.id),p]));
  const requestedByProduct=new Map();
  let subtotal=0;
  for(const raw of rawItems){
    const productId=String(raw.productId||raw.id||'').trim();
    const product=productMap.get(productId);
    if(!product||String(product.status||'active')!=='active')continue;
    const quantity=Math.max(1,Math.min(99,Math.floor(Number(raw.quantity||raw.qty||1))));
    requestedByProduct.set(productId,(requestedByProduct.get(productId)||0)+quantity);
  }
  const items=[];
  for(const [productId,quantity] of requestedByProduct.entries()){
    const product=productMap.get(productId);
    if(!product)continue;
    const available=Number(product.stock||0);
    if(available<quantity)return {error:`Stock insuficiente para ${product.name}. Disponível: ${available}.`};
    const unitPrice=Number(product.price||0);
    const itemTotal=unitPrice*quantity;
    subtotal+=itemTotal;
    items.push({product_id:String(product.id),seller_id:product.seller_id?String(product.seller_id):null,product_name:String(product.name||'Produto'),unit_price:unitPrice,quantity,total:itemTotal});
  }
  if(!items.length)return {error:'Nenhum produto válido no carrinho.'};
  const paymentMethods=['multicaixa_express','bank_transfer','card'];
  const deliveryMethods=['delivery','pickup'];
  const paymentMethod=String(b.paymentMethod||'');
  const deliveryMethod=String(b.deliveryMethod||'delivery');
  const deliveryAddress=String(b.deliveryAddress||'').trim().slice(0,500);
  const recipient=String(b.recipient||user.name||'').trim().slice(0,120);
  const phone=String(b.phone||'').trim().slice(0,40);
  if(!paymentMethods.includes(paymentMethod))return {error:'Método de pagamento inválido.'};
  if(!deliveryMethods.includes(deliveryMethod))return {error:'Forma de entrega inválida.'};
  if(!deliveryAddress)return {error:'Indica a morada ou ponto de entrega.'};
  const deliveryFee=deliveryMethod==='delivery'?1500:0;
  const grandTotal=subtotal+deliveryFee;
  const now=new Date().toISOString();
  const internalReference=generateKuanzaPaymentReference();
  const statusHistory=[{status:'Pendente',at:now},{paymentInternalReference:internalReference,at:now}];
  const {data:createdOrder,error:orderError}=await supabaseAdmin.from('orders').insert({
    buyer_id:String(user.id),status:'Pendente',subtotal,delivery_fee:deliveryFee,total:grandTotal,
    delivery_method:deliveryMethod,recipient_name:recipient,recipient_phone:phone,delivery_address:deliveryAddress,
    payment_method:paymentMethod,payment_status:'Pendente',payment_reference:null,status_history:statusHistory
  }).select('id,buyer_id,status,subtotal,delivery_fee,total,delivery_method,recipient_name,recipient_phone,delivery_address,payment_method,payment_status,payment_reference,status_history,created_at,updated_at').single();
  if(orderError)throw new Error('Não foi possível criar o pedido no Supabase: '+orderError.message);
  const orderId=String(createdOrder.id);
  const {error:itemsError}=await supabaseAdmin.from('order_items').insert(items.map(item=>({...item,order_id:orderId})));
  if(itemsError){await supabaseAdmin.from('orders').delete().eq('id',orderId);throw new Error('Não foi possível guardar os itens do pedido: '+itemsError.message);}

  // Optimistic compare-and-swap stock reservation. Each update succeeds only
  // if the stock value read immediately before the order still matches.
  const reservations=[];
  try{
    for(const item of items.slice().sort((a,b)=>String(a.product_id).localeCompare(String(b.product_id)))){
      const product=productMap.get(String(item.product_id));
      const before=Number(product.stock||0);
      const after=before-Number(item.quantity||0);
      const {data:changed,error:stockError}=await supabaseAdmin.from('products').update({stock:after,status:after===0?'inactive':String(product.status||'active'),updated_at:new Date().toISOString()}).eq('id',String(item.product_id)).eq('stock',before).select('id,stock,status').maybeSingle();
      if(stockError)throw new Error('Não foi possível reservar o stock para '+item.product_name+': '+stockError.message);
      if(!changed)throw new Error(`O stock de ${item.product_name} acabou de mudar. Atualiza a página e tenta novamente.`);
      reservations.push({productId:String(item.product_id),before,after});
    }
  }catch(e){
    for(const r of reservations.slice().reverse()){
      await supabaseAdmin.from('products').update({stock:r.before,status:'active',updated_at:new Date().toISOString()}).eq('id',r.productId).eq('stock',r.after);
    }
    await supabaseAdmin.from('order_items').delete().eq('order_id',orderId);
    await supabaseAdmin.from('orders').delete().eq('id',orderId);
    throw e;
  }

  const order=(await supabaseOrdersToPublic([createdOrder],db))[0];
  if(order){
    order.payment=order.payment||{};
    order.payment.internalReference=internalReference;
    order.payment.instructions=paymentInstructions(order);
    await mirrorOrderToLegacy(db,order);
    await ensureDeliveryForOrder(db,order);
  }
  const sellerIds=[...new Set(items.map(i=>i.seller_id).filter(Boolean).map(String))];
  for(const sid of sellerIds)notify(db,sid,'sale','Novo pedido',`Recebeste um novo pedido #${String(order.id).slice(-8)}.`,{orderId:order.id});
  write(db);
  return {order};
}
async function updateSupabaseOrderStatus(orderId,next,db){
  if(!supabaseAdmin)throw new Error('Supabase não está configurado no servidor.');
  const current=await getSupabaseOrderForId(orderId,db);
  if(!current)return null;
  if(String(current.status)===String(next))return current;
  const updatedAt=new Date().toISOString();
  const history=Array.isArray(current.statusHistory)?current.statusHistory.slice():[];
  history.push({status:String(next),at:updatedAt});
  const {data,error}=await supabaseAdmin
    .from('orders')
    .update({status:String(next),status_history:history,updated_at:updatedAt})
    .eq('id',String(orderId))
    .select('id,buyer_id,status,subtotal,delivery_fee,total,delivery_method,recipient_name,recipient_phone,delivery_address,payment_method,payment_status,payment_reference,status_history,created_at,updated_at')
    .single();
  if(error)throw new Error('Não foi possível atualizar o estado do pedido: '+error.message);
  const out=(await supabaseOrdersToPublic([data],db))[0];
  return out||null;
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
const PROTECTION_MINUTES=30;
const PROTECTION_WINDOW_MS=PROTECTION_MINUTES*60*1000;
async function ensureWallet(db,userId){return await getWalletRow(userId);}
async function walletSummary(db,userId){return await getWalletSummary(userId);}
const PAYMENT_STATUSES=['Pendente','Aguardando confirmação','Pago','Falhou','Cancelado','Reembolsado'];
const PAYMENT_METHODS=['multicaixa_express','bank_transfer','card'];
const PAYMENT_TRANSITIONS={
  'Pendente':['Aguardando confirmação','Cancelado','Falhou'],
  'Aguardando confirmação':['Pago','Cancelado','Falhou'],
  'Pago':['Reembolsado'],
  'Falhou':[],
  'Cancelado':[],
  'Reembolsado':[]
};
const ORDER_TRANSITIONS={
  'Pendente':['Confirmado','Cancelado'],
  'Confirmado':['Em preparação','Cancelado'],
  'Em preparação':['Enviado','Cancelado'],
  'Enviado':['Entregue','Cancelado'],
  'Entregue':[],
  'Cancelado':[]
};
function canTransition(map,current,next){return current===next||((map[current]||[]).includes(next));}

function paymentStatusLabel(status){return PAYMENT_STATUSES.includes(String(status||''))?String(status):'Pendente';}
function generateKuanzaPaymentReference(){
  const d=new Date();
  const stamp=d.toISOString().slice(0,10).replace(/-/g,'');
  const random=crypto.randomBytes(3).toString('hex').toUpperCase();
  return `KL-${stamp}-${random}`;
}
function internalPaymentReference(order){
  const history=Array.isArray(order?.statusHistory)?order.statusHistory:[];
  const item=history.find(x=>x&&x.paymentInternalReference);
  return String(item?.paymentInternalReference||'').trim()||null;
}
function paymentInstructions(order){
  const total=Number(order?.total||0);
  return {
    beneficiary:KUANZA_PAYMENT_BENEFICIARY,
    bank:KUANZA_PAYMENT_BANK||null,
    account:KUANZA_PAYMENT_ACCOUNT||null,
    iban:KUANZA_PAYMENT_IBAN||null,
    entity:KUANZA_PAYMENT_ENTITY||null,
    internalReference:internalPaymentReference(order),
    amount:total,
    configured:!!(KUANZA_PAYMENT_BANK&&KUANZA_PAYMENT_ACCOUNT)
  };
}
function publicPayment(order){
  if(!order)return null;
  return {
    method:String(order.payment?.method||''),
    status:paymentStatusLabel(order.payment?.status),
    reference:order.payment?.reference||null,
    internalReference:internalPaymentReference(order),
    instructions:paymentInstructions(order)
  };
}
async function updateSupabasePayment(orderId,nextStatus,reference,db){
  if(!supabaseAdmin)throw new Error('Supabase não está configurado no servidor.');
  const current=await getSupabaseOrderForId(orderId,db);
  if(!current)return null;
  const status=paymentStatusLabel(nextStatus);
  const ref=reference===undefined?current.payment?.reference||null:(String(reference||'').trim().slice(0,120)||null);
  const {data,error}=await supabaseAdmin.from('orders').update({payment_status:status,payment_reference:ref,updated_at:new Date().toISOString()}).eq('id',String(orderId)).select('id,buyer_id,status,subtotal,delivery_fee,total,delivery_method,recipient_name,recipient_phone,delivery_address,payment_method,payment_status,payment_reference,status_history,created_at,updated_at').single();
  if(error)throw new Error('Não foi possível atualizar o pagamento no Supabase: '+error.message);
  const out=(await supabaseOrdersToPublic([data],db))[0];
  if(out)await mirrorOrderToLegacy(db,out);
  return out||null;
}


async function getOrderFinancials(orderId){
  if(!supabaseAdmin||!orderId)return null;
  const {data,error}=await supabaseAdmin.from('order_financials').select('*').eq('order_id',String(orderId)).maybeSingle();
  if(error)throw new Error('Não foi possível carregar os dados financeiros: '+error.message);
  if(!data)return null;
  return {
    protectionStartedAt:data.protection_started_at||null, protectionUntil:data.protection_until||null, protectionMinutes:Number(data.protection_minutes||PROTECTION_MINUTES),
    protectionStatus:String(data.protection_status||''), disputeOpen:!!data.dispute_open, settled:!!data.settled, settledAt:data.settled_at||null,
    refunded:!!data.refunded, refundedAt:data.refunded_at||null, cancelled:!!data.cancelled, cancelledAt:data.cancelled_at||null,
    pendingCredited:!!data.pending_credited, pendingCreditedAt:data.pending_credited_at||null, sellers:data.sellers||{}
  };
}
async function upsertOrderFinancials(orderId,patch={}){
  if(!supabaseAdmin)throw new Error('Supabase não está configurado no servidor.');
  const row={order_id:String(orderId),...patch,updated_at:new Date().toISOString()};
  const {data,error}=await supabaseAdmin.from('order_financials').upsert(row,{onConflict:'order_id'}).select('*').single();
  if(error)throw new Error('Não foi possível guardar os dados financeiros: '+error.message);
  return data;
}
async function getWalletRow(userId){
  if(!supabaseAdmin)throw new Error('Supabase não está configurado no servidor.');
  const {data,error}=await supabaseAdmin.from('wallets').select('*').eq('user_id',String(userId)).maybeSingle();
  if(error)throw new Error('Não foi possível carregar a carteira: '+error.message);
  if(data)return data;
  const {data:created,error:ce}=await supabaseAdmin.from('wallets').insert({user_id:String(userId),available:0,pending:0,total_earned:0,total_withdrawn:0}).select('*').single();
  if(ce)throw new Error('Não foi possível criar a carteira: '+ce.message);
  return created;
}
async function getWalletSummary(userId){
  const w=await getWalletRow(userId);
  const {data,error}=await supabaseAdmin.from('wallet_transactions').select('*').eq('user_id',String(userId)).order('created_at',{ascending:false}).limit(100);
  if(error)throw new Error('Não foi possível carregar os movimentos da carteira: '+error.message);
  return {id:String(w.id),userId:String(w.user_id),available:Number(w.available||0),pending:Number(w.pending||0),totalEarned:Number(w.total_earned||0),totalWithdrawn:Number(w.total_withdrawn||0),transactions:(data||[]).map(x=>({id:String(x.id),userId:String(x.user_id),type:String(x.type||''),amount:Number(x.amount||0),description:String(x.description||''),meta:x.meta||{},createdAt:x.created_at||null}))};
}
async function addWalletTxSupabase(userId,type,amount,description,meta={}){
  const {data,error}=await supabaseAdmin.from('wallet_transactions').insert({user_id:String(userId),type:String(type),amount:Number(amount||0),description:String(description||''),meta:meta||{}}).select('*').single();
  if(error)throw new Error('Não foi possível registar o movimento financeiro: '+error.message);
  return data;
}
async function updateWalletSupabase(userId,delta){
  const w=await getWalletRow(userId);
  const available=Number(w.available||0)+Number(delta.available||0);
  const pending=Number(w.pending||0)+Number(delta.pending||0);
  const totalEarned=Number(w.total_earned||0)+Number(delta.totalEarned||0);
  const totalWithdrawn=Number(w.total_withdrawn||0)+Number(delta.totalWithdrawn||0);
  if(available<0||pending<0)throw new Error('Operação financeira recusada: saldo insuficiente.');
  const {data,error}=await supabaseAdmin.from('wallets').update({available,pending,total_earned:totalEarned,total_withdrawn:totalWithdrawn,updated_at:new Date().toISOString()}).eq('id',w.id).select('*').single();
  if(error)throw new Error('Não foi possível atualizar a carteira: '+error.message);
  return data;
}
async function migrateFinancialsToSupabase(db){
  if(!supabaseAdmin)return;
  try{
    const orders=await supabaseAdmin.from('orders').select('id'); if(orders.error)throw orders.error;
    for(const o of orders.data||[]){
      const legacy=db.orders.find(x=>String(x.id)===String(o.id));
      if(legacy?.financials)await upsertOrderFinancials(o.id,{protection_started_at:legacy.financials.protectionStartedAt||null,protection_until:legacy.financials.protectionUntil||null,protection_minutes:Number(legacy.financials.protectionMinutes||PROTECTION_MINUTES),protection_status:legacy.financials.protectionStatus||null,dispute_open:!!legacy.financials.disputeOpen,settled:!!legacy.financials.settled,settled_at:legacy.financials.settledAt||null,refunded:!!legacy.financials.refunded,refunded_at:legacy.financials.refundedAt||null,cancelled:!!legacy.financials.cancelled,cancelled_at:legacy.financials.cancelledAt||null,pending_credited:!!legacy.financials.pendingCredited,pending_credited_at:legacy.financials.pendingCreditedAt||null,sellers:legacy.financials.sellers||{}});
      else await upsertOrderFinancials(o.id,{});
    }
    const wallets=Array.isArray(db.wallets)?db.wallets:[];
    for(const w of wallets){const userId=String(w.userId||'');if(!userId)continue;const existing=await supabaseAdmin.from('wallets').select('id').eq('user_id',userId).maybeSingle();if(existing.error)throw existing.error;if(!existing.data)await supabaseAdmin.from('wallets').insert({user_id:userId,available:Number(w.available||0),pending:Number(w.pending||0),total_earned:Number(w.totalEarned||0),total_withdrawn:Number(w.totalWithdrawn||0)});}
    const txs=Array.isArray(db.walletTransactions)?db.walletTransactions:[];
    for(const tx of txs.slice(-1000)){const id=String(tx.id||'');if(!id)continue;const exists=await supabaseAdmin.from('wallet_transactions').select('id').eq('legacy_id',id).maybeSingle();if(exists.error)throw exists.error;if(!exists.data)await supabaseAdmin.from('wallet_transactions').insert({user_id:String(tx.userId),type:String(tx.type||''),amount:Number(tx.amount||0),description:String(tx.description||''),meta:{...(tx.meta||{}),legacy_id:id},legacy_id:id,created_at:tx.createdAt||new Date().toISOString()});}
    const disputes=Array.isArray(db.disputes)?db.disputes:[];
    for(const d of disputes){const exists=await supabaseAdmin.from('disputes').select('id').eq('legacy_id',String(d.id)).maybeSingle();if(exists.error)throw exists.error;if(!exists.data)await supabaseAdmin.from('disputes').insert({legacy_id:String(d.id),order_id:String(d.orderId),buyer_id:String(d.userId),seller_id:d.sellerId?String(d.sellerId):null,reason:String(d.reason||''),description:String(d.description||''),status:String(d.status||'Aberta'),decision:d.decision||null,admin_note:d.adminNote||null,created_at:d.createdAt||new Date().toISOString(),updated_at:d.updatedAt||new Date().toISOString()});}
    db.migrations={...(db.migrations||{}),financialsSupabase:new Date().toISOString()};write(db);
  }catch(e){console.error('Erro na migração financeira para Supabase:',e.message||e);}
}

function deliveryStatusFromOrderStatus(status){
  const map={
    Pendente:'A preparar',
    Confirmado:'A preparar',
    'Em preparação':'A preparar',
    Enviado:'Em trânsito',
    Entregue:'Entregue',
    Cancelado:'Cancelada'
  };
  return map[String(status||'Pendente')]||'A preparar';
}

async function syncMissingDeliveriesFromSupabase(db){
  if(!supabaseAdmin)return;
  const {data:orders,error:ordersError}=await supabaseAdmin
    .from('orders')
    .select('id,buyer_id,status,delivery_fee,delivery_method,recipient_name,recipient_phone,delivery_address,status_history,created_at,updated_at')
    .order('created_at',{ascending:true});
  if(ordersError)throw ordersError;
  if(!orders?.length)return;

  const orderIds=orders.map(o=>String(o.id));
  const {data:itemRows,error:itemError}=await supabaseAdmin
    .from('order_items')
    .select('order_id,seller_id')
    .in('order_id',orderIds);
  if(itemError)throw itemError;

  const sellers=new Map();
  for(const item of itemRows||[]){
    const key=String(item.order_id);
    if(!sellers.has(key))sellers.set(key,[]);
    if(item.seller_id&&!sellers.get(key).includes(String(item.seller_id)))sellers.get(key).push(String(item.seller_id));
  }

  for(const order of orders){
    const orderId=String(order.id);
    const existing=await getSupabaseDeliveryForOrder(orderId);
    if(existing)continue;
    const orderHistory=Array.isArray(order.status_history)?order.status_history:[];
    const history=[];
    for(const h of orderHistory){
      const ds=deliveryStatusFromOrderStatus(h?.status);
      if(!history.length||history[history.length-1].status!==ds)history.push({status:ds,at:h?.at||order.created_at||new Date().toISOString()});
    }
    const currentStatus=deliveryStatusFromOrderStatus(order.status);
    if(!history.length)history.push({status:currentStatus,at:order.created_at||new Date().toISOString()});
    else if(history[history.length-1].status!==currentStatus)history.push({status:currentStatus,at:order.updated_at||new Date().toISOString()});
    const row={
      order_id:orderId,
      buyer_id:order.buyer_id?String(order.buyer_id):null,
      seller_ids:sellers.get(orderId)||[],
      recipient:String(order.recipient_name||''),
      phone:String(order.recipient_phone||''),
      address:String(order.delivery_address||''),
      method:String(order.delivery_method||'delivery'),
      fee:Number(order.delivery_fee||0),
      status:currentStatus,
      status_history:history,
      confirmation_code:String(Math.floor(100000+Math.random()*900000)),
      created_at:order.created_at||new Date().toISOString(),
      updated_at:order.updated_at||new Date().toISOString()
    };
    const {error}=await supabaseAdmin.from('deliveries').insert(row);
    if(error)throw error;
    console.log('Entrega sincronizada para pedido:',orderId);
  }
}

async function migrateDeliveriesToSupabase(db){
  if(!supabaseAdmin)return;
  try{
    await syncMissingDeliveriesFromSupabase(db);
    if(db.migrations?.deliveriesSupabase)return;
    const deliveries=Array.isArray(db.deliveries)?db.deliveries:[];
    for(const d of deliveries){
      const orderId=String(d.orderId||'');
      if(!/^[0-9a-fA-F-]{36}$/.test(orderId))continue;
      const row={
        id:/^[0-9a-fA-F-]{36}$/.test(String(d.id||''))?String(d.id):undefined,
        order_id:orderId,
        buyer_id:d.buyerId?String(d.buyerId):null,
        seller_ids:Array.isArray(d.sellerIds)?d.sellerIds.map(String):[],
        recipient:String(d.recipient||''),
        phone:String(d.phone||''),
        address:String(d.address||''),
        method:String(d.method||'delivery'),
        fee:Number(d.fee||0),
        status:String(d.status||'A preparar'),
        status_history:Array.isArray(d.statusHistory)?d.statusHistory:[],
        confirmation_code:d.confirmationCode?String(d.confirmationCode):null,
        created_at:d.createdAt||new Date().toISOString(),
        updated_at:d.updatedAt||new Date().toISOString()
      };
      if(!row.id)delete row.id;
      const {error}=await supabaseAdmin.from('deliveries').upsert(row,{onConflict:'order_id'});
      if(error)throw error;
    }
    db.migrations={...(db.migrations||{}),deliveriesSupabase:new Date().toISOString()};
    write(db);
  }catch(e){console.error('Erro na migração de entregas para Supabase:',e.message||e);}
}

async function createSupabaseDelivery(order){
  if(!supabaseAdmin)return null;
  const existing=await getSupabaseDeliveryForOrder(order.id);
  if(existing)return existing;
  const now=new Date().toISOString();
  const status=deliveryStatusFromOrderStatus(order.status);
  const row={
    order_id:String(order.id),
    buyer_id:order.userId?String(order.userId):null,
    seller_ids:[...new Set((order.items||[]).map(i=>i.sellerId).filter(Boolean).map(String))],
    recipient:String(order.delivery?.recipient||''),
    phone:String(order.delivery?.phone||''),
    address:String(order.delivery?.address||''),
    method:String(order.delivery?.method||'delivery'),
    fee:Number(order.delivery?.fee||0),
    status,
    status_history:[{status,at:order.createdAt||now}],
    confirmation_code:String(Math.floor(100000+Math.random()*900000)),
    created_at:order.createdAt||now,
    updated_at:now
  };
  const {data,error}=await supabaseAdmin.from('deliveries').insert(row).select('*').single();
  if(error)throw new Error('Não foi possível criar a entrega no Supabase: '+error.message);
  return data;
}

async function getSupabaseDeliveryForOrder(orderId){
  if(!supabaseAdmin)return null;
  const {data,error}=await supabaseAdmin.from('deliveries').select('*').eq('order_id',String(orderId)).maybeSingle();
  if(error)throw new Error('Não foi possível consultar a entrega: '+error.message);
  return data||null;
}

async function getSupabaseDeliveryForId(id){
  if(!supabaseAdmin)return null;
  const {data,error}=await supabaseAdmin.from('deliveries').select('*').eq('id',String(id)).maybeSingle();
  if(error)throw new Error('Não foi possível consultar a entrega: '+error.message);
  return data||null;
}

function publicDelivery(row){
  if(!row)return null;
  return {
    id:String(row.id),orderId:String(row.order_id),buyerId:row.buyer_id?String(row.buyer_id):'',sellerIds:Array.isArray(row.seller_ids)?row.seller_ids.map(String):[],
    recipient:String(row.recipient||''),phone:String(row.phone||''),address:String(row.address||''),method:String(row.method||'delivery'),fee:Number(row.fee||0),
    status:String(row.status||'A preparar'),statusHistory:Array.isArray(row.status_history)?row.status_history:[],confirmationCode:row.confirmation_code||'',createdAt:row.created_at||null,updatedAt:row.updated_at||null
  };
}

async function ensureDeliveryForOrder(db,order){
  if(!order||!supabaseAdmin)return null;
  let row=await getSupabaseDeliveryForOrder(order.id);
  if(!row)row=await createSupabaseDelivery(order);
  const publicD=publicDelivery(row);
  const i=db.deliveries.findIndex(x=>String(x.orderId)===String(order.id));
  if(i>=0)db.deliveries[i]={...db.deliveries[i],...publicD};else db.deliveries.unshift(publicD);
  return publicD;
}

async function updateSupabaseDeliveryStatus(id,next){
  if(!supabaseAdmin)throw new Error('Supabase não está configurado no servidor.');
  const current=await getSupabaseDeliveryForId(id);
  if(!current)return null;
  if(String(current.status)===String(next))return publicDelivery(current);
  const updatedAt=new Date().toISOString();
  const history=Array.isArray(current.status_history)?current.status_history.slice():[];
  history.push({status:String(next),at:updatedAt});
  const {data,error}=await supabaseAdmin.from('deliveries').update({status:String(next),status_history:history,updated_at:updatedAt}).eq('id',String(id)).select('*').single();
  if(error)throw new Error('Não foi possível atualizar a entrega no Supabase: '+error.message);
  return publicDelivery(data);
}

async function addWalletTx(db,userId,type,amount,description,meta={}){const tx=await addWalletTxSupabase(userId,type,amount,description,meta);return {id:String(tx.id),userId:String(tx.user_id),type:String(tx.type),amount:Number(tx.amount||0),description:String(tx.description||''),meta:tx.meta||{},createdAt:tx.created_at||new Date().toISOString()};}
function calculateSellerShare(order,sellerId){
  const items=(Array.isArray(order.items)?order.items:[]).filter(i=>String(i.sellerId||'')===String(sellerId));
  const gross=items.reduce((sum,i)=>sum+Number(i.price||0)*Math.max(1,Number(i.quantity||1)),0);
  const commission=Math.round(gross*PLATFORM_COMMISSION_RATE);
  return {gross,commission,net:gross-commission};
}
async function addPendingForPaidOrder(db,order){
  if(!order||paymentStatusLabel(order.payment?.status)!=='Pago')return false;
  const financials=order.financials||{};
  if(financials.pendingCredited)return false;
  const sellerIds=[...new Set((order.items||[]).map(i=>i.sellerId).filter(Boolean).map(String))];
  if(!sellerIds.length)return false;
  financials.pendingCreditedAt=new Date().toISOString();
  financials.pendingCredited=true;
  financials.sellers={...(financials.sellers||{})};
  for(const sellerId of sellerIds){
    const share=calculateSellerShare(order,sellerId);
    const wallet=await ensureWallet(db,sellerId);
    await updateWalletSupabase(sellerId,{pending:share.net}); wallet.pending=Number(wallet.pending||0)+share.net;
    financials.sellers[sellerId]={...(financials.sellers[sellerId]||{}),...share};
    await addWalletTx(db,sellerId,'sale_pending',share.net,`Venda #${String(order.id).slice(-8)} aguardando entrega e proteção`,{orderId:order.id,gross:share.gross,commission:share.commission});
    notify(db,sellerId,'wallet','Venda em saldo pendente',`Kz ${share.net.toLocaleString('pt-AO')} ficaram pendentes até à entrega e período de proteção.`,{orderId:order.id,amount:share.net});
  }
  order.financials=financials;
  await upsertOrderFinancials(order.id,{pending_credited:true,pending_credited_at:financials.pendingCreditedAt,sellers:financials.sellers});
  return true;
}

async function startDeliveryProtection(db,order){
  if(!order||order.status!=='Entregue')return false;
  const now=Date.now();
  const f=order.financials||{};
  if(f.settled)return false;
  const startedAt=f.protectionStartedAt||new Date(now).toISOString();
  const until=f.protectionUntil||new Date(now+PROTECTION_WINDOW_MS).toISOString();
  const changed=!f.protectionStartedAt||!f.protectionUntil;
  order.financials={...f,protectionStartedAt:startedAt,protectionUntil:until,protectionMinutes:PROTECTION_MINUTES,protectionStatus:'Em proteção',disputeOpen:false};
  await upsertOrderFinancials(order.id,{protection_started_at:startedAt,protection_until:until,protection_minutes:PROTECTION_MINUTES,protection_status:'Em proteção',dispute_open:false});
  if(paymentStatusLabel(order.payment?.status)==='Pago')await addPendingForPaidOrder(db,order);
  return changed;
}

function hasOpenDispute(db,orderId){
  return Array.isArray(db.disputes)&&db.disputes.some(d=>String(d.orderId)===String(orderId)&&['Aberta','Em análise'].includes(String(d.status||'')));
}

async function hasOpenDisputeSupabase(orderId){
  if(!supabaseAdmin)return false;
  const {data,error}=await supabaseAdmin.from('disputes').select('id,status').eq('order_id',String(orderId)).in('status',['Aberta','Em análise']).limit(1);
  if(error)throw new Error('Não foi possível verificar reclamações do pedido: '+error.message);
  return Array.isArray(data)&&data.length>0;
}

async function settleDeliveredOrder(db,order){
  if(!order||order.status!=='Entregue'||order.financials?.settled)return false;
  if(paymentStatusLabel(order.payment?.status)!=='Pago')return false;
  if(await hasOpenDisputeSupabase(order.id))return false;
  const f=order.financials||{};
  if(f.protectionUntil&&Date.now()<Date.parse(f.protectionUntil))return false;
  const result=await supabaseAdmin.rpc('kuanza_settle_order',{p_order_id:String(order.id)});
  if(result.error)throw new Error('Não foi possível liquidar financeiramente o pedido: '+result.error.message);
  const data=result.data;
  if(!data||data.settled!==true)return false;
  const financial=await getOrderFinancials(order.id);
  order.financials=financial||{...f,settled:true,settledAt:new Date().toISOString(),protectionStatus:'Concluída'};
  if(Array.isArray(order.items)){
    const sellerIds=[...new Set(order.items.map(i=>i.sellerId).filter(Boolean).map(String))];
    for(const sellerId of sellerIds){
      const share=calculateSellerShare(order,sellerId);
      order.financials.sellers={...(order.financials.sellers||{}),[sellerId]:{...(order.financials.sellers?.[sellerId]||{}),...share}};
      notify(db,sellerId,'wallet','Valor libertado',`Kz ${share.net.toLocaleString('pt-AO')} foram adicionados ao teu saldo disponível após o período de proteção.`,{orderId:order.id,amount:share.net});
    }
  }
  return true;
}

async function processProtectionReleases(db){
  if(!supabaseAdmin)return false;
  let changed=false;
  const nowIso=new Date().toISOString();
  const {data:financialRows,error:financialError}=await supabaseAdmin
    .from('order_financials')
    .select('order_id,protection_until,settled,settlement_claimed_at,refunded,cancelled')
    .eq('settled',false)
    .eq('refunded',false)
    .eq('cancelled',false)
    .not('protection_until','is',null)
    .lte('protection_until',nowIso);
  if(financialError)throw new Error('Não foi possível carregar proteções financeiras expiradas: '+financialError.message);
  for(const row of financialRows||[]){
    try{
      if(row.settlement_claimed_at)continue;
      const order=await getSupabaseOrderForId(String(row.order_id),db);
      if(!order)continue;
      await mirrorOrderToLegacy(db,order);
      if(order.status!=='Entregue'||paymentStatusLabel(order.payment?.status)!=='Pago')continue;
      if(await hasOpenDisputeSupabase(order.id)){
        await upsertOrderFinancials(order.id,{protection_status:'Bloqueada por disputa',dispute_open:true});
        order.financials={...(order.financials||{}),protectionStatus:'Bloqueada por disputa',disputeOpen:true};
        changed=true;
        continue;
      }
      if(await settleDeliveredOrder(db,order))changed=true;
    }catch(error){
      console.error(`Falha ao processar liberação do pedido #${String(row.order_id).slice(-8)}:`,error.message||error);
    }
  }
  if(changed)write(db);
  return changed;
}

async function refundPendingOrder(db,order,reason='Pagamento reembolsado'){
  if(!order||order.financials?.refunded)return false;
  if(order.financials?.settled)return false;
  const result=await supabaseAdmin.rpc('kuanza_refund_order',{p_order_id:String(order.id),p_reason:String(reason)});
  if(result.error)throw new Error('Não foi possível reembolsar financeiramente o pedido: '+result.error.message);
  if(!result.data||result.data.refunded!==true)return false;
  const financial=await getOrderFinancials(order.id);
  order.financials=financial||{...(order.financials||{}),refunded:true,refundedAt:new Date().toISOString(),protectionStatus:'Reembolsada'};
  return true;
}

const rateBuckets=new Map();
function rateLimit(req,key,limit=60,windowMs=60000){const now=Date.now();const id=key+'|'+(req.socket.remoteAddress||'unknown');const a=rateBuckets.get(id)||[];const fresh=a.filter(t=>now-t<windowMs);fresh.push(now);rateBuckets.set(id,fresh);return fresh.length<=limit;}
function audit(db,req,userId,event,meta={}){if(!Array.isArray(db.securityEvents))db.securityEvents=[];db.securityEvents.unshift({id:crypto.randomUUID(),userId:userId||null,event,ip:req.socket.remoteAddress||'unknown',at:new Date().toISOString(),meta});if(db.securityEvents.length>1000)db.securityEvents=db.securityEvents.slice(0,1000);}
function isBlocked(db,userId){return Array.isArray(db.blockedUsers)&&db.blockedUsers.some(x=>String(x.userId)===String(userId)&&x.active!==false);}
function adminOnly(user){return !!user&&user.role==='admin';}
const server=http.createServer(async(req,res)=>{
  const u=url.parse(req.url,true);
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':ALLOWED_ORIGIN||'*','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'});return res.end();}
  try{
    let db=ensureDB(read());
    if(!globalThis.__kuanzaFavCartMigrationStarted){globalThis.__kuanzaFavCartMigrationStarted=true;migrateFavoritesAndCart(db);}
    if(!globalThis.__kuanzaDeliveryMigrationStarted){globalThis.__kuanzaDeliveryMigrationStarted=true;migrateDeliveriesToSupabase(db);}
    if(!globalThis.__kuanzaFinancialMigrationStarted){globalThis.__kuanzaFinancialMigrationStarted=true;migrateFinancialsToSupabase(db);}
    if(!rateLimit(req, u.pathname.startsWith('/api/login')?'login':u.pathname.startsWith('/api/register')?'register':'api', u.pathname.startsWith('/api/login')?12:u.pathname.startsWith('/api/register')?8:120, 60000)) return json(res,429,{error:'Muitas solicitações. Tenta novamente em instantes.'});
    const currentUser=await auth(req);
    if(currentUser && isBlocked(db,currentUser.id)) return json(res,403,{error:'A tua conta está temporariamente bloqueada.'});
    await processProtectionReleases(db);
    if(u.pathname==='/api/health') return json(res,200,{ok:true,service:'Kuanza Line API',version:'2.0.4.2',status:'healthy',supabase:!!(supabaseAuth&&supabaseAdmin),timestamp:new Date().toISOString()});
    if(u.pathname==='/api/ready') return json(res,200,{ok:true,ready:fs.existsSync(DB),database:fs.existsSync(DB)?'ready':'missing',version:'2.0.4.2',supabase:!!(supabaseAuth&&supabaseAdmin)});

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
      const user=await auth({headers:{authorization:`Bearer ${data.session.access_token}`}});
      if(!user)return json(res,401,{error:'Não foi possível carregar o teu perfil.'});
      audit(db,req,user.id,'supabase_login');
      write(db);
      return json(res,200,{token:data.session.access_token,user:publicUser(user,db)});
    }
    if(u.pathname==='/api/me'&&req.method==='GET'){const user=await auth(req);if(!user)return json(res,401,{error:'Não autenticado.'});const pu=publicUser(user,db);return json(res,200,{...pu,email:user.email||'',phone:user.phone||'',avatar:user.avatar||'',user:{...pu,email:user.email||'',phone:user.phone||'',avatar:user.avatar||''}});}

    if(u.pathname==='/api/me/profile'&&req.method==='PATCH'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Não autenticado.'});
      const b=await body(req,3*1024*1024);
      const name=String(b.name||b.full_name||'').trim();
      const phone=String(b.phone||'').trim();
      const avatarData=String(b.avatarData||b.avatar||'').trim();
      if(name.length<2||name.length>100)return json(res,400,{error:'O nome deve ter entre 2 e 100 caracteres.'});
      if(phone.length>30)return json(res,400,{error:'O telefone é demasiado longo.'});
      const accessToken=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
      if(!accessToken)return json(res,401,{error:'Sessão inválida.'});
      const supabaseUser=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{global:{headers:{Authorization:`Bearer ${accessToken}`}},auth:{persistSession:false,autoRefreshToken:false}});
      let avatarUrl=user.avatar||'';
      if(avatarData){
        const match=avatarData.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
        if(!match)return json(res,400,{error:'A foto deve ser JPG, PNG ou WebP.'});
        const ext=(match[1].toLowerCase()==='jpeg'||match[1].toLowerCase()==='jpg')?'jpg':match[1].toLowerCase();
        const mime=ext==='jpg'?'image/jpeg':`image/${ext}`;
        const buffer=Buffer.from(match[2],'base64');
        if(!buffer.length||buffer.length>2*1024*1024)return json(res,400,{error:'A foto deve ter no máximo 2 MB.'});
        if(!supabaseAdmin)return json(res,503,{error:'Serviço de armazenamento não está configurado.'});
        try{
          const bucket=await supabaseAdmin.storage.getBucket(SUPABASE_AVATARS_BUCKET);
          if(bucket.error){const created=await supabaseAdmin.storage.createBucket(SUPABASE_AVATARS_BUCKET,{public:true,fileSizeLimit:'2MB',allowedMimeTypes:['image/jpeg','image/png','image/webp']});if(created.error&&!/already exists|duplicate/i.test(created.error.message||''))throw created.error;}
          const filePath=`${user.id}/avatar.${ext}`;
          const upload=await supabaseAdmin.storage.from(SUPABASE_AVATARS_BUCKET).upload(filePath,buffer,{contentType:mime,upsert:true,cacheControl:'3600'});
          if(upload.error)throw upload.error;
          avatarUrl=supabaseAdmin.storage.from(SUPABASE_AVATARS_BUCKET).getPublicUrl(filePath).data.publicUrl;
        }catch(e){return json(res,500,{error:'Não foi possível guardar a foto de perfil.',details:e.message||String(e)});}
      }
      const {data:updatedProfile,error}=await supabaseUser.from('profiles').update({full_name:name,phone,avatar_url:avatarUrl,updated_at:new Date().toISOString()}).eq('id',user.id).select('id,full_name,phone,avatar_url,role,verified,score,created_at,updated_at').maybeSingle();
      if(error)return json(res,403,{error:error.message||'Não foi possível atualizar o perfil.'});
      if(!updatedProfile)return json(res,403,{error:'O perfil não foi atualizado. Verifica as permissões da tua conta.'});
      user.name=String(updatedProfile.full_name||name);user.phone=String(updatedProfile.phone||phone);user.avatar=String(updatedProfile.avatar_url||avatarUrl);user.verified=!!updatedProfile.verified;user.score=Number(updatedProfile.score||user.score||50);
      const pu=publicUser(user,db);return json(res,200,{ok:true,...pu,email:user.email||'',phone:user.phone||'',avatar:user.avatar||'',user:{...pu,email:user.email||'',phone:user.phone||'',avatar:user.avatar||''}});
    }

    if(u.pathname==='/api/me/email'&&req.method==='PATCH'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Não autenticado.'});
      const b=await body(req,64*1024);const email=String(b.email||'').trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(res,400,{error:'Indica um e-mail válido.'});
      if(email===String(user.email||'').toLowerCase())return json(res,200,{ok:true,email:user.email,changed:false});
      const accessToken=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();if(!accessToken)return json(res,401,{error:'Sessão inválida.'});
      const supabaseUser=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{global:{headers:{Authorization:`Bearer ${accessToken}`}},auth:{persistSession:false,autoRefreshToken:false}});
      const {data,error}=await supabaseUser.auth.updateUser({email});
      if(error)return json(res,400,{error:error.message||'Não foi possível alterar o e-mail.'});
      return json(res,200,{ok:true,email:String(data.user?.email||email),requiresConfirmation:true,message:'Pedido de alteração de e-mail enviado. Confirma o novo e-mail para concluir.'});
    }
    if(u.pathname==='/api/me/score'&&req.method==='GET'){
      const user=await auth(req); if(!user)return json(res,401,{error:'Não autenticado.'});
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
      const user=await auth(req);if(!user)return json(res,401,{error:'Não autenticado.'});
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
      const store=supabaseStoreToPublic(st);
      const categoryMap=await supabaseCategoryMap((products||[]).map(p=>p.category_id));
      const publicProducts=(products||[]).map(p=>{
        const legacy=db.products.find(x=>String(x.id)===String(p.id));
        return supabaseProductToPublic(p,ownerProfile,storesByOwner.get(ownerId)||st,legacy,categoryMap.get(String(p.category_id)));
      });
      for(const p of publicProducts)mirrorProductToLegacy(db,p);
      const owner=ownerProfile?publicUser({...ownerProfile,id:ownerId,name:ownerProfile.full_name||'Vendedor',avatar:ownerProfile.avatar_url||'',verified:!!ownerProfile.verified,score:Number(ownerProfile.score||50),role:ownerProfile.role||'seller'},db):null;
      return json(res,200,{store,stores:store?[store]:[],owner,products:publicProducts});
    }

    if(u.pathname==='/api/stores'&&(req.method==='POST'||req.method==='PATCH')){
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
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
      const store=supabaseStoreToPublic(result.data);
      return json(res,200,{...store,store,ok:true});
    }

    // ============================================================
    // ADMIN — GESTÃO E APROVAÇÃO DE LOJAS
    // A aprovação fica persistida no Supabase através de verified.
    // ============================================================
    if(u.pathname==='/api/admin/stores'&&req.method==='GET'){
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const admin=await auth(req);
      if(!admin)return json(res,401,{error:'Inicia sessão.'});
      if(!adminOnly(admin))return json(res,403,{error:'Apenas administradores.'});
      const filter=String(u.query.status||'').trim().toLowerCase();
      let query=supabaseAdmin.from('stores').select('id,owner_id,name,slug,description,logo_url,location,phone,verified,rating,created_at,updated_at').order('created_at',{ascending:false});
      if(filter==='approved'||filter==='aprovada')query=query.eq('verified',true);
      else if(filter==='pending'||filter==='aguardando')query=query.eq('verified',false);
      const {data:stores,error}=await query;
      if(error)return json(res,500,{error:'Não foi possível carregar as lojas.',details:error.message});
      const ownerIds=[...new Set((stores||[]).map(x=>String(x.owner_id)).filter(Boolean))];
      let profiles=[];
      if(ownerIds.length){
        const pr=await supabaseAdmin.from('profiles').select('id,full_name,phone,avatar_url,role,verified,score').in('id',ownerIds);
        if(pr.error)return json(res,500,{error:'Não foi possível carregar os proprietários das lojas.',details:pr.error.message});
        profiles=pr.data||[];
      }
      const profileMap=new Map(profiles.map(x=>[String(x.id),x]));
      return json(res,200,(stores||[]).map(st=>({...supabaseStoreToPublic(st),owner:profileMap.get(String(st.owner_id))||null})));
    }

    const adminStoreMatch=u.pathname.match(/^\/api\/admin\/stores\/([^/]+)$/);
    if(adminStoreMatch&&req.method==='PATCH'){
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const admin=await auth(req);
      if(!admin)return json(res,401,{error:'Inicia sessão.'});
      if(!adminOnly(admin))return json(res,403,{error:'Apenas administradores.'});
      const storeId=decodeURIComponent(adminStoreMatch[1]);
      const b=await body(req,64*1024);
      if(typeof b.verified!=='boolean')return json(res,400,{error:'Indica verified como true para aprovar ou false para rejeitar.'});
      const {data:existing,error:findError}=await supabaseAdmin.from('stores').select('id,owner_id,name,slug,description,logo_url,location,phone,verified,rating,created_at,updated_at').eq('id',storeId).maybeSingle();
      if(findError)return json(res,500,{error:'Não foi possível consultar a loja.',details:findError.message});
      if(!existing)return json(res,404,{error:'Loja não encontrada.'});
      const {data:updated,error:updateError}=await supabaseAdmin.from('stores').update({verified:b.verified,updated_at:new Date().toISOString()}).eq('id',storeId).select('id,owner_id,name,slug,description,logo_url,location,phone,verified,rating,created_at,updated_at').single();
      if(updateError)return json(res,500,{error:'Não foi possível atualizar a aprovação da loja.',details:updateError.message});
      audit(db,req,admin.id,'store_approval_changed',{storeId,verified:b.verified});write(db);
      return json(res,200,{...supabaseStoreToPublic(updated),ok:true});
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
      list=list.filter(p=>{const st=storesByOwner.get(String(p.seller_id));return !!st&&st.verified===true;});
      const categoryMap=await supabaseCategoryMap(list.map(p=>p.category_id));
      let out=list.map(p=>{
        const legacy=db.products.find(x=>String(x.id)===String(p.id));
        return supabaseProductToPublic(p,profilesById.get(String(p.seller_id)),storesByOwner.get(String(p.seller_id)),legacy,categoryMap.get(String(p.category_id)));
      });
      out=await attachProductImages(out);
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
      const detailStore=storesByOwner.get(String(p.seller_id));
      if(!detailStore||detailStore.verified!==true)return json(res,404,{error:'Produto não encontrado.'});
      const categoryMap=await supabaseCategoryMap([p.category_id]);
      const legacy=db.products.find(x=>String(x.id)===String(p.id));
      let out=supabaseProductToPublic(p,profilesById.get(String(p.seller_id)),storesByOwner.get(String(p.seller_id)),legacy,categoryMap.get(String(p.category_id)));
      const attached=await attachProductImages([out]);
      out=attached[0]||out;
      mirrorProductToLegacy(db,out);write(db);
      return json(res,200,out);
    }

    if(u.pathname==='/api/products'&&req.method==='POST'){
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const user=await auth(req);
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
      if(stock<1)return json(res,400,{error:'Indica pelo menos 1 unidade de stock.'});
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
      if(store.verified!==true)return json(res,403,{error:'A tua loja ainda aguarda aprovação do administrador. Só podes publicar produtos depois da aprovação.'});
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

      const photoResult=await uploadProductImages(p.id,photos);
      if(!photoResult.ok){
        await supabaseAdmin.from('products').delete().eq('id',p.id);
        return json(res,500,{error:'Não foi possível guardar as fotos do produto.',details:photoResult.error});
      }

      const {profilesById,storesByOwner}=await supabaseSellerMaps([p.seller_id]);
      const out=supabaseProductToPublic(p,profilesById.get(String(p.seller_id)),storesByOwner.get(String(p.seller_id)),{emoji:String(b.emoji||'📦'),rating:5,score:Number(user.score||50),seller:user.name,cat:category.name,category:category.name,condition,location,photos},category);
      mirrorProductToLegacy(db,out);write(db);
      return json(res,201,out);
    }

    if(pm&&req.method==='PATCH'){
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const user=await auth(req);
      if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(user.role!=='seller')return json(res,403,{error:'Apenas vendedores podem editar produtos.'});
      const id=decodeURIComponent(pm[1]);
      const {data:existing,error:findError}=await supabaseAdmin.from('products').select('id,seller_id,store_id,category_id,name,slug,description,price,stock,status,views,created_at,updated_at').eq('id',id).maybeSingle();
      if(findError)return json(res,500,{error:'Não foi possível consultar o produto.',details:findError.message});
      if(!existing)return json(res,404,{error:'Produto não encontrado.'});
      if(String(existing.seller_id)!==String(user.id))return json(res,403,{error:'Sem permissão para editar este produto.'});
      const {data:productStore,error:productStoreError}=await supabaseAdmin.from('stores').select('id,verified').eq('id',existing.store_id).eq('owner_id',user.id).maybeSingle();
      if(productStoreError)return json(res,500,{error:'Não foi possível verificar a aprovação da loja.',details:productStoreError.message});
      if(!productStore||productStore.verified!==true)return json(res,403,{error:'A tua loja não está aprovada pelo administrador. O produto não pode ser editado enquanto a loja não estiver aprovada.'});
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
      const effectiveStatus=stock===0?'inactive':status;
      const patch={name,price,category_id:category.id,description,stock,status:effectiveStatus,updated_at:new Date().toISOString()};
      if(b.slug!==undefined)patch.slug=slugify(b.slug)||productSlug(name);
      else if(!existing.slug)patch.slug=productSlug(name);
      const {data:p,error}=await supabaseAdmin.from('products').update(patch).eq('id',id).eq('seller_id',user.id).select('id,seller_id,store_id,category_id,name,slug,description,price,stock,status,views,created_at,updated_at').single();
      if(error)return json(res,500,{error:'Não foi possível atualizar o produto.',details:error.message});

      if(b.photos!==undefined){
        const photoResult=await replaceProductImages(p.id,photos);
        if(!photoResult.ok)return json(res,500,{error:'Não foi possível atualizar as fotos do produto.',details:photoResult.error});
      }

      const out=supabaseProductToPublic(p,undefined,undefined,{...legacy,emoji:b.emoji!==undefined?String(b.emoji||'📦'):legacy.emoji,rating:legacy.rating||5,score:legacy.score||50,seller:legacy.seller||user.name,condition,location,photos},category);
      const {profilesById,storesByOwner}=await supabaseSellerMaps([p.seller_id]);
      const finalOut=supabaseProductToPublic(p,profilesById.get(String(p.seller_id)),storesByOwner.get(String(p.seller_id)),{...legacy,emoji:b.emoji!==undefined?String(b.emoji||'📦'):legacy.emoji,rating:legacy.rating||5,score:legacy.score||50,seller:legacy.seller||user.name,condition,location,photos},category);
      mirrorProductToLegacy(db,finalOut);write(db);
      return json(res,200,finalOut);
    }

    const fav=u.pathname.match(/^\/api\/favorites\/([^/]+)$/);
    if(u.pathname==='/api/favorites'&&req.method==='GET'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
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
      let out=ids.map(id=>byId.get(id)).filter(Boolean).map(p=>{const legacy=db.products.find(x=>String(x.id)===String(p.id));return supabaseProductToPublic(p,profilesById.get(String(p.seller_id)),storesByOwner.get(String(p.seller_id)),legacy,categoryMap.get(String(p.category_id)));});
      out=await attachProductImages(out);
      for(const p of out)mirrorProductToLegacy(db,p);write(db);return json(res,200,out);
    }
    if(fav&&req.method==='POST'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
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
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const productId=decodeURIComponent(fav[1]);
      const {error}=await supabaseAdmin.from('favorites').delete().eq('user_id',user.id).eq('product_id',productId);
      if(error)return json(res,500,{error:'Não foi possível remover o favorito.',details:error.message});
      return json(res,200,{ok:true});
    }

    const cartItem=u.pathname.match(/^\/api\/cart\/([^/]+)$/);
    if(u.pathname==='/api/cart'&&req.method==='GET'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
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
      let out=(rows||[]).map(row=>{const p=byId.get(String(row.product_id));if(!p)return null;const legacy=db.products.find(x=>String(x.id)===String(p.id));const product=supabaseProductToPublic(p,profilesById.get(String(p.seller_id)),storesByOwner.get(String(p.seller_id)),legacy,categoryMap.get(String(p.category_id)));return {id:String(row.id),userId:user.id,productId:String(row.product_id),qty:Number(row.quantity||1),quantity:Number(row.quantity||1),createdAt:row.created_at,product};}).filter(Boolean);
      const attached=await attachProductImages(out.map(x=>x.product));
      const attachedById=new Map(attached.map(x=>[String(x.id),x]));
      out=out.map(x=>({...x,product:attachedById.get(String(x.product.id))||x.product}));
      for(const item of out)mirrorProductToLegacy(db,item.product);write(db);return json(res,200,out);
    }
    if(u.pathname==='/api/cart'&&req.method==='POST'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
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
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
      const productId=decodeURIComponent(cartItem[1]);
      const {error}=await supabaseAdmin.from('cart_items').delete().eq('user_id',user.id).eq('product_id',productId);
      if(error)return json(res,500,{error:'Não foi possível remover do carrinho.',details:error.message});
      return json(res,200,{ok:true});
    }

    if(u.pathname==='/api/orders'&&req.method==='POST'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão para comprar.'});
      try{
        const b=await body(req);
        const result=await createSupabaseOrder(db,user,b);
        if(result.error)return json(res,400,{error:result.error});
        return json(res,201,result.order);
      }catch(e){
        console.error('Erro ao criar pedido Supabase:',e.message||e);
        return json(res,500,{error:e.message||'Não foi possível criar o pedido.'});
      }
    }
    if(u.pathname==='/api/orders'&&req.method==='GET'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão para ver pedidos.'});
      try{
        const orders=await getSupabaseOrdersForBuyer(user.id,db);
        for(const order of orders)await mirrorOrderToLegacy(db,order);
        await processProtectionReleases(db);
        return json(res,200,orders.map(order=>({...order,financials:db.orders.find(o=>String(o.id)===String(order.id))?.financials||order.financials||null})));
      }catch(e){
        console.error('Erro ao carregar pedidos Supabase:',e.message||e);
        return json(res,500,{error:e.message||'Não foi possível carregar os pedidos.'});
      }
    }

    // ============================================================
    // ADMIN — GESTÃO DE PAGAMENTOS
    // Lista pagamentos de toda a plataforma para administradores.
    // ============================================================
    if(u.pathname==='/api/admin/payments'&&req.method==='GET'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(!adminOnly(user))return json(res,403,{error:'Apenas administradores podem gerir pagamentos.'});
      try{
        if(!supabaseAdmin)throw new Error('Supabase não está configurado no servidor.');
        const statusFilter=String(u.query.status||'').trim();
        let query=supabaseAdmin
          .from('orders')
          .select('id,buyer_id,status,subtotal,delivery_fee,total,delivery_method,recipient_name,recipient_phone,delivery_address,payment_method,payment_status,payment_reference,status_history,created_at,updated_at')
          .order('created_at',{ascending:false});
        if(statusFilter)query=query.eq('payment_status',statusFilter);
        const {data,error}=await query;
        if(error)throw new Error('Não foi possível carregar os pagamentos: '+error.message);
        const orders=await supabaseOrdersToPublic(data||[],db);
        return json(res,200,orders);
      }catch(e){
        console.error('Erro ao carregar gestão de pagamentos:',e.message||e);
        return json(res,500,{error:e.message||'Não foi possível carregar os pagamentos.'});
      }
    }

    // ============================================================
    // PAGAMENTOS — SUPABASE SOURCE OF TRUTH
    // O pagamento pertence ao pedido. Nesta fase não existe provedor
    // automático: o comprador pode enviar uma referência e o admin
    // pode confirmar/recusar/reembolsar o pagamento.
    // ============================================================
    const paymentRoute=u.pathname.match(/^\/api\/orders\/([^/]+)\/payment$/);
    if(paymentRoute&&req.method==='GET'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      try{
        const order=await getSupabaseOrderForId(decodeURIComponent(paymentRoute[1]),db);
        if(!order)return json(res,404,{error:'Pedido não encontrado.'});
        const sellerIds=[...new Set((order.items||[]).map(i=>String(i.sellerId||'')).filter(Boolean))];
        if(order.userId!==user.id&&!sellerIds.includes(String(user.id))&&!adminOnly(user))return json(res,403,{error:'Sem permissão.'});
        return json(res,200,{orderId:order.id,total:order.total,payment:publicPayment(order),paymentInstructions:paymentInstructions(order)});
      }catch(e){return json(res,500,{error:e.message||'Não foi possível carregar o pagamento.'});}
    }
    if(paymentRoute&&req.method==='POST'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      try{
        const id=decodeURIComponent(paymentRoute[1]);
        const order=await getSupabaseOrderForId(id,db);
        if(!order)return json(res,404,{error:'Pedido não encontrado.'});
        if(String(order.userId)!==String(user.id))return json(res,403,{error:'Apenas o comprador pode enviar o comprovativo.'});
        if(!PAYMENT_METHODS.includes(String(order.payment?.method||'')))return json(res,400,{error:'Método de pagamento inválido.'});
        if(['Pago','Reembolsado'].includes(paymentStatusLabel(order.payment?.status)))return json(res,409,{error:'Este pagamento não pode ser enviado novamente.'});
        const b=await body(req,64*1024);
        const reference=String(b.reference||b.bankReference||b.bankPaymentReference||'').trim().slice(0,120);
        if(reference.length<3)return json(res,400,{error:'Indica a referência do pagamento.'});
        const updated=await updateSupabasePayment(id,'Aguardando confirmação',reference,db);
        if(!updated)return json(res,404,{error:'Pedido não encontrado.'});
        notify(db,user.id,'payment','Pagamento enviado','A referência do pagamento foi enviada e aguarda confirmação.',{orderId:id,status:'Aguardando confirmação'});
        const sellerIds=[...new Set((updated.items||[]).map(i=>String(i.sellerId||'')).filter(Boolean))];
        for(const sid of sellerIds)notify(db,sid,'payment','Pagamento enviado',`O pagamento do pedido #${String(id).slice(-8)} aguarda confirmação.`,{orderId:id,status:'Aguardando confirmação'});
        write(db);return json(res,200,{orderId:id,payment:publicPayment(updated),paymentInstructions:paymentInstructions(updated)});
      }catch(e){return json(res,500,{error:e.message||'Não foi possível enviar o pagamento.'});}
    }
    if(paymentRoute&&req.method==='PATCH'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(!adminOnly(user))return json(res,403,{error:'Apenas administradores podem gerir pagamentos.'});
      try{
        const id=decodeURIComponent(paymentRoute[1]);
        const order=await getSupabaseOrderForId(id,db);
        if(!order)return json(res,404,{error:'Pedido não encontrado.'});
        const b=await body(req,64*1024);
        const next=String(b.status||'').trim();
        if(!PAYMENT_STATUSES.includes(next))return json(res,400,{error:'Estado de pagamento inválido.'});
        const currentStatus=paymentStatusLabel(order.payment?.status);
        if(!canTransition(PAYMENT_TRANSITIONS,currentStatus,next))return json(res,409,{error:`Transição de pagamento inválida: ${currentStatus} → ${next}.`});
        if(next==='Pago'&&(!order.payment?.method||!PAYMENT_METHODS.includes(String(order.payment.method))))return json(res,409,{error:'O método de pagamento do pedido é inválido.'});
        if(next==='Pago'&&!String(b.reference??order.payment?.reference??'').trim())return json(res,409,{error:'É necessária uma referência de pagamento para confirmar.'});
        if(next==='Reembolsado'&&order.financials?.settled)return json(res,409,{error:'Esta venda já foi liquidada e não pode ser reembolsada por este fluxo.'});
        let updated=null;
        const legacyOrder=db.orders.find(o=>String(o.id)===String(id));
        if(next==='Reembolsado'){
          const target=legacyOrder||order;
          await refundPendingOrder(db,target,'Pagamento reembolsado pelo Kuanza Line');
          updated=await getSupabaseOrderForId(id,db);
          if(legacyOrder)legacyOrder.payment=updated?.payment||{...(legacyOrder.payment||{}),status:'Reembolsado'};
        }else{
          updated=await updateSupabasePayment(id,next,b.reference,db);
          if(legacyOrder){
            legacyOrder.payment=updated.payment;
            if(next==='Pago')await addPendingForPaidOrder(db,legacyOrder);
            if(next==='Pago'&&legacyOrder.status==='Entregue')await startDeliveryProtection(db,legacyOrder);
          }
        }
        if(!updated)return json(res,404,{error:'Pedido não encontrado.'});
        audit(db,req,user.id,'payment_updated',{orderId:id,from:currentStatus,to:next});
        notify(db,updated.userId,'payment','Estado do pagamento',`O pagamento do pedido #${String(id).slice(-8)} está agora: ${next}.`,{orderId:id,status:next});
        write(db);return json(res,200,{orderId:id,payment:publicPayment(updated),financials:legacyOrder?.financials||await getOrderFinancials(id)||null});
      }catch(e){return json(res,500,{error:e.message||'Não foi possível atualizar o pagamento.'});}
    }

    // Kuanza Score V1.2: avaliações reais de compradores sobre vendedores/produtos.
    if(u.pathname==='/api/notifications'&&req.method==='GET'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      const list=db.notifications.filter(n=>n.userId===user.id).slice(0,50);
      return json(res,200,{items:list,unread:list.filter(n=>!n.read).length});
    }
    const nr=u.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if(nr&&req.method==='PATCH'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      const n=db.notifications.find(x=>x.id===nr[1]&&x.userId===user.id);
      if(!n)return json(res,404,{error:'Notificação não encontrada.'});
      n.read=true;write(db);return json(res,200,n);
    }
    if(u.pathname==='/api/notifications/read-all'&&req.method==='PATCH'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      db.notifications.filter(n=>n.userId===user.id).forEach(n=>n.read=true);write(db);return json(res,200,{ok:true});
    }
    if(u.pathname==='/api/wallet'&&req.method==='GET'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      const summary=await walletSummary(db,user.id);return json(res,200,summary);
    }
    if(u.pathname==='/api/wallet/transactions'&&req.method==='GET'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      return json(res,200,(await getWalletSummary(user.id)).transactions);
    }
    if(u.pathname==='/api/wallet/withdraw'&&req.method==='POST'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      const b=await body(req);const amount=Math.floor(Number(b.amount||0));
      if(amount<=0)return json(res,400,{error:'Valor de levantamento inválido.'});
      if(amount<1000)return json(res,400,{error:'O levantamento mínimo é Kz 1.000.'});
      const method=String(b.method||'').trim().slice(0,50);
      const accountReference=String(b.accountReference||b.account||'').trim().slice(0,200);
      if(!method||!accountReference)return json(res,400,{error:'Indica o método e os dados da conta para o levantamento.'});
      try{
        const result=await supabaseAdmin.rpc('kuanza_create_withdrawal',{p_user_id:String(user.id),p_amount:amount,p_method:method,p_account_reference:accountReference});
        if(result.error)throw new Error(result.error.message);
        const data=result.data;
        audit(db,req,user.id,'withdrawal_requested',{withdrawalId:data.id,amount});
        notify(db,user.id,'wallet','Levantamento solicitado',`Pedido de levantamento de Kz ${amount.toLocaleString('pt-AO')} criado.`,{withdrawalId:data.id,amount});
        write(db);return json(res,201,{ok:true,status:data.status,amount:Number(data.amount),withdrawal:data,wallet:await walletSummary(db,user.id)});
      }catch(e){return json(res,400,{error:e.message||'Não foi possível criar o levantamento.'});}
    }
    if(u.pathname==='/api/admin/withdrawals'&&req.method==='GET'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(!adminOnly(user))return json(res,403,{error:'Apenas administradores.'});
      const status=String(u.query.status||'').trim();
      let q=supabaseAdmin.from('withdrawals').select('*').order('requested_at',{ascending:false}).limit(200);
      if(status)q=q.eq('status',status);
      const {data,error}=await q;if(error)return json(res,500,{error:error.message});
      return json(res,200,data||[]);
    }
    const withdrawalRoute=u.pathname.match(/^\/api\/admin\/withdrawals\/([^/]+)$/);
    if(withdrawalRoute&&req.method==='PATCH'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(!adminOnly(user))return json(res,403,{error:'Apenas administradores.'});
      const id=decodeURIComponent(withdrawalRoute[1]); const b=await body(req,64*1024); const next=String(b.status||'').trim();
      if(!['Em análise','Aprovado','Pago','Rejeitado'].includes(next))return json(res,400,{error:'Estado de levantamento inválido.'});
      try{
        const result=await supabaseAdmin.rpc('kuanza_process_withdrawal',{p_withdrawal_id:id,p_next_status:next,p_admin_note:String(b.adminNote||'').trim().slice(0,1000)});
        if(result.error)throw new Error(result.error.message);
        audit(db,req,user.id,'withdrawal_updated',{withdrawalId:id,status:next});
        write(db);return json(res,200,result.data);
      }catch(e){return json(res,409,{error:e.message||'Não foi possível atualizar o levantamento.'});}
    }
    if(u.pathname==='/api/disputes'&&req.method==='GET'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      const {data,error}=await supabaseAdmin.from('disputes').select('*').or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`).order('created_at',{ascending:false});if(error)return json(res,500,{error:error.message});return json(res,200,(data||[]).map(d=>({id:String(d.legacy_id||d.id),orderId:String(d.order_id),userId:String(d.buyer_id),sellerId:d.seller_id?String(d.seller_id):null,reason:d.reason,description:d.description,status:d.status,decision:d.decision||undefined,adminNote:d.admin_note||undefined,createdAt:d.created_at,updatedAt:d.updated_at})));
    }
    if(u.pathname==='/api/disputes'&&req.method==='POST'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      const b=await body(req);const orderId=String(b.orderId||'');const order=await getSupabaseOrderForId(orderId,db);if(order&&String(order.userId)!==String(user.id))return json(res,404,{error:'Pedido não encontrado.'});
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
      order.financials={...(order.financials||{}),disputeOpen:true,protectionStatus:order.status==='Entregue'?'Bloqueada por disputa':(order.financials?.protectionStatus||'')};await upsertOrderFinancials(order.id,{dispute_open:true,protection_status:order.status==='Entregue'?'Bloqueada por disputa':(order.financials?.protectionStatus||null)});
      user.complaints=Number(user.complaints||0)+1;
      if(sellerId)notify(db,sellerId,'dispute','Nova reclamação',`Existe uma reclamação no pedido #${String(orderId).slice(-8)}.`,{orderId,disputeId:dispute.id});
      write(db);return json(res,201,dispute);
    }

    const disputeRoute=u.pathname.match(/^\/api\/disputes\/([^/]+)$/);
    if(disputeRoute&&req.method==='PATCH'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(!adminOnly(user))return json(res,403,{error:'Apenas administradores.'});
      const dispute=db.disputes.find(d=>String(d.id)===decodeURIComponent(disputeRoute[1]));
      if(!dispute)return json(res,404,{error:'Reclamação não encontrada.'});
      const b=await body(req,64*1024);
      const status=String(b.status||'').trim();
      const decision=String(b.decision||'').trim();
      if(!['Aberta','Em análise','Resolvida','Rejeitada'].includes(status))return json(res,400,{error:'Estado da reclamação inválido.'});
      if(status==='Resolvida'&&!['release','refund'].includes(decision))return json(res,400,{error:'Indica a decisão: release ou refund.'});
      const order=db.orders.find(o=>String(o.id)===String(dispute.orderId));
      dispute.status=status;dispute.adminNote=String(b.adminNote||'').trim().slice(0,1000);dispute.updatedAt=new Date().toISOString();
      if(order&&status==='Resolvida'){
        if(decision==='release'){
          dispute.decision='release';
          order.financials={...(order.financials||{}),disputeOpen:false,protectionStatus:'Resolvida — valor libertado'};
          if(order.status==='Entregue'&&paymentStatusLabel(order.payment?.status)==='Pago'){
            const f=order.financials||{};order.financials={...f,protectionUntil:new Date().toISOString()};await settleDeliveredOrder(db,order);
          }
        }else{
          dispute.decision='refund';
          order.financials={...(order.financials||{}),disputeOpen:false};
          await refundPendingOrder(db,order,'Venda reembolsada após resolução de disputa');
          try{await updateSupabasePayment(order.id,'Reembolsado',undefined,db);}catch(e){return json(res,500,{error:e.message||'Não foi possível marcar o pagamento como reembolsado.'});}
          order.payment={...(order.payment||{}),status:'Reembolsado'};
        }
      }else if(order&&['Rejeitada'].includes(status)){
        order.financials={...(order.financials||{}),disputeOpen:false,protectionStatus:order.status==='Entregue'?'Em proteção':'Normal'};
      }
      audit(db,req,user.id,'dispute_updated',{disputeId:dispute.id,orderId:dispute.orderId,status,decision});
      write(db);return json(res,200,{dispute,order:order||null});
    }

    // V1.3 seller dashboard
    if(u.pathname==='/api/seller/dashboard'&&req.method==='GET'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
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
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(user.role!=='seller')return json(res,403,{error:'Muda a tua conta para Vendedor.'});
      try{
        if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
        const {data:itemRows,error:itemError}=await supabaseAdmin
          .from('order_items')
          .select('order_id')
          .eq('seller_id',String(user.id));
        if(itemError)throw new Error('Não foi possível carregar as vendas: '+itemError.message);
        const ids=[...new Set((itemRows||[]).map(x=>String(x.order_id)).filter(Boolean))];
        if(!ids.length)return json(res,200,[]);
        const {data:orders,error:ordersError}=await supabaseAdmin
          .from('orders')
          .select('id,buyer_id,status,subtotal,delivery_fee,total,delivery_method,recipient_name,recipient_phone,delivery_address,payment_method,payment_status,payment_reference,status_history,created_at,updated_at')
          .in('id',ids)
          .order('created_at',{ascending:false});
        if(ordersError)throw new Error('Não foi possível carregar os pedidos das vendas: '+ordersError.message);
        const all=await supabaseOrdersToPublic(orders||[],db);
        const out=all.map(order=>({...order,items:order.items.filter(i=>String(i.sellerId)===String(user.id))})).filter(order=>order.items.length);
        for(const order of all)await mirrorOrderToLegacy(db,order);
        write(db);
        return json(res,200,out);
      }catch(e){
        console.error('Erro ao carregar vendas Supabase:',e.message||e);
        return json(res,500,{error:e.message||'Não foi possível carregar as vendas.'});
      }
    }

    if(u.pathname.startsWith('/api/seller/orders/')&&req.method==='PATCH'){
      const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(user.role!=='seller')return json(res,403,{error:'Muda a tua conta para Vendedor.'});
      const id=decodeURIComponent(u.pathname.split('/').pop()||'');
      try{
        if(!supabaseAdmin)return json(res,503,{error:'Supabase não está configurado no servidor.'});
        const current=await getSupabaseOrderForId(id,db);
        if(!current)return json(res,404,{error:'Pedido não encontrado.'});
        if(!current.items.some(i=>String(i.sellerId)===String(user.id)))return json(res,403,{error:'Este pedido não pertence às tuas vendas.'});
        const b=await body(req); const next=String(b.status||''); const previous=String(current.status||'Pendente');
        if(!Object.prototype.hasOwnProperty.call(ORDER_TRANSITIONS,previous))return json(res,409,{error:'Estado atual do pedido inválido.'});
        if(!canTransition(ORDER_TRANSITIONS,previous,next))return json(res,409,{error:`Transição de pedido inválida: ${previous} → ${next}.`});
        if(next==='Cancelado'&&['Entregue','Cancelado'].includes(previous))return json(res,409,{error:'Este pedido já não pode ser cancelado.'});
        let updated;
        if(next==='Entregue'){
          const delivery=await ensureDeliveryForOrder(db,current);
          if(!delivery)return json(res,409,{error:'Não foi possível localizar a entrega deste pedido.'});
          const atomic=await supabaseAdmin.rpc('kuanza_deliver_and_complete_order',{p_delivery_id:String(delivery.id)});
          if(atomic.error)throw new Error(atomic.error.message);
          updated=await getSupabaseOrderForId(id,db);
        }else{
          updated=await updateSupabaseOrderStatus(id,next,db);
        }
        if(!updated)return json(res,404,{error:'Pedido não encontrado.'});
        await mirrorOrderToLegacy(db,updated);
        const order=db.orders.find(o=>String(o.id)===String(id))||updated; order.items=updated.items;
        if(previous!==next){
          if(next==='Cancelado'&&paymentStatusLabel(order.payment?.status)==='Pago'&&!order.financials?.settled){
            await refundPendingOrder(db,order,'Venda cancelada pelo vendedor');
            const refreshed=await getSupabaseOrderForId(order.id,db);
            order.payment=refreshed?.payment||{...(order.payment||{}),status:'Reembolsado'};
          } else if(next==='Cancelado'&&!order.financials?.cancelled){
            await upsertOrderFinancials(order.id,{cancelled:true,cancelled_at:new Date().toISOString(),protection_status:'Cancelada'});
            order.financials={...(order.financials||{}),cancelled:true,cancelledAt:new Date().toISOString(),protectionStatus:'Cancelada'};
          }
          notify(db,order.userId,'order','Pedido atualizado',`O pedido #${String(order.id).slice(-8)} está agora: ${next}.`,{orderId:order.id,status:next});
          const delivery=await ensureDeliveryForOrder(db,order); const ds=deliveryStatusFromOrderStatus(next);
          if(delivery&&delivery.status!==ds){
            const updatedDelivery=await updateSupabaseDeliveryStatus(delivery.id,ds);
            if(updatedDelivery){const i=db.deliveries.findIndex(x=>String(x.id)===String(updatedDelivery.id));if(i>=0)db.deliveries[i]=updatedDelivery;else db.deliveries.unshift(updatedDelivery);notify(db,order.userId,'delivery','Entrega atualizada',`A entrega do pedido #${String(order.id).slice(-8)} está agora: ${ds}.`,{orderId:order.id,deliveryId:updatedDelivery.id,status:ds});}
          }
        }
        order.status=updated.status;order.statusHistory=updated.statusHistory;order.updatedAt=updated.updatedAt;
        audit(db,req,user.id,'seller_order_status_updated',{orderId:id,from:previous,to:next});
        write(db);return json(res,200,order);
      }catch(e){console.error('Erro ao atualizar pedido Supabase:',e.message||e);return json(res,500,{error:e.message||'Não foi possível atualizar o pedido.'});}
    }

    if(u.pathname==='/api/deliveries'&&req.method==='GET'){
      const user=await auth(req); if(!user)return json(res,401,{error:'Inicia sessão.'});
      try{
        const {data,error}=await supabaseAdmin.from('deliveries').select('*').or(`buyer_id.eq.${user.id},seller_ids.cs.{${user.id}}`).order('created_at',{ascending:false}).limit(100);
        if(error)throw new Error(error.message);
        return json(res,200,(data||[]).map(publicDelivery));
      }catch(e){console.error('Erro ao carregar entregas Supabase:',e.message||e);return json(res,500,{error:e.message||'Não foi possível carregar as entregas.'});}
    }

    if(u.pathname.startsWith('/api/deliveries/')&&req.method==='GET'){
      const user=await auth(req); if(!user)return json(res,401,{error:'Inicia sessão.'});
      const id=decodeURIComponent(u.pathname.split('/').pop()||'');
      try{
        const d=await getSupabaseDeliveryForId(id); if(!d)return json(res,404,{error:'Entrega não encontrada.'});
        const p=publicDelivery(d); if(p.buyerId!==user.id&&!p.sellerIds.includes(String(user.id)))return json(res,403,{error:'Sem permissão.'});
        return json(res,200,p);
      }catch(e){return json(res,500,{error:e.message||'Não foi possível carregar a entrega.'});}
    }

    if(u.pathname.startsWith('/api/deliveries/')&&req.method==='PATCH'){
      const user=await auth(req); if(!user)return json(res,401,{error:'Inicia sessão.'});
      if(user.role!=='seller')return json(res,403,{error:'Apenas vendedores podem atualizar a entrega.'});
      const id=decodeURIComponent(u.pathname.split('/').pop()||'');
      const b=await body(req); const allowed=['A preparar','Recolhida','Em trânsito','Chegou à zona','Entregue','Cancelada']; const next=String(b.status||'');
      if(!allowed.includes(next))return json(res,400,{error:'Estado de entrega inválido.'});
      try{
        const current=await getSupabaseDeliveryForId(id); if(!current)return json(res,404,{error:'Entrega não encontrada.'});
        const p=publicDelivery(current); if(!p.sellerIds.includes(String(user.id)))return json(res,403,{error:'Sem permissão.'});
        const previous=p.status;
        let updated;
        if(next==='Entregue'){
          const atomic=await supabaseAdmin.rpc('kuanza_deliver_and_complete_order',{p_delivery_id:String(id)});
          if(atomic.error)throw new Error(atomic.error.message);
          updated=publicDelivery((await getSupabaseDeliveryForId(id)));
        }else{
          updated=await updateSupabaseDeliveryStatus(id,next);
        }
        if(!updated)return json(res,404,{error:'Entrega não encontrada.'});
        if(previous!==next&&updated.buyerId)notify(db,updated.buyerId,'delivery','Estado da entrega',`A entrega do pedido #${String(updated.orderId).slice(-8)} está agora: ${next}.`,{orderId:updated.orderId,deliveryId:updated.id,status:next});
        const i=db.deliveries.findIndex(x=>String(x.id)===String(updated.id)); if(i>=0)db.deliveries[i]=updated;else db.deliveries.unshift(updated);
        write(db); return json(res,200,updated);
      }catch(e){console.error('Erro ao atualizar entrega Supabase:',e.message||e);return json(res,500,{error:e.message||'Não foi possível atualizar a entrega.'});}
    }

    if(u.pathname==='/api/reviews'&&req.method==='GET'){
      const productId=String(u.query.productId||''); const sellerId=String(u.query.sellerId||'');
      let list=db.reviews.slice(); if(productId)list=list.filter(r=>r.productId===productId); if(sellerId)list=list.filter(r=>r.sellerId===sellerId);
      const buyerIds=[...new Set(list.map(r=>String(r.buyerId||'')).filter(Boolean))];
      const buyerProfiles=new Map();
      if(supabaseAdmin&&buyerIds.length){const {data:profiles,error}=await supabaseAdmin.from('profiles').select('id,full_name').in('id',buyerIds);if(error)return json(res,500,{error:'Não foi possível carregar os autores das avaliações.',details:error.message});for(const p of profiles||[])buyerProfiles.set(String(p.id),p);}
      list=list.map(r=>({...r,buyerName:String(buyerProfiles.get(String(r.buyerId))?.full_name||'Utilizador')})).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
      return json(res,200,list);
    }
    if(u.pathname==='/api/reviews'&&req.method==='POST'){
      const user=await auth(req); if(!user)return json(res,401,{error:'Inicia sessão para avaliar.'});
      const b=await body(req); const productId=String(b.productId||''); const product=db.products.find(x=>x.id===productId);
      if(!product)return json(res,404,{error:'Produto não encontrado.'});
      if(product.sellerId===user.id)return json(res,400,{error:'Não podes avaliar o teu próprio produto.'});
      const rating=Math.round(Number(b.rating||0)); if(rating<1||rating>5)return json(res,400,{error:'A avaliação deve ser de 1 a 5 estrelas.'});
      if(db.reviews.some(r=>r.productId===productId&&r.buyerId===user.id))return json(res,409,{error:'Já avalieste este produto.'});
      const comment=String(b.comment||'').trim().slice(0,500);
      const review={id:crypto.randomUUID(),productId,sellerId:product.sellerId,buyerId:user.id,rating,comment,createdAt:new Date().toISOString()};
      db.reviews.unshift(review);
      const sellerProfile=await getProfileById(product.sellerId);
      const seller=sellerProfile?profileToUser(sellerProfile):null;
      let sellerScore=null;
      if(seller){
        sellerScore=calculateScore(db,seller);
        if(supabaseAdmin){const {error:scoreError}=await supabaseAdmin.from('profiles').update({score:sellerScore,updated_at:new Date().toISOString()}).eq('id',seller.id);if(scoreError)return json(res,500,{error:'A avaliação foi guardada, mas não foi possível atualizar a pontuação do vendedor.',details:scoreError.message});}
        notify(db,seller.id,'review','Nova avaliação',`Recebeste uma nova avaliação de ${review.rating} estrelas.`,{productId:product.id,rating:review.rating});
      }
      write(db);
      return json(res,201,{...review,buyerName:user.name,sellerScore});
    }

    // Security & moderation.
    if(u.pathname==='/api/reports'&&req.method==='GET'){const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});return json(res,200,adminOnly(user)?db.reports.slice(0,200):db.reports.filter(r=>r.reporterId===user.id).slice(0,100));}
    if(u.pathname==='/api/reports'&&req.method==='POST'){const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});const b=await body(req,256*1024);const targetType=String(b.targetType||'user');if(!['user','product','order','conversation'].includes(targetType))return json(res,400,{error:'Tipo de denúncia inválido.'});const targetId=String(b.targetId||'').trim();const reason=String(b.reason||'').trim().slice(0,120);const description=String(b.description||'').trim().slice(0,1000);if(!targetId||!reason)return json(res,400,{error:'Indica o alvo e o motivo da denúncia.'});const r={id:'REP-'+crypto.randomUUID(),reporterId:user.id,targetType,targetId,reason,description,status:'Aberta',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};db.reports.unshift(r);audit(db,req,user.id,'report_created',{reportId:r.id,targetType,targetId});write(db);return json(res,201,r);}
    const rr=u.pathname.match(/^\/api\/reports\/([^/]+)$/);if(rr&&req.method==='PATCH'){const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});if(!adminOnly(user))return json(res,403,{error:'Apenas administradores.'});const r=db.reports.find(x=>x.id===decodeURIComponent(rr[1]));if(!r)return json(res,404,{error:'Denúncia não encontrada.'});const b=await body(req,64*1024);const allowed=['Aberta','Em análise','Resolvida','Rejeitada'];if(!allowed.includes(String(b.status||'')))return json(res,400,{error:'Estado inválido.'});r.status=String(b.status);r.adminNote=String(b.adminNote||'').trim().slice(0,1000);r.updatedAt=new Date().toISOString();audit(db,req,user.id,'report_updated',{reportId:r.id,status:r.status});write(db);return json(res,200,r);}
    if(u.pathname==='/api/admin/security'&&req.method==='GET'){const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});if(!adminOnly(user))return json(res,403,{error:'Apenas administradores.'});return json(res,200,{events:db.securityEvents.slice(0,200),reports:db.reports.slice(0,200),blockedUsers:db.blockedUsers.slice(0,200)});}
    if(u.pathname==='/api/admin/block'&&req.method==='POST'){const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});if(!adminOnly(user))return json(res,403,{error:'Apenas administradores.'});const b=await body(req,64*1024);const targetId=String(b.userId||'').trim();if(!targetId||targetId===user.id)return json(res,400,{error:'Utilizador inválido.'});const targetProfile=await getProfileById(targetId);if(!targetProfile)return json(res,404,{error:'Utilizador não encontrado.'});let bl=db.blockedUsers.find(x=>x.userId===targetId);if(!bl){bl={id:'BLK-'+crypto.randomUUID(),userId:targetId,active:true,reason:String(b.reason||'').trim().slice(0,500),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};db.blockedUsers.push(bl);}else{bl.active=b.active!==false;bl.reason=String(b.reason||bl.reason||'').trim().slice(0,500);bl.updatedAt=new Date().toISOString();}audit(db,req,user.id,bl.active?'user_blocked':'user_unblocked',{userId:targetId,reason:bl.reason});write(db);return json(res,200,bl);}

    // Chat: one private conversation between a buyer and seller, linked optionally to a product.
    if(u.pathname==='/api/conversations'&&req.method==='GET'){const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});const rawList=db.conversations.filter(c=>c.participants.includes(user.id));const list=[];for(const c of rawList){const otherId=c.participants.find(id=>id!==user.id);const otherProfile=await getProfileById(otherId);const other=otherProfile?profileToUser(otherProfile):null;const last=db.messages.filter(m=>m.conversationId===c.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];const product=c.productId?db.products.find(p=>p.id===c.productId):null;list.push({...c,other:other?publicUser(other,db):null,otherName:other?.name||'',lastMessage:last||null,lastMessageText:last?(last.type==='offer'?`Proposta: Kz ${Number(last.amount||0).toLocaleString('pt-AO')}`:(last.text||'')):'',product:product?publicProduct(db,product):null,productName:product?.name||'Conversa Kuanza Line'});}list.sort((a,b)=>new Date(b.lastMessage?.createdAt||b.createdAt)-new Date(a.lastMessage?.createdAt||a.createdAt));return json(res,200,list);}
    if(u.pathname==='/api/conversations'&&req.method==='POST'){const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});const b=await body(req);const sellerId=String(b.sellerId||'');if(!sellerId||sellerId===user.id)return json(res,400,{error:'Vendedor inválido.'});const seller=await getProfileById(sellerId);if(!seller)return json(res,404,{error:'Vendedor não encontrado.'});const key=conversationKey(user.id,sellerId);let c=db.conversations.find(x=>x.key===key&&String(x.productId||'')===String(b.productId||''));if(!c){c={id:crypto.randomUUID(),key,participants:[user.id,sellerId],productId:b.productId||null,createdAt:new Date().toISOString()};db.conversations.push(c);write(db);}return json(res,201,c);}
    const conv=u.pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if(conv&&req.method==='GET'){const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});const c=db.conversations.find(x=>x.id===conv[1]&&x.participants.includes(user.id));if(!c)return json(res,404,{error:'Conversa não encontrada.'});const otherProfile=await getProfileById(c.participants.find(id=>id!==user.id));const other=otherProfile?profileToUser(otherProfile):null;const product=c.productId?db.products.find(p=>p.id===c.productId):null;const messages=db.messages.filter(m=>m.conversationId===c.id).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));return json(res,200,{conversation:{...c,other:other?publicUser(other,db):null,otherName:other?.name||'',product:product?publicProduct(db,product):null,productName:product?.name||'Conversa Kuanza Line'},messages});}
    if(conv&&req.method==='POST'){const user=await auth(req);if(!user)return json(res,401,{error:'Inicia sessão.'});const c=db.conversations.find(x=>x.id===conv[1]&&x.participants.includes(user.id));if(!c)return json(res,404,{error:'Conversa não encontrada.'});const b=await body(req);const text=String(b.text||'').trim();const type=b.type==='offer'?'offer':'text';if(!text&&type==='text')return json(res,400,{error:'Escreve uma mensagem.'});if(type==='offer'&&(!Number(b.amount)||Number(b.amount)<=0))return json(res,400,{error:'Valor da oferta inválido.'});const m={id:crypto.randomUUID(),conversationId:c.id,senderId:user.id,type,text:text||('Oferta de '+Number(b.amount)+' Kz'),amount:type==='offer'?Number(b.amount):null,createdAt:new Date().toISOString()};db.messages.push(m);const recipient=c.participants.find(id=>id!==user.id);if(recipient)notify(db,recipient,'message','Nova mensagem',type==='offer'?`Recebeste uma proposta de ${Number(b.amount).toLocaleString('pt-PT')} Kz.`:'Recebeste uma nova mensagem.',{conversationId:c.id});write(db);return json(res,201,m);}

    const file=path.join(PUBLIC,u.pathname==='/'?'index.html':u.pathname.replace(/^\//,''));
    if(!file.startsWith(PUBLIC)||!fs.existsSync(file)||fs.statSync(file).isDirectory())return json(res,404,{error:'Not found'});
    const ext=path.extname(file),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin'});fs.createReadStream(file).pipe(res);
  }catch(e){console.error(e);if(!res.headersSent)json(res,500,{error:e.message||'Erro interno'});}
});

const PORT=Number(process.env.PORT||3000);
server.listen(PORT,'0.0.0.0',()=>console.log(`Kuanza Line API running on port ${PORT} | Supabase Auth enabled: ${!!(supabaseAuth&&supabaseAdmin)} | Protection: ${PROTECTION_MINUTES} min`));
const protectionWorker=setInterval(async()=>{try{await processProtectionReleases(ensureDB(read()));}catch(e){console.error('Worker de proteção financeira:',e.message||e);}},15000);
protectionWorker.unref();
function shutdown(signal){console.log(`Received ${signal}; shutting down Kuanza Line API.`);server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
