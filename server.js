const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const url = require('node:url');

const ROOT = __dirname;
const PUBLIC = ROOT;
const DB = path.join(ROOT, 'data', 'db.json');

fs.mkdirSync(path.dirname(DB), { recursive: true });

const demoProducts = [
  {
    id: 'p1',
    name: 'iPhone 13 128GB',
    price: 450000,
    cat: 'Eletrónicos',
    emoji: '📱',
    seller: 'Beni Store',
    sellerId: 'demo1',
    verified: true,
    rating: 4.9,
    description: 'iPhone 13 128GB em excelente estado.',
    photos: []
  },
  {
    id: 'p2',
    name: 'Smart TV 43"',
    price: 320000,
    cat: 'Eletrónicos',
    emoji: '📺',
    seller: 'Casa Digital',
    sellerId: 'demo2',
    verified: true,
    rating: 4.8,
    description: 'Smart TV 43 polegadas, imagem nítida e excelente para entretenimento.',
    photos: []
  },
  {
    id: 'p3',
    name: 'Conjunto Streetwear',
    price: 45000,
    cat: 'Moda',
    emoji: '👕',
    seller: 'Style AO',
    sellerId: 'demo3',
    verified: true,
    rating: 4.7,
    description: 'Conjunto streetwear moderno.',
    photos: []
  }
];

if (!fs.existsSync(DB)) {
  fs.writeFileSync(
    DB,
    JSON.stringify({
      users: [],
      stores: [],
      products: demoProducts,
      orders: [],
      sessions: [],
      favorites: [],
      carts: [],
      conversations: [],
      messages: [],
      reviews: []
    }, null, 2)
  );
}

function read() {
  return JSON.parse(fs.readFileSync(DB, 'utf8'));
}

function write(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2));
}

function ensureDB(db) {
  const collections = [
    'users',
    'stores',
    'products',
    'orders',
    'sessions',
    'favorites',
    'carts',
    'conversations',
    'messages',
    'reviews'
  ];

  for (const key of collections) {
    if (!Array.isArray(db[key])) {
      db[key] = [];
    }
  }

  for (const product of db.products) {
    if (!Array.isArray(product.photos)) {
      product.photos = [];
    }

    if (!product.description) {
      product.description = 'Produto disponível na Kuanza Line.';
    }
  }

  for (const user of db.users) {
    if (!Array.isArray(user.receivedReviews)) {
      user.receivedReviews = [];
    }

    if (!Array.isArray(user.completedOrders)) {
      user.completedOrders = [];
    }

    if (!Array.isArray(user.cancelledOrders)) {
      user.cancelledOrders = [];
    }

    if (!Array.isArray(user.complaints)) {
      user.complaints = [];
    }

    if (typeof user.responseTime !== 'number') {
      user.responseTime = 24;
    }

    if (typeof user.score !== 'number') {
      user.score = calculateScore(user);
    }
  }

  return db;
}

/* =========================
   KUANZA SCORE
========================= */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateScore(user) {
  if (!user) return 0;

  let score = 50;

  const completed = Array.isArray(user.completedOrders)
    ? user.completedOrders.length
    : 0;

  const cancelled = Array.isArray(user.cancelledOrders)
    ? user.cancelledOrders.length
    : 0;

  const complaints = Array.isArray(user.complaints)
    ? user.complaints.length
    : 0;

  const reviews = Array.isArray(user.receivedReviews)
    ? user.receivedReviews
    : [];

  /* Vendas/compras concluídas */
  score += Math.min(completed * 3, 25);

  /* Avaliações */
  if (reviews.length > 0) {
    const average =
      reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) /
      reviews.length;

    score += Math.round((average / 5) * 20);
  }

  /* Penalizações */
  score -= Math.min(cancelled * 4, 15);
  score -= Math.min(complaints * 8, 20);

  /* Tempo de resposta */
  const responseTime = Number(user.responseTime || 24);

  if (responseTime <= 1) {
    score += 5;
  } else if (responseTime <= 6) {
    score += 3;
  } else if (responseTime <= 24) {
    score += 1;
  } else {
    score -= 3;
  }

  if (user.verified) {
    score += 5;
  }

  return clamp(Math.round(score), 0, 100);
}

