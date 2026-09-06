const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const url = require('node:url');

const ROOT = __dirname;
const PUBLIC = ROOT;
const DB = path.join(ROOT, 'data', 'db.json');

fs.mkdirSync(path.dirname(DB), { recursive: true });

if (!fs.existsSync(DB)) {
  fs.writeFileSync(DB, JSON.stringify({
    users: [],
    stores: [],
    products: [
      {id:'p1',name:'iPhone 13 128GB',price:450000,cat:'Eletrónicos',emoji:'📱',seller:'Beni Store',sellerId:'demo1',verified:true,rating:4.9},
      {id:'p2',name:'Smart TV 43"',price:320000,cat:'Eletrónicos',emoji:'📺',seller:'Casa Digital',sellerId:'demo2',verified:true,rating:4.8},
      {id:'p3',name:'Conjunto Streetwear',price:45000,cat:'Moda',emoji:'👕',seller:'Style AO',sellerId:'demo3',verified:true,rating:4.7}
    ],
    orders: [],
    sessions: [],
    favorites: [],
    carts: []
  }, null, 2));
}

function read(){
  return JSON.parse(fs.readFileSync(DB,'utf8'));
}

function write(data){
  fs.writeFileSync(DB,JSON.stringify(data,null,2));
}

function json(res,code,data){
  res.writeHead(code,{
    'Content-Type':'application/json',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type,Authorization'
  });
  res.end(JSON.stringify(data));
}

function body(req){
  return new Promise((resolve,reject)=>{
    let s='';
    req.on('data',c=>s+=c);
    req.on('end',()=>{
      try{
        resolve(s?JSON.parse(s):{});
      }catch(e){
        reject(e);
      }
    });
  });
}

function token(){
  return crypto.randomBytes(24).toString('hex');
}

function getUser(req,db){
  const t=(req.headers.authorization||'').replace('Bearer ','');
  if(!t)return null;

  const session=db.sessions.find(x=>x.token===t);
  if(!session)return null;

  return db.users.find(x=>x.id===session.userId)||null;
}

function ensureDB(db){
  if(!db.stores)db.stores=[];
  if(!db.favorites)db.favorites=[];
  if(!db.carts)db.carts=[];
  if(!db.orders)db.orders=[];
  if(!db.sessions)db.sessions=[];
  if(!db.users)db.users=[];
  if(!db.products)db.products=[];
}

