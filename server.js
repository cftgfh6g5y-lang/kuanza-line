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
      messages: []
    }, null, 2)
  );
}

function read() {
  return JSON.parse(fs.readFileSync(DB, 'utf8'));
}

function ensureDB(db) {
  db.users ||= [];
  db.stores ||= [];
  db.products ||= [...demoProducts];
  db.orders ||= [];
  db.sessions ||= [];
  db.favorites ||= [];
  db.carts ||= [];
  db.conversations ||= [];
  db.messages ||= [];
  return db;
}

function write(db) {
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
}

function json(res, status, data) {
  const output = JSON.stringify(data);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Cache-Control': 'no-cache'
  });

  res.end(output);
}

function body(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';

    req.on('data', chunk => {
      data += chunk;

      if (Buffer.byteLength(data, 'utf8') > limit) {
        reject(new Error('Pedido demasiado grande.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
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
  const authorization = req.headers.authorization || '';
  const t = authorization.replace(/^Bearer\s+/i, '').trim();

  if (!t) return null;

  const session = db.sessions.find(x => x.token === t);

  if (!session) return null;

  return db.users.find(x => x.id === session.userId) || null;
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    score: Number(user.score || 100),
    avatar: user.avatar || '',
    verified: !!user.verified
  };
}

function getStore(db, ownerId) {
  return db.stores.find(x => x.ownerId === ownerId) || null;
}

function publicProduct(db, product) {
  const seller = db.users.find(u => u.id === product.sellerId);
  const store = getStore(db, product.sellerId);

  return {
    ...product,

    seller: seller
      ? seller.name
      : (product.seller || 'Vendedor'),

    verified: seller
      ? !!seller.verified
      : !!product.verified,

    rating: Number(product.rating || 5),

    score: seller
      ? Number(seller.score || 100)
      : Number(product.score || 100),

    storeName: store?.name || product.seller || 'Loja',

    storeLogo: store?.logo || '',

    photos: Array.isArray(product.photos)
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
      x =>
        typeof x === 'string' &&
        x.startsWith('data:image/')
    )
  );
}

function conversationKey(a, b) {
  return [a, b].sort().join(':');
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
    });

    return res.end();
  }

  try {
    let db = ensureDB(read());

    /* =========================
       HEALTH
    ========================= */

    if (
      parsed.pathname === '/api/health' &&
      req.method === 'GET'
    ) {
      return json(res, 200, {
        ok: true,
        service: 'Kuanza Line API',
        version: '1.1'
      });
    }

    /* =========================
       PRODUCTS
    ========================= */

    if (
      parsed.pathname === '/api/products' &&
      req.method === 'GET'
    ) {
      let list = db.products.map(
        p => publicProduct(db, p)
      );

      const search = String(
        parsed.query.search || ''
      ).toLowerCase();

      const cat = String(
        parsed.query.cat || 'Todos'
      );

      const sort = String(
        parsed.query.sort || ''
      );

      if (search) {
        list = list.filter(p =>
          (
            p.name +
            ' ' +
            p.seller +
            ' ' +
            p.description
          )
            .toLowerCase()
            .includes(search)
        );
      }

      if (cat && cat !== 'Todos') {
        list = list.filter(
          p => p.cat === cat
        );
      }

      if (sort === 'low') {
        list.sort(
          (a, b) => a.price - b.price
        );
      }

      if (sort === 'high') {
        list.sort(
          (a, b) => b.price - a.price
        );
      }

      return json(res, 200, list);
    }

    const productMatch =
      parsed.pathname.match(
        /^\/api\/products\/([^/]+)$/
      );

    if (
      productMatch &&
      req.method === 'GET'
    ) {
      const product = db.products.find(
        x => x.id === productMatch[1]
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

    if (
      parsed.pathname === '/api/products' &&
      req.method === 'POST'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error: 'Inicia sessão para publicar.'
        });
      }

      if (user.role !== 'seller') {
        return json(res, 403, {
          error:
            'Muda a tua conta para Vendedor antes de publicar.'
        });
      }

      const b = await body(
        req,
        10 * 1024 * 1024
      );

      if (
        !b.name ||
        !Number(b.price) ||
        !b.cat
      ) {
        return json(res, 400, {
          error:
            'Preenche nome, preço e categoria.'
        });
      }

      if (!validPhotos(b.photos)) {
        return json(res, 400, {
          error:
            'O produto precisa de pelo menos 5 fotos reais. Podes adicionar até 10.'
        });
      }

      if (
        !b.description ||
        String(b.description).trim().length < 15
      ) {
        return json(res, 400, {
          error:
            'A descrição é obrigatória e deve ter pelo menos 15 caracteres.'
        });
      }

      const product = {
        id: crypto.randomUUID(),
        name: String(b.name).trim(),
        price: Number(b.price),
        cat: String(b.cat),
        emoji: b.emoji || '📦',
        sellerId: user.id,
        seller: user.name,
        verified: !!user.verified,
        rating: 5,
        score: Number(user.score || 100),
        description:
          String(b.description).trim(),
        condition:
          b.condition || 'Usado',
        location:
          b.location || '',
        photos:
          b.photos.slice(0, 10),
        createdAt:
          new Date().toISOString()
      };

      db.products.unshift(product);

      write(db);

      return json(
        res,
        201,
        publicProduct(db, product)
      );
    }

    /* =========================
       AUTH
    ========================= */

    if (
      parsed.pathname === '/api/register' &&
      req.method === 'POST'
    ) {
      const b = await body(req);

      if (
        !b.name ||
        !b.email ||
        !b.password
      ) {
        return json(res, 400, {
          error:
            'Preenche nome, email e palavra-passe.'
        });
      }

      const email =
        String(b.email)
          .toLowerCase()
          .trim();

      if (
        db.users.some(
          x =>
            x.email.toLowerCase() ===
            email
        )
      ) {
        return json(res, 409, {
          error:
            'Este email já está registado.'
        });
      }

      const user = {
        id: crypto.randomUUID(),
        name: String(b.name).trim(),
        email,
        passwordHash:
          crypto
            .createHash('sha256')
            .update(String(b.password))
            .digest('hex'),
        role:
          b.role === 'seller'
            ? 'seller'
            : 'buyer',
        score: 100,
        verified: false,
        createdAt:
          new Date().toISOString()
      };

      db.users.push(user);

      const t = token();

      db.sessions.push({
        token: t,
        userId: user.id
      });

      write(db);

      return json(res, 201, {
        token: t,
        user: publicUser(user)
      });
    }

    if (
      parsed.pathname === '/api/login' &&
      req.method === 'POST'
    ) {
      const b = await body(req);

      const hash =
        crypto
          .createHash('sha256')
          .update(
            String(b.password || '')
          )
          .digest('hex');

      const user = db.users.find(
        x =>
          x.email ===
            String(b.email || '')
              .toLowerCase()
              .trim() &&
          x.passwordHash === hash
      );

      if (!user) {
        return json(res, 401, {
          error:
            'Email ou palavra-passe incorretos.'
        });
      }

      const t = token();

      db.sessions.push({
        token: t,
        userId: user.id
      });

      write(db);

      return json(res, 200, {
        token: t,
        user: publicUser(user)
      });
    }

    /* =========================
       CURRENT USER
    ========================= */

    if (
      parsed.pathname === '/api/me' &&
      req.method === 'GET'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error: 'Não autenticado.'
        });
      }

      const pu = publicUser(user);

      return json(res, 200, {
        ...pu,
        user: pu
      });
    }

    /* =========================
       ROLE SWITCH
    ========================= */

    if (
      parsed.pathname === '/api/me/role' &&
      req.method === 'PATCH'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error: 'Não autenticado.'
        });
      }

      const b = await body(req);

      if (
        !['buyer', 'seller']
          .includes(b.role)
      ) {
        return json(res, 400, {
          error:
            'Tipo de conta inválido.'
        });
      }

      user.role = b.role;

      write(db);

      const pu = publicUser(user);

      return json(res, 200, {
        ...pu,
        user: pu,
        ok: true
      });
    }

    /* =========================
       STORES
    ========================= */

    if (
      parsed.pathname === '/api/stores' &&
      req.method === 'GET'
    ) {
      const ownerId =
        String(
          parsed.query.ownerId || ''
        );

      if (ownerId) {
        const store =
          db.stores.find(
            x => x.ownerId === ownerId
          );

        if (!store) {
          return json(res, 200, null);
        }

        const products =
          db.products
            .filter(
              p =>
                p.sellerId === ownerId
            )
            .map(
              p =>
                publicProduct(db, p)
            );

        const owner =
          db.users.find(
            x => x.id === ownerId
          );

        return json(res, 200, {
          ...store,
          owner: publicUser(owner),
          products
        });
      }

      const stores =
        db.stores.map(store => {
          const owner =
            db.users.find(
              x =>
                x.id === store.ownerId
            );

          const products =
            db.products
              .filter(
                p =>
                  p.sellerId ===
                  store.ownerId
              )
              .map(
                p =>
                  publicProduct(db, p)
              );

          return {
            ...store,
            owner: publicUser(owner),
            products
          };
        });

      return json(
        res,
        200,
        stores
      );
    }

    if (
      parsed.pathname === '/api/stores' &&
      req.method === 'PATCH'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error: 'Inicia sessão.'
        });
      }

      const b = await body(req);

      let store =
        db.stores.find(
          x => x.ownerId === user.id
        );

      if (!store) {
        store = {
          id: crypto.randomUUID(),
          ownerId: user.id,
          name: user.name + ' Store',
          logo: '',
          description: '',
          rating: 5
        };

        db.stores.push(store);
      }

      if (b.name !== undefined) {
        store.name =
          String(b.name).trim();
      }

      if (b.logo !== undefined) {
        store.logo =
          String(b.logo);
      }

      if (b.description !== undefined) {
        store.description =
          String(b.description);
      }

      write(db);

      return json(
        res,
        200,
        store
      );
    }

    /* =========================
       FAVORITES
    ========================= */

    const favoriteMatch =
      parsed.pathname.match(
        /^\/api\/favorites\/([^/]+)$/
      );

    if (
      parsed.pathname === '/api/favorites' &&
      req.method === 'GET'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error: 'Inicia sessão.'
        });
      }

      const favorites =
        db.favorites
          .filter(
            x =>
              x.userId === user.id
          )
          .map(
            x =>
              db.products.find(
                p =>
                  p.id ===
                  x.productId
              )
          )
          .filter(Boolean)
          .map(
            p =>
              publicProduct(db, p)
          );

      return json(
        res,
        200,
        favorites
      );
    }

    if (
      favoriteMatch &&
      req.method === 'POST'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error: 'Inicia sessão.'
        });
      }

      const productId =
        favoriteMatch[1];

      if (
        !db.products.some(
          p => p.id === productId
        )
      ) {
        return json(res, 404, {
          error:
            'Produto não encontrado.'
        });
      }

      const exists =
        db.favorites.some(
          x =>
            x.userId === user.id &&
            x.productId === productId
        );

      if (!exists) {
        db.favorites.push({
          userId: user.id,
          productId
        });
      }

      write(db);

      return json(res, 201, {
        ok: true
      });
    }

    if (
      favoriteMatch &&
      req.method === 'DELETE'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error: 'Inicia sessão.'
        });
      }

      db.favorites =
        db.favorites.filter(
          x =>
            !(
              x.userId === user.id &&
              x.productId ===
                favoriteMatch[1]
            )
        );

      write(db);

      return json(res, 200, {
        ok: true
      });
    }

    /* =========================
       CART
    ========================= */

    const cartMatch =
      parsed.pathname.match(
        /^\/api\/cart\/([^/]+)$/
      );

    if (
      parsed.pathname === '/api/cart' &&
      req.method === 'GET'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error: 'Inicia sessão.'
        });
      }

      const items =
        db.carts
          .filter(
            x =>
              x.userId === user.id
          )
          .map(item => {
            const product =
              db.products.find(
                p =>
                  p.id ===
                  item.productId
              );

            if (!product) {
              return null;
            }

            return {
              ...item,
              product:
                publicProduct(
                  db,
                  product
                )
            };
          })
          .filter(Boolean);

      return json(
        res,
        200,
        items
      );
    }

    if (
      parsed.pathname === '/api/cart' &&
      req.method === 'POST'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error: 'Inicia sessão.'
        });
      }

      const b = await body(req);

      const product =
        db.products.find(
          x =>
            x.id ===
            String(b.productId || '')
        );

      if (!product) {
        return json(res, 404, {
          error:
            'Produto não encontrado.'
        });
      }

      let item =
        db.carts.find(
          x =>
            x.userId === user.id &&
            x.productId ===
              product.id
        );

      const qty = Math.max(
        1,
        Number(b.qty || 1)
      );

      if (item) {
        item.qty =
          Math.min(
            99,
            item.qty + qty
          );
      } else {
        db.carts.push({
          userId: user.id,
          productId: product.id,
          qty
        });
      }

      write(db);

      return json(res, 201, {
        ok: true
      });
    }

    if (
      cartMatch &&
      req.method === 'DELETE'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error: 'Inicia sessão.'
        });
      }

      db.carts =
        db.carts.filter(
          x =>
            !(
              x.userId === user.id &&
              x.productId ===
                cartMatch[1]
            )
        );

      write(db);

      return json(res, 200, {
        ok: true
      });
    }

    /* =========================
       ORDERS
    ========================= */

    if (
      parsed.pathname === '/api/orders' &&
      req.method === 'POST'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error:
            'Inicia sessão para comprar.'
        });
      }

      const b = await body(req);

      const order = {
        id:
          'KL-' +
          Date.now()
            .toString()
            .slice(-7),

        userId: user.id,

        items:
          Array.isArray(b.items)
            ? b.items
            : [],

        total:
          Number(b.total || 0),

        status:
          'Pendente',

        createdAt:
          new Date().toISOString()
      };

      db.orders.unshift(order);

      write(db);

      return json(
        res,
        201,
        order
      );
    }

    if (
      parsed.pathname === '/api/orders' &&
      req.method === 'GET'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error:
            'Inicia sessão para ver pedidos.'
        });
      }

      return json(
        res,
        200,
        db.orders.filter(
          x =>
            x.userId === user.id
        )
      );
    }

    /* =========================
       CONVERSATIONS
    ========================= */

    if (
      parsed.pathname === '/api/conversations' &&
      req.method === 'GET'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error: 'Inicia sessão.'
        });
      }

      const list =
        db.conversations
          .filter(
            c =>
              c.participants.includes(
                user.id
              )
          )
          .map(c => {
            const otherId =
              c.participants.find(
                id =>
                  id !== user.id
              );

            const other =
              db.users.find(
                x =>
                  x.id === otherId
              );

            const last =
              db.messages
                .filter(
                  m =>
                    m.conversationId ===
                    c.id
                )
                .sort(
                  (a, b) =>
                    new Date(
                      b.createdAt
                    ) -
                    new Date(
                      a.createdAt
                    )
                )[0];

            const product =
              c.productId
                ? db.products.find(
                    p =>
                      p.id ===
                      c.productId
                  )
                : null;

            return {
              ...c,

              other:
                publicUser(other),

              otherUser:
                publicUser(other),

              lastMessage:
                last || null,

              product:
                product
                  ? publicProduct(
                      db,
                      product
                    )
                  : null
            };
          })
          .sort(
            (a, b) =>
              new Date(
                b.lastMessage?.createdAt ||
                  b.createdAt
              ) -
              new Date(
                a.lastMessage?.createdAt ||
                  a.createdAt
              )
          );

      return json(
        res,
        200,
        list
      );
    }

    if (
      parsed.pathname === '/api/conversations' &&
      req.method === 'POST'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error: 'Inicia sessão.'
        });
      }

      const b = await body(req);

      const sellerId =
        String(
          b.sellerId || ''
        );

      if (
        !sellerId ||
        sellerId === user.id
      ) {
        return json(res, 400, {
          error:
            'Vendedor inválido.'
        });
      }

      const seller =
        db.users.find(
          x =>
            x.id === sellerId
        );

      if (!seller) {
        return json(res, 404, {
          error:
            'Vendedor não encontrado.'
        });
      }

      const key =
        conversationKey(
          user.id,
          sellerId
        );

      let conversation =
        db.conversations.find(
          x =>
            x.key === key &&
            String(
              x.productId || ''
            ) ===
              String(
                b.productId || ''
              )
        );

      if (!conversation) {
        conversation = {
          id:
            crypto.randomUUID(),

          key,

          participants: [
            user.id,
            sellerId
          ],

          productId:
            b.productId || null,

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

    const conversationMatch =
      parsed.pathname.match(
        /^\/api\/conversations\/([^/]+)$/
      );

    if (
      conversationMatch &&
      req.method === 'GET'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error: 'Inicia sessão.'
        });
      }

      const conversation =
        db.conversations.find(
          x =>
            x.id ===
              conversationMatch[1] &&
            x.participants.includes(
              user.id
            )
        );

      if (!conversation) {
        return json(res, 404, {
          error:
            'Conversa não encontrada.'
        });
      }

      const other =
        db.users.find(
          x =>
            x.id ===
            conversation.participants.find(
              id =>
                id !== user.id
            )
        );

      const product =
        conversation.productId
          ? db.products.find(
              p =>
                p.id ===
                conversation.productId
            )
          : null;

      const messages =
        db.messages
          .filter(
            m =>
              m.conversationId ===
              conversation.id
          )
          .sort(
            (a, b) =>
              new Date(
                a.createdAt
              ) -
              new Date(
                b.createdAt
              )
          );

      return json(res, 200, {
        conversation: {
          ...conversation,

          other:
            publicUser(other),

          otherUser:
            publicUser(other),

          product:
            product
              ? publicProduct(
                  db,
                  product
                )
              : null
        },

        messages
      });
    }

    if (
      conversationMatch &&
      req.method === 'POST'
    ) {
      const user = auth(db, req);

      if (!user) {
        return json(res, 401, {
          error: 'Inicia sessão.'
        });
      }

      const conversation =
        db.conversations.find(
          x =>
            x.id ===
              conversationMatch[1] &&
            x.participants.includes(
              user.id
            )
        );

      if (!conversation) {
        return json(res, 404, {
          error:
            'Conversa não encontrada.'
        });
      }

      const b = await body(req);

      const text =
        String(
          b.text || ''
        ).trim();

      const offerValue =
        Number(
          b.offer ||
          b.amount ||
          0
        );

      const type =
        b.type === 'offer' ||
        offerValue > 0
          ? 'offer'
          : 'text';

      if (
        !text &&
        type === 'text'
      ) {
        return json(res, 400, {
          error:
            'Escreve uma mensagem.'
        });
      }

      if (
        type === 'offer' &&
        (!offerValue ||
          offerValue <= 0)
      ) {
        return json(res, 400, {
          error:
            'Valor da oferta inválido.'
        });
      }

      const message = {
        id:
          crypto.randomUUID(),

        conversationId:
          conversation.id,

        senderId:
          user.id,

        type,

        text:
          text ||
          (
            'Oferta de ' +
            offerValue +
            ' Kz'
          ),

        amount:
          type === 'offer'
            ? offerValue
            : null,

        offer:
          type === 'offer'
            ? offerValue
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
       STATIC FILES
    ========================= */

    const requestedFile =
      parsed.pathname === '/'
        ? 'index.html'
        : parsed.pathname.replace(
            /^\//,
            ''
          );

    const file =
      path.join(
        PUBLIC,
        requestedFile
      );

    if (
      !file.startsWith(PUBLIC) ||
      !fs.existsSync(file) ||
      fs.statSync(file).isDirectory()
    ) {
      return json(res, 404, {
        error: 'Not found'
      });
    }

    const ext =
      path.extname(file);

    const types = {
      '.html':
        'text/html; charset=utf-8',

      '.js':
        'text/javascript; charset=utf-8',

      '.css':
        'text/css; charset=utf-8',

      '.json':
        'application/json'
    };

    res.writeHead(200, {
      'Content-Type':
        types[ext] ||
        'application/octet-stream',

      'Cache-Control':
        'no-cache'
    });

    fs.createReadStream(file)
      .pipe(res);

  } catch (error) {

    console.error(error);

    if (!res.headersSent) {
      json(res, 500, {
        error:
          error.message ||
          'Erro interno'
      });
    }
  }
});

const PORT =
  Number(
    process.env.PORT || 3000
  );

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `Kuanza Line API running on port ${PORT}`
    );
  }
);