function scoreLabel(score) {
  if (score >= 90) {
    return {
      label: 'Excelente',
      text: 'Perfil altamente confiável',
      level: 'excellent'
    };
  }

  if (score >= 75) {
    return {
      label: 'Bom',
      text: 'Perfil confiável',
      level: 'good'
    };
  }

  if (score >= 50) {
    return {
      label: 'Regular',
      text: 'Tenha atenção nas negociações',
      level: 'regular'
    };
  }

  if (score >= 25) {
    return {
      label: 'Baixo',
      text: 'Perfil requer atenção',
      level: 'low'
    };
  }

  return {
    label: 'Crítico',
    text: 'Perfil com alto risco',
    level: 'critical'
  };
}

/* =========================
   HELPERS
========================= */

function json(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
  });

  res.end(JSON.stringify(data));
}

function body(req, max = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;

      if (size > max) {
        reject(new Error('Dados demasiado grandes.'));
        req.destroy();
        return;
      }

      data += chunk;
    });

    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });

    req.on('error', reject);
  });
}

function token() {
  return crypto.randomBytes(24).toString('hex');
}

function auth(db, req) {
  const authorization =
    (req.headers.authorization || '')
      .replace('Bearer ', '')
      .trim();

  if (!authorization) return null;

  const session = db.sessions.find(
    s => s.token === authorization
  );

  if (!session) return null;

  return db.users.find(
    u => u.id === session.userId
  ) || null;
}

function publicUser(user) {
  if (!user) return null;

  const score = calculateScore(user);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    score,
    scoreInfo: scoreLabel(score),
    avatar: user.avatar || '',
    verified: !!user.verified,
    completedOrders: user.completedOrders?.length || 0,
    cancelledOrders: user.cancelledOrders?.length || 0,
    complaints: user.complaints?.length || 0,
    reviews: user.receivedReviews?.length || 0
  };
}

function getStore(db, ownerId) {
  return db.stores.find(
    store => store.ownerId === ownerId
  ) || null;
}

function publicProduct(db, product) {
  const seller = db.users.find(
    user => user.id === product.sellerId
  );

  const store = getStore(db, product.sellerId);

  const score = seller
    ? calculateScore(seller)
    : Number(product.score || 100);

  return {
    ...product,
    seller: seller
      ? seller.name
      : (product.seller || 'Vendedor'),

    verified: seller
      ? !!seller.verified
      : !!product.verified,

    rating: Number(product.rating || 5),

    score,

    scoreInfo: scoreLabel(score),

    storeName:
      store?.name ||
      product.seller ||
      'Loja',

    storeLogo:
      store?.logo || '',

    photos:
      Array.isArray(product.photos)
        ? product.photos
        : []
  };
}

function validPhotos(photos) {
  return (
    Array.isArray(photos) &&
    photos.length >= 5 &&
    photos.length <= 10 &&
    photos.every(
      photo =>
        typeof photo === 'string' &&
        photo.startsWith('data:image/')
    )
  );
}

function conversationKey(a, b) {
  return [a, b].sort().join(':');
}