const server=http.createServer(async(req,res)=>{

  const u=url.parse(req.url,true);

  if(req.method==='OPTIONS'){
    res.writeHead(204,{
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Headers':'Content-Type,Authorization'
    });
    return res.end();
  }

  try{

    let db=read();
    ensureDB(db);

    /* HEALTH */

    if(u.pathname==='/api/health'){
      return json(res,200,{
        ok:true,
        service:'Kuanza Line API',
        version:'1.0'
      });
    }

    /* PRODUTOS */

    if(u.pathname==='/api/products'&&req.method==='GET'){

      let products=[...db.products];

      const search=String(u.query.search||'').toLowerCase();
      const cat=String(u.query.cat||'');

      if(search){
        products=products.filter(p=>
          String(p.name).toLowerCase().includes(search) ||
          String(p.seller).toLowerCase().includes(search)
        );
      }

      if(cat&&cat!=='Todas'){
        products=products.filter(p=>p.cat===cat);
      }

      if(u.query.sort==='low'){
        products.sort((a,b)=>a.price-b.price);
      }

      if(u.query.sort==='high'){
        products.sort((a,b)=>b.price-a.price);
      }

      return json(res,200,products);
    }

    /* PRODUTO INDIVIDUAL */

    if(u.pathname.startsWith('/api/products/')&&req.method==='GET'){

      const id=u.pathname.split('/')[3];
      const product=db.products.find(p=>p.id===id);

      if(!product){
        return json(res,404,{error:'Produto não encontrado.'});
      }

      return json(res,200,product);
    }

    /* REGISTO */

    if(u.pathname==='/api/register'&&req.method==='POST'){

      const b=await body(req);

      if(!b.name||!b.email||!b.password){
        return json(res,400,{
          error:'Preenche nome, email e palavra-passe.'
        });
      }

      if(db.users.some(x=>x.email.toLowerCase()===b.email.toLowerCase())){
        return json(res,409,{
          error:'Este email já está registado.'
        });
      }

      const user={
        id:crypto.randomUUID(),
        name:b.name,
        email:b.email.toLowerCase(),
        passwordHash:crypto.createHash('sha256').update(b.password).digest('hex'),
        role:b.role==='seller'?'seller':'buyer',
        score:100,
        rating:5,
        completedSales:0,
        completedPurchases:0,
        cancellations:0,
        complaints:0
      };

      db.users.push(user);

      if(user.role==='seller'){
        db.stores.push({
          id:crypto.randomUUID(),
          ownerId:user.id,
          name:user.name,
          description:'Loja Kuanza Line',
          logo:'🏪',
          rating:5
        });
      }

      const t=token();

      db.sessions.push({
        token:t,
        userId:user.id
      });

      write(db);

      return json(res,201,{
        token:t,
        user:{
          id:user.id,
          name:user.name,
          email:user.email,
          role:user.role,
          score:user.score
        }
      });
    }

    /* LOGIN */

    if(u.pathname==='/api/login'&&req.method==='POST'){

      const b=await body(req);

      const h=crypto.createHash('sha256')
        .update(b.password||'')
        .digest('hex');

      const user=db.users.find(x=>
        x.email===String(b.email||'').toLowerCase() &&
        x.passwordHash===h
      );

      if(!user){
        return json(res,401,{
          error:'Email ou palavra-passe incorretos.'
        });
      }

      const t=token();

      db.sessions.push({
        token:t,
        userId:user.id
      });

      write(db);

      return json(res,200,{
        token:t,
        user:{
          id:user.id,
          name:user.name,
          email:user.email,
          role:user.role,
          score:user.score
        }
      });
    }

    /* PERFIL */

    if(u.pathname==='/api/me'&&req.method==='GET'){

      const user=getUser(req,db);

      if(!user){
        return json(res,401,{
          error:'Não autenticado.'
        });
      }

      return json(res,200,{
        id:user.id,
        name:user.name,
        email:user.email,
        role:user.role,
        score:user.score||100,
        rating:user.rating||5,
        completedSales:user.completedSales||0,
        completedPurchases:user.completedPurchases||0,
        cancellations:user.cancellations||0,
        complaints:user.complaints||0
      });
    }

    /* ALTERAR TIPO DE CONTA */

    if(u.pathname==='/api/me/role'&&req.method==='PATCH'){

      const user=getUser(req,db);

      if(!user){
        return json(res,401,{
          error:'Não autenticado.'
        });
      }

      const b=await body(req);

      if(b.role!=='buyer'&&b.role!=='seller'){
        return json(res,400,{
          error:'Tipo de conta inválido.'
        });
      }

      user.role=b.role;

      if(user.role==='seller'){

        let store=db.stores.find(x=>x.ownerId===user.id);

        if(!store){
          db.stores.push({
            id:crypto.randomUUID(),
            ownerId:user.id,
            name:user.name,
            description:'Loja Kuanza Line',
            logo:'🏪',
            rating:user.rating||5
          });
        }

      }

      write(db);

      return json(res,200,{
        message:'Tipo de conta alterado com sucesso.',
        user:{
          id:user.id,
          name:user.name,
          email:user.email,
          role:user.role,
          score:user.score
        }
      });
    }

    /* LOJA DO VENDEDOR */

    if(u.pathname==='/api/store'&&req.method==='GET'){

      const ownerId=String(u.query.ownerId||'');

      const store=db.stores.find(x=>x.ownerId===ownerId);

      const seller=db.users.find(x=>x.id===ownerId);

      if(!seller){
        return json(res,404,{
          error:'Vendedor não encontrado.'
        });
      }

      const products=db.products.filter(
        x=>x.sellerId===ownerId
      );

      return json(res,200,{
        store:store||{
          name:seller.name,
          description:'Loja Kuanza Line',
          logo:'🏪',
          rating:seller.rating||5
        },
        seller:{
          id:seller.id,
          name:seller.name,
          score:seller.score||100,
          rating:seller.rating||5
        },
        products
      });
    }

    /* ATUALIZAR LOJA */

    if(u.pathname==='/api/store'&&req.method==='PATCH'){

      const user=getUser(req,db);

      if(!user){
        return json(res,401,{
          error:'Não autenticado.'
        });
      }

      if(user.role!=='seller'){
        return json(res,403,{
          error:'Apenas vendedores podem editar a loja.'
        });
      }

      const b=await body(req);

      let store=db.stores.find(
        x=>x.ownerId===user.id
      );

      if(!store){

        store={
          id:crypto.randomUUID(),
          ownerId:user.id
        };

        db.stores.push(store);
      }

      store.name=b.name||store.name||user.name;
      store.description=b.description||store.description||'Loja Kuanza Line';
      store.logo=b.logo||store.logo||'🏪';

      write(db);

      return json(res,200,store);
    }

    /* PUBLICAR PRODUTO */

    if(u.pathname==='/api/products'&&req.method==='POST'){

      const user=getUser(req,db);

      if(!user){
        return json(res,401,{
          error:'Inicia sessão para publicar.'
        });
      }

      if(user.role!=='seller'){
        return json(res,403,{
          error:'Muda a tua conta para vendedor para publicar produtos.'
        });
      }

      const b=await body(req);

      const p={
        id:crypto.randomUUID(),
        name:b.name,
        price:Number(b.price),
        cat:b.cat||'Outros',
        emoji:b.emoji||'📦',
        seller:user.name,
        sellerId:user.id,
        verified:false,
        rating:5
      };

      db.products.unshift(p);

      write(db);

      return json(res,201,p);
    }

    /* FAVORITOS */

    if(u.pathname==='/api/favorites'&&req.method==='GET'){

      const user=getUser(req,db);

      if(!user){
        return json(res,401,{
          error:'Inicia sessão para ver favoritos.'
        });
      }

      const ids=db.favorites
        .filter(x=>x.userId===user.id)
        .map(x=>x.productId);

      return json(res,200,ids);
    }

    if(u.pathname==='/api/favorites'&&req.method==='POST'){

      const user=getUser(req,db);

      if(!user){
        return json(res,401,{
          error:'Inicia sessão para guardar favoritos.'
        });
      }

      const b=await body(req);

      const exists=db.favorites.some(
        x=>x.userId===user.id&&x.productId===b.productId
      );

      if(!exists){

        db.favorites.push({
          userId:user.id,
          productId:b.productId
        });

      }

      write(db);

      return json(res,200,{
        favorite:true
      });
    }

    if(u.pathname==='/api/favorites'&&req.method==='DELETE'){

      const user=getUser(req,db);

      if(!user){
        return json(res,401,{
          error:'Não autenticado.'
        });
      }

      const b=await body(req);

      db.favorites=db.favorites.filter(
        x=>!(x.userId===user.id&&x.productId===b.productId)
      );

      write(db);

      return json(res,200,{
        favorite:false
      });
    }

    /* CARRINHO */

    if(u.pathname==='/api/cart'&&req.method==='GET'){

      const user=getUser(req,db);

      if(!user){
        return json(res,401,{
          error:'Inicia sessão para ver o carrinho.'
        });
      }

      const cart=db.carts.find(
        x=>x.userId===user.id
      );

      return json(res,200,{
        items:cart?cart.items:[]
      });
    }

    if(u.pathname==='/api/cart'&&req.method==='POST'){

      const user=getUser(req,db);

      if(!user){
        return json(res,401,{
          error:'Inicia sessão para usar o carrinho.'
        });
      }

      const b=await body(req);

      let cart=db.carts.find(
        x=>x.userId===user.id
      );

      if(!cart){

        cart={
          userId:user.id,
          items:[]
        };

        db.carts.push(cart);
      }

      const product=db.products.find(
        x=>x.id===b.productId
      );

      if(!product){
        return json(res,404,{
          error:'Produto não encontrado.'
        });
      }

      const existing=cart.items.find(
        x=>x.productId===b.productId
      );

      if(existing){
        existing.qty+=Number(b.qty||1);
      }else{
        cart.items.push({
          productId:b.productId,
          qty:Number(b.qty||1)
        });
      }

      write(db);

      return json(res,200,{
        items:cart.items
      });
    }

    if(u.pathname==='/api/cart'&&req.method==='DELETE'){

      const user=getUser(req,db);

      if(!user){
        return json(res,401,{
          error:'Não autenticado.'
        });
      }

      const b=await body(req);

      let cart=db.carts.find(
        x=>x.userId===user.id
      );

      if(cart){

        cart.items=cart.items.filter(
          x=>x.productId!==b.productId
        );

      }

      write(db);

      return json(res,200,{
        items:cart?cart.items:[]
      });
    }

    /* CRIAR PEDIDO */

    if(u.pathname==='/api/orders'&&req.method==='POST'){

      const user=getUser(req,db);

      if(!user){
        return json(res,401,{
          error:'Inicia sessão para comprar.'
        });
      }

      const b=await body(req);

      const order={
        id:'KL-'+Date.now().toString().slice(-7),
        userId:user.id,
        items:b.items||[],
        total:Number(b.total||0),
        status:'Pendente',
        createdAt:new Date().toISOString()
      };

      db.orders.unshift(order);

      if(!user.completedPurchases)
        user.completedPurchases=0;

      write(db);

      return json(res,201,order);
    }

    /* PEDIDOS */

    if(u.pathname==='/api/orders'&&req.method==='GET'){

      const user=getUser(req,db);

      if(!user){
        return json(res,401,{
          error:'Inicia sessão para ver pedidos.'
        });
      }

      return json(
        res,
        200,
        db.orders.filter(
          x=>x.userId===user.id
        )
      );
    }

    /* ARQUIVOS */

    const file=path.join(
      PUBLIC,
      u.pathname==='/'?'index.html':u.pathname
    );

    if(
      !file.startsWith(PUBLIC)||
      !fs.existsSync(file)
    ){
      return json(res,404,{
        error:'Not found'
      });
    }

    const ext=path.extname(file);

    const types={
      '.html':'text/html; charset=utf-8',
      '.js':'text/javascript; charset=utf-8',
      '.css':'text/css; charset=utf-8',
      '.json':'application/json'
    };

    res.writeHead(200,{
      'Content-Type':
      types[ext]||'application/octet-stream'
    });

    fs.createReadStream(file).pipe(res);

  }catch(e){

    console.error(e);

    json(res,500,{
      error:'Erro interno'
    });

  }

});

const PORT=Number(
  process.env.PORT||3000
);

server.listen(
  PORT,
  '0.0.0.0',
  ()=>console.log(
    `Kuanza Line API V1.0 running on port ${PORT}`
  )
);