/* =========================
   SERVER
========================= */

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      return json(res, 204, {});
    }

    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    let db = ensureDB(read());
    const user = auth(db, req);

    /* =========================
       HEALTH
    ========================= */

    if (pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        app: 'Kuanza Line',
        version: '1.2'
      });
    }

    /* =========================
       REGISTER
    ========================= */

    if (
      pathname === '/api/register' &&
      req.method === 'POST'
    ) {
      const data = await body(req);

      const name = String(data.name || '').trim();
      const email = String(data.email || '')
        .trim()
        .toLowerCase();

      const password = String(data.password || '');

      if (!name || !email || password.length < 6) {
        return json(res, 400, {
          error: 'Preencha nome, email e uma senha com pelo menos 6 caracteres.'
        });
      }

      if (
        db.users.some(
          u => u.email.toLowerCase() === email
        )
      ) {
        return json(res, 409, {
          error: 'Este email já está registado.'
        });
      }

      const newUser = {
        id: crypto.randomUUID(),
        name,
        email,
        password,
        role: data.role === 'seller'
          ? 'seller'
          : 'buyer',

        verified: false,

        score: 50,

        completedOrders: [],
        cancelledOrders: [],
        complaints: [],
        receivedReviews: [],

        responseTime: 24,

        createdAt: new Date().toISOString()
      };

      db.users.push(newUser);

      const sessionToken = token();

      db.sessions.push({
        token: sessionToken,
        userId: newUser.id
      });

      write(db);

      return json(res, 201, {
        token: sessionToken,
        user: publicUser(newUser)
      });
    }

    /* =========================
       LOGIN
    ========================= */

    if (
      pathname === '/api/login' &&
      req.method === 'POST'
    ) {
      const data = await body(req);

      const email = String(data.email || '')
        .trim()
        .toLowerCase();

      const password = String(data.password || '');

      const found = db.users.find(
        u =>
          u.email.toLowerCase() === email &&
          u.password === password
      );

      if (!found) {
        return json(res, 401, {
          error: 'Email ou senha incorretos.'
        });
      }

      found.score = calculateScore(found);

      const sessionToken = token();

      db.sessions.push({
        token: sessionToken,
        userId: found.id
      });

      write(db);

      return json(res, 200, {
        token: sessionToken,
        user: publicUser(found)
      });
    }

    /* =========================
       ME
    ========================= */

    if (
      pathname === '/api/me' &&
      req.method === 'GET'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Não autenticado.'
        });
      }

      user.score = calculateScore(user);
      write(db);

      return json(res, 200, {
        user: publicUser(user)
      });
    }

    /* =========================
       SCORE
    ========================= */

    if (
      pathname === '/api/me/score' &&
      req.method === 'GET'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Não autenticado.'
        });
      }

      const score = calculateScore(user);
      user.score = score;

      write(db);

      return json(res, 200, {
        score,
        ...scoreLabel(score),

        factors: {
          completedOrders:
            user.completedOrders?.length || 0,

          reviews:
            user.receivedReviews?.length || 0,

          cancellations:
            user.cancelledOrders?.length || 0,

          complaints:
            user.complaints?.length || 0,

          responseTime:
            user.responseTime || 24,

          verified:
            !!user.verified
        }
      });
    }

    /* =========================
       SWITCH ROLE
    ========================= */

    if (
      pathname === '/api/me/role' &&
      req.method === 'PATCH'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Não autenticado.'
        });
      }

      const data = await body(req);

      if (
        data.role !== 'buyer' &&
        data.role !== 'seller'
      ) {
        return json(res, 400, {
          error: 'Tipo de conta inválido.'
        });
      }

      user.role = data.role;

      write(db);

      return json(res, 200, {
        user: publicUser(user)
      });
    }

    /* =========================
       PRODUCTS
    ========================= */

    if (
      pathname === '/api/products' &&
      req.method === 'GET'
    ) {
      const search =
        String(parsed.query.search || '')
          .toLowerCase();

      const cat =
        String(parsed.query.cat || '');

      const sort =
        String(parsed.query.sort || '');

      let products = db.products.map(
        p => publicProduct(db, p)
      );

      if (search) {
        products = products.filter(
          p =>
            p.name.toLowerCase().includes(search) ||
            p.description.toLowerCase().includes(search)
        );
      }

      if (cat) {
        products = products.filter(
          p => p.cat === cat
        );
      }

      if (sort === 'low') {
        products.sort(
          (a, b) => a.price - b.price
        );
      }

      if (sort === 'high') {
        products.sort(
          (a, b) => b.price - a.price
        );
      }

      return json(res, 200, products);
    }

    /* =========================
       PRODUCT DETAILS
    ========================= */

    if (
      pathname.startsWith('/api/products/') &&
      req.method === 'GET'
    ) {
      const id = pathname.split('/')[3];

      const product = db.products.find(
        p => p.id === id
      );

      if (!product) {
        return json(res, 404, {
          error: 'Produto não encontrado.'
        });
      }

      return json(
        res,
        200,
        publicProduct(db, product)
      );
    }

    /* =========================
       CREATE PRODUCT
    ========================= */

    if (
      pathname === '/api/products' &&
      req.method === 'POST'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Faça login primeiro.'
        });
      }

      if (user.role !== 'seller') {
        return json(res, 403, {
          error: 'Mude para conta vendedor.'
        });
      }

      const data = await body(req);

      const name = String(data.name || '').trim();
      const description =
        String(data.description || '').trim();

      const price = Number(data.price || 0);
      const category =
        String(data.cat || 'Outros').trim();

      const photos = data.photos;

      if (!name) {
        return json(res, 400, {
          error: 'Informe o nome do produto.'
        });
      }

      if (
        description.length < 15
      ) {
        return json(res, 400, {
          error: 'A descrição deve ter pelo menos 15 caracteres.'
        });
      }

      if (!Number.isFinite(price) || price <= 0) {
        return json(res, 400, {
          error: 'Informe um preço válido.'
        });
      }

      if (!validPhotos(photos)) {
        return json(res, 400, {
          error: 'O produto precisa de pelo menos 5 fotos reais.'
        });
      }

      const product = {
        id: crypto.randomUUID(),
        name,
        description,
        price,
        cat: category,
        emoji: data.emoji || '🛍️',

        sellerId: user.id,

        seller: user.name,

        verified: !!user.verified,

        rating: 5,

        score: calculateScore(user),

        photos,

        createdAt:
          new Date().toISOString()
      };

      db.products.push(product);

      write(db);

      return json(res, 201, {
        product: publicProduct(db, product)
      });
    }

    /* =========================
       STORES
    ========================= */

    if (
      pathname === '/api/store' &&
      req.method === 'GET'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Não autenticado.'
        });
      }

      const store =
        getStore(db, user.id);

      return json(res, 200, {
        store: store || null,
        seller: publicUser(user)
      });
    }

    if (
      pathname === '/api/store' &&
      req.method === 'PATCH'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Não autenticado.'
        });
      }

      const data = await body(req);

      let store =
        getStore(db, user.id);

      if (!store) {
        store = {
          id: crypto.randomUUID(),
          ownerId: user.id,
          name: '',
          logo: '',
          description: '',
          createdAt:
            new Date().toISOString()
        };

        db.stores.push(store);
      }

      if (data.name !== undefined) {
        store.name =
          String(data.name).trim();
      }

      if (data.logo !== undefined) {
        store.logo =
          String(data.logo);
      }

      if (data.description !== undefined) {
        store.description =
          String(data.description).trim();
      }

      write(db);

      return json(res, 200, {
        store
      });
    }

    /* =========================
       FAVORITES
    ========================= */

    if (
      pathname === '/api/favorites' &&
      req.method === 'GET'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Não autenticado.'
        });
      }

      const ids = db.favorites
        .filter(f => f.userId === user.id)
        .map(f => f.productId);

      return json(res, 200, {
        productIds: ids
      });
    }

    if (
      pathname === '/api/favorites' &&
      req.method === 'POST'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Não autenticado.'
        });
      }

      const data = await body(req);

      const productId =
        String(data.productId || '');

      const existing =
        db.favorites.find(
          f =>
            f.userId === user.id &&
            f.productId === productId
        );

      if (existing) {
        db.favorites =
          db.favorites.filter(
            f => f !== existing
          );

        write(db);

        return json(res, 200, {
          favorite: false
        });
      }

      db.favorites.push({
        id: crypto.randomUUID(),
        userId: user.id,
        productId
      });

      write(db);

      return json(res, 200, {
        favorite: true
      });
    }

    /* =========================
       CART
    ========================= */

    if (
      pathname === '/api/cart' &&
      req.method === 'GET'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Não autenticado.'
        });
      }

      const cart =
        db.carts.find(
          c => c.userId === user.id
        );

      return json(res, 200, {
        items: cart?.items || []
      });
    }

    if (
      pathname === '/api/cart' &&
      req.method === 'POST'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Não autenticado.'
        });
      }

      const data = await body(req);

      const productId =
        String(data.productId || '');

      const quantity =
        Math.max(1, Number(data.quantity || 1));

      let cart =
        db.carts.find(
          c => c.userId === user.id
        );

      if (!cart) {
        cart = {
          id: crypto.randomUUID(),
          userId: user.id,
          items: []
        };

        db.carts.push(cart);
      }

      const existing =
        cart.items.find(
          i => i.productId === productId
        );

      if (existing) {
        existing.quantity += quantity;
      } else {
        cart.items.push({
          productId,
          quantity
        });
      }

      write(db);

      return json(res, 200, {
        items: cart.items
      });
    }

    /* =========================
       ORDERS
    ========================= */

    if (
      pathname === '/api/orders' &&
      req.method === 'GET'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Não autenticado.'
        });
      }

      const orders =
        db.orders.filter(
          o => o.buyerId === user.id
        );

      return json(res, 200, orders);
    }

    if (
      pathname === '/api/orders' &&
      req.method === 'POST'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Faça login primeiro.'
        });
      }

      const data = await body(req);

      const items =
        Array.isArray(data.items)
          ? data.items
          : [];

      if (!items.length) {
        return json(res, 400, {
          error: 'Carrinho vazio.'
        });
      }

      const order = {
        id: crypto.randomUUID(),
        buyerId: user.id,
        items,
        status: 'Pendente',
        createdAt:
          new Date().toISOString()
      };

      db.orders.push(order);

      write(db);

      return json(res, 201, order);
    }

    /* =========================
       REVIEWS
    ========================= */

    if (
      pathname === '/api/reviews' &&
      req.method === 'POST'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Faça login primeiro.'
        });
      }

      const data = await body(req);

      const sellerId =
        String(data.sellerId || '');

      const rating =
        Number(data.rating || 0);

      const comment =
        String(data.comment || '').trim();

      if (
        rating < 1 ||
        rating > 5
      ) {
        return json(res, 400, {
          error: 'Avaliação inválida.'
        });
      }

      const seller =
        db.users.find(
          u => u.id === sellerId
        );

      if (!seller) {
        return json(res, 404, {
          error: 'Vendedor não encontrado.'
        });
      }

      const review = {
        id: crypto.randomUUID(),
        reviewerId: user.id,
        sellerId,
        rating,
        comment,
        createdAt:
          new Date().toISOString()
      };

      db.reviews.push(review);

      if (!Array.isArray(seller.receivedReviews)) {
        seller.receivedReviews = [];
      }

      seller.receivedReviews.push({
        rating,
        comment,
        reviewerId: user.id
      });

      seller.score =
        calculateScore(seller);

      write(db);

      return json(res, 201, {
        review,
        sellerScore: seller.score
      });
    }

    /* =========================
       CHAT
    ========================= */

    if (
      pathname === '/api/conversations' &&
      req.method === 'GET'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Faça login primeiro.'
        });
      }

      const conversations =
        db.conversations
          .filter(
            c =>
              c.userA === user.id ||
              c.userB === user.id
          )
          .map(c => ({
            ...c,
            messages: db.messages
              .filter(
                m =>
                  m.conversationId === c.id
              )
              .slice(-1)
          }));

      return json(
        res,
        200,
        conversations
      );
    }

    if (
      pathname === '/api/conversations' &&
      req.method === 'POST'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Faça login primeiro.'
        });
      }

      const data = await body(req);

      const otherUserId =
        String(data.userId || '');

      if (!otherUserId) {
        return json(res, 400, {
          error: 'Vendedor inválido.'
        });
      }

      const other =
        db.users.find(
          u => u.id === otherUserId
        );

      if (!other) {
        return json(res, 404, {
          error: 'Utilizador não encontrado.'
        });
      }

      const key =
        conversationKey(
          user.id,
          otherUserId
        );

      let conversation =
        db.conversations.find(
          c => c.key === key
        );

      if (!conversation) {
        conversation = {
          id: crypto.randomUUID(),
          key,
          userA: user.id,
          userB: otherUserId,
          productId:
            data.productId || null,
          createdAt:
            new Date().toISOString()
        };

        db.conversations.push(
          conversation
        );

        write(db);
      }

      return json(
        res,
        201,
        conversation
      );
    }

    if (
      pathname.startsWith('/api/conversations/') &&
      req.method === 'GET'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Faça login primeiro.'
        });
      }

      const id =
        pathname.split('/')[3];

      const conversation =
        db.conversations.find(
          c => c.id === id
        );

      if (!conversation) {
        return json(res, 404, {
          error: 'Conversa não encontrada.'
        });
      }

      if (
        conversation.userA !== user.id &&
        conversation.userB !== user.id
      ) {
        return json(res, 403, {
          error: 'Sem permissão.'
        });
      }

      const messages =
        db.messages.filter(
          m =>
            m.conversationId === id
        );

      return json(res, 200, {
        conversation,
        messages
      });
    }

    if (
      pathname.startsWith('/api/conversations/') &&
      req.method === 'POST'
    ) {
      if (!user) {
        return json(res, 401, {
          error: 'Faça login primeiro.'
        });
      }

      const id =
        pathname.split('/')[3];

      const conversation =
        db.conversations.find(
          c => c.id === id
        );

      if (!conversation) {
        return json(res, 404, {
          error: 'Conversa não encontrada.'
        });
      }

      if (
        conversation.userA !== user.id &&
        conversation.userB !== user.id
      ) {
        return json(res, 403, {
          error: 'Sem permissão.'
        });
      }

      const data = await body(req);

      const text =
        String(data.text || '').trim();

      if (!text) {
        return json(res, 400, {
          error: 'Mensagem vazia.'
        });
      }

      const message = {
        id: crypto.randomUUID(),
        conversationId: id,
        senderId: user.id,
        type: data.type === 'offer'
          ? 'offer'
          : 'text',
        text,
        amount:
          data.amount
            ? Number(data.amount)
            : null,
        createdAt:
          new Date().toISOString()
      };

      db.messages.push(message);

      write(db);

      return json(
        res,
        201,
        message
      );
    }

    /* =========================
       LOGOUT
    ========================= */

    if (
      pathname === '/api/logout' &&
      req.method === 'POST'
    ) {
      const authorization =
        (req.headers.authorization || '')
          .replace('Bearer ', '')
          .trim();

      db.sessions =
        db.sessions.filter(
          s => s.token !== authorization
        );

      write(db);

      return json(res, 200, {
        ok: true
      });
    }

    /* =========================
       STATIC FILES
    ========================= */

    let filePath =
      pathname === '/'
        ? path.join(PUBLIC, 'index.html')
        : path.join(PUBLIC, pathname);

    filePath =
      path.normalize(filePath);

    if (!filePath.startsWith(PUBLIC)) {
      return json(res, 403, {
        error: 'Forbidden'
      });
    }

    if (
      fs.existsSync(filePath) &&
      fs.statSync(filePath).isFile()
    ) {
      const ext =
        path.extname(filePath);

      const types = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml'
      };

      res.writeHead(200, {
        'Content-Type':
          types[ext] ||
          'application/octet-stream'
      });

      return res.end(
        fs.readFileSync(filePath)
      );
    }

    return json(res, 404, {
      error: 'Not found'
    });

  } catch (error) {
    console.error(error);

    return json(res, 500, {
      error:
        error.message ||
        'Erro interno do servidor.'
    });
  }
});

/* =========================
   START
========================= */

const PORT =
  Number(process.env.PORT || 3000);

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `Kuanza Line API running on port ${PORT}`
    );
  }
);
