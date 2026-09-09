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
    JSON.stringify(
      {
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
      },
      null,
      2
    )
  );
}

function read() {
  return JSON.parse(fs.readFileSync(DB, 'utf8'));
}

function write(d) {
  fs.writeFileSync(DB, JSON.stringify(d, null, 2));
}

function ensureDB(db) {
  for (
    const k of [
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
    ]
  ) {
    if (!Array.isArray(db[k])) db[k] = [];
  }

  for (const p of db.products) {
    if (!Array.isArray(p.photos)) p.photos = [];
    if (!p.description) {
      p.description = 'Produto disponível na Kuanza Line.';
    }
  }

  return db;
}

function json(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
  });

  res.end(JSON.stringify(data));
}

function body(req, max = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let s = '';
    let size = 0;

    req.on('data', c => {
      size += c.length;

      if (size > max) {
        reject(new Error('Dados demasiado grandes.'));
        req.destroy();
        return;
      }

      s += c;
    });

    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
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
  const t = (req.headers.authorization || '')
    .replace('Bearer ', '')
    .trim();

  const s = db.sessions.find(x => x.token === t);

  if (!s) return null;

  return db.users.find(x => x.id === s.userId) || null;
}

function calculateScore(db, u) {
  if (!u) return 0;

  const completed = db.orders.filter(
    o =>
      o.status === 'Concluído' &&
      Array.isArray(o.items) &&
      o.items.some(
        i => i.sellerId === u.id || i.seller === u.name
      )
  ).length;

  const reviews = db.reviews.filter(
    r => r.sellerId === u.id
  );

  const avg = reviews.length
    ? reviews.reduce(
        (a, r) => a + Number(r.rating || 0),
        0
      ) / reviews.length
    : 0;

  const cancellations = db.orders.filter(
    o =>
      o.sellerId === u.id &&
      o.status === 'Cancelado'
  ).length;

  const complaints = Number(u.complaints || 0);
  const response = Number(u.responseTimeMinutes || 0);

  let score = 50;

  score += Math.min(25, completed * 3);

  score += reviews.length
    ? Math.round((avg / 5) * 20)
    : 0;

  score -= Math.min(
    15,
    cancellations * 4
  );

  score -= Math.min(
    20,
    complaints * 8
  );

  if (response > 0 && response <= 30) {
    score += 5;
  } else if (
    response > 30 &&
    response <= 120
  ) {
    score += 3;
  } else if (response > 720) {
    score -= 5;
  }

  if (u.verified) {
    score += 5;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(score)
    )
  );
}

function scoreLabel(score) {
  if (score >= 90) return 'Excelente';
  if (score >= 75) return 'Bom';
  if (score >= 50) return 'Regular';
  if (score >= 25) return 'Baixo';
  return 'Crítico';
}

function publicUser(u, db) {
  if (!u) return null;

  const completedOrders = db.orders.filter(
    o =>
      o.status === 'Concluído' &&
      (
        o.userId === u.id ||
        (
          Array.isArray(o.items) &&
          o.items.some(
            i =>
              i.sellerId === u.id ||
              i.seller === u.name
          )
        )
      )
  ).length;

  const receivedReviews = db.reviews.filter(
    r => r.sellerId === u.id
  ).length;

  const cancelledOrders = db.orders.filter(
    o =>
      o.userId === u.id &&
      o.status === 'Cancelado'
  ).length;

  const score = calculateScore(db, u);

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    score,
    scoreLabel: scoreLabel(score),
    avatar: u.avatar || '',
    verified: !!u.verified,
    completedOrders,
    receivedReviews,
    cancelledOrders
  };
}

function getStore(db, ownerId) {
  return (
    db.stores.find(
      x => x.ownerId === ownerId
    ) || null
  );
}

function publicProduct(db, p) {
  const seller = db.users.find(
    u => u.id === p.sellerId
  );

  const store = getStore(
    db,
    p.sellerId
  );

  return {
    ...p,
    seller: seller
      ? seller.name
      : p.seller || 'Vendedor',

    verified: seller
      ? !!seller.verified
      : !!p.verified,

    rating: Number(
      p.rating || 5
    ),

    score: seller
      ? calculateScore(db, seller)
      : Number(p.score || 100),

    storeName:
      store?.name ||
      p.seller ||
      'Loja',

    storeLogo:
      store?.logo || '',

    photos:
      Array.isArray(p.photos)
        ? p.photos
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
  return [a, b]
    .sort()
    .join(':');
}

const server = http.createServer(
  async (req, res) => {
    const u = url.parse(
      req.url,
      true
    );

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'Content-Type,Authorization',
        'Access-Control-Allow-Methods':
          'GET,POST,PATCH,DELETE,OPTIONS'
      });

      return res.end();
    }

    try {
      let db = ensureDB(read());

      if (u.pathname === '/api/health') {
        return json(res, 200, {
          ok: true,
          service: 'Kuanza Line API',
          version: '1.2'
        });
      }

      if (
        u.pathname === '/api/products' &&
        req.method === 'GET'
      ) {
        let list = db.products.map(
          p => publicProduct(db, p)
        );

        const q = String(
          u.query.search || ''
        ).toLowerCase();

        const cat = String(
          u.query.cat || 'Todos'
        );

        const sort = String(
          u.query.sort || ''
        );

        if (q) {
          list = list.filter(
            p =>
              (
                p.name +
                ' ' +
                p.seller +
                ' ' +
                p.description
              )
                .toLowerCase()
                .includes(q)
          );
        }

        if (
          cat &&
          cat !== 'Todos'
        ) {
          list = list.filter(
            p => p.cat === cat
          );
        }

        if (sort === 'low') {
          list.sort(
            (a, b) =>
              a.price - b.price
          );
        }

        if (sort === 'high') {
          list.sort(
            (a, b) =>
              b.price - a.price
          );
        }

        return json(
          res,
          200,
          list
        );
      }

      const pm =
        u.pathname.match(
          /^\/api\/products\/([^/]+)$/
        );

      if (
        pm &&
        req.method === 'GET'
      ) {
        const p =
          db.products.find(
            x => x.id === pm[1]
          );

        if (!p) {
          return json(
            res,
            404,
            {
              error:
                'Produto não encontrado.'
            }
          );
        }

        return json(
          res,
          200,
          publicProduct(db, p)
        );
      }

      if (
        u.pathname === '/api/register' &&
        req.method === 'POST'
      ) {
        const b = await body(req);

        if (
          !b.name ||
          !b.email ||
          !b.password
        ) {
          return json(
            res,
            400,
            {
              error:
                'Preenche nome, email e palavra-passe.'
            }
          );
        }

        if (
          db.users.some(
            x =>
              x.email.toLowerCase() ===
              String(
                b.email
              ).toLowerCase()
          )
        ) {
          return json(
            res,
            409,
            {
              error:
                'Este email já está registado.'
            }
          );
        }

        const user = {
          id: crypto.randomUUID(),
          name: String(
            b.name
          ).trim(),
          email: String(
            b.email
          )
            .toLowerCase()
            .trim(),

          passwordHash:
            crypto
              .createHash('sha256')
              .update(
                String(
                  b.password
                )
              )
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

        return json(
          res,
          201,
          {
            token: t,
            user: publicUser(
              user,
              db
            )
          }
        );
      }

      if (
        u.pathname === '/api/login' &&
        req.method === 'POST'
      ) {
        const b = await body(req);

        const h =
          crypto
            .createHash('sha256')
            .update(
              String(
                b.password || ''
              )
            )
            .digest('hex');

        const user =
          db.users.find(
            x =>
              x.email ===
                String(
                  b.email || ''
                ).toLowerCase() &&
              x.passwordHash === h
          );

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Email ou palavra-passe incorretos.'
            }
          );
        }

        const t = token();

        db.sessions.push({
          token: t,
          userId: user.id
        });

        write(db);

        return json(
          res,
          200,
          {
            token: t,
            user: publicUser(
              user,
              db
            )
          }
        );
      }

      if (
        u.pathname === '/api/me' &&
        req.method === 'GET'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Não autenticado.'
            }
          );
        }

        const pu =
          publicUser(
            user,
            db
          );

        return json(
          res,
          200,
          {
            ...pu,
            user: pu
          }
        );
      }

      if (
        u.pathname === '/api/me/score' &&
        req.method === 'GET'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Não autenticado.'
            }
          );
        }

        const completed =
          db.orders.filter(
            o =>
              o.status ===
                'Concluído' &&
              Array.isArray(
                o.items
              ) &&
              o.items.some(
                i =>
                  i.sellerId ===
                    user.id ||
                  i.seller ===
                    user.name
              )
          ).length;

        const reviews =
          db.reviews.filter(
            r =>
              r.sellerId ===
              user.id
          );

        const avg =
          reviews.length
            ? reviews.reduce(
                (a, r) =>
                  a +
                  Number(
                    r.rating || 0
                  ),
                0
              ) /
              reviews.length
            : 0;

        const cancellations =
          db.orders.filter(
            o =>
              o.sellerId ===
                user.id &&
              o.status ===
                'Cancelado'
          ).length;

        const complaints =
          Number(
            user.complaints || 0
          );

        const response =
          Number(
            user.responseTimeMinutes ||
              0
          );

        const factors = {
          base: 50,

          completedOrders:
            Math.min(
              25,
              completed * 3
            ),

          reviews:
            reviews.length
              ? Math.round(
                  (avg / 5) * 20
                )
              : 0,

          cancellations:
            -Math.min(
              15,
              cancellations * 4
            ),

          complaints:
            -Math.min(
              20,
              complaints * 8
            ),

          responseTime:
            response > 0 &&
            response <= 30
              ? 5
              : response > 30 &&
                response <= 120
              ? 3
              : response > 720
              ? -5
              : 0,

          verified:
            user.verified
              ? 5
              : 0
        };

        const score =
          calculateScore(
            db,
            user
          );

        return json(
          res,
          200,
          {
            score,
            scoreLabel:
              scoreLabel(
                score
              ),
            reviewCount:
              reviews.length,
            averageRating:
              Number(
                avg.toFixed(2)
              ),
            factors
          }
        );
      }

      if (
        u.pathname === '/api/me/role' &&
        req.method === 'PATCH'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Não autenticado.'
            }
          );
        }

        const b =
          await body(req);

        if (
          ![
            'buyer',
            'seller'
          ].includes(b.role)
        ) {
          return json(
            res,
            400,
            {
              error:
                'Tipo de conta inválido.'
            }
          );
        }

        user.role =
          b.role;

        write(db);

        const pu =
          publicUser(
            user,
            db
          );

        return json(
          res,
          200,
          {
            ...pu,
            user: pu,
            ok: true
          }
        );
      }

      if (
        u.pathname === '/api/stores' &&
        req.method === 'GET'
      ) {
        const ownerId =
          String(
            u.query.ownerId || ''
          );

        const st =
          db.stores.find(
            x =>
              x.ownerId ===
              ownerId
          );

        if (!st) {
          return json(
            res,
            200,
            null
          );
        }

        const products =
          db.products
            .filter(
              p =>
                p.sellerId ===
                ownerId
            )
            .map(
              p =>
                publicProduct(
                  db,
                  p
                )
            );

        const owner =
          db.users.find(
            x =>
              x.id ===
              ownerId
          );

        return json(
          res,
          200,
          {
            ...st,
            owner:
              publicUser(
                owner,
                db
              ),
            products
          }
        );
      }

      if (
        u.pathname === '/api/stores' &&
        req.method === 'PATCH'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão.'
            }
          );
        }

        const b =
          await body(req);

        let st =
          db.stores.find(
            x =>
              x.ownerId ===
              user.id
          );

        if (!st) {
          st = {
            id:
              crypto.randomUUID(),
            ownerId:
              user.id,
            name:
              user.name +
              ' Store',
            logo: '',
            description: '',
            rating: 5
          };

          db.stores.push(st);
        }

        if (
          b.name !==
          undefined
        ) {
          st.name =
            String(
              b.name
            ).trim();
        }

        if (
          b.logo !==
          undefined
        ) {
          st.logo =
            String(
              b.logo
            );
        }

        if (
          b.description !==
          undefined
        ) {
          st.description =
            String(
              b.description
            );
        }

        write(db);

        return json(
          res,
          200,
          st
        );
      }

      if (
        u.pathname === '/api/products' &&
        req.method === 'POST'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão para publicar.'
            }
          );
        }

        if (
          user.role !==
          'seller'
        ) {
          return json(
            res,
            403,
            {
              error:
                'Muda a tua conta para Vendedor antes de publicar.'
            }
          );
        }

        const b =
          await body(
            req,
            10 * 1024 * 1024
          );

        if (
          !b.name ||
          !Number(b.price) ||
          !b.cat
        ) {
          return json(
            res,
            400,
            {
              error:
                'Preenche nome, preço e categoria.'
            }
          );
        }

        if (
          !validPhotos(
            b.photos
          )
        ) {
          return json(
            res,
            400,
            {
              error:
                'O produto precisa de pelo menos 5 fotos reais. Podes adicionar até 10.'
            }
          );
        }

        if (
          !b.description ||
          String(
            b.description
          )
            .trim()
            .length < 15
        ) {
          return json(
            res,
            400,
            {
              error:
                'A descrição é obrigatória e deve ter pelo menos 15 caracteres.'
            }
          );
        }

        const p = {
          id:
            crypto.randomUUID(),

          name:
            String(
              b.name
            ).trim(),

          price:
            Number(
              b.price
            ),

          cat:
            String(
              b.cat
            ),

          emoji:
            b.emoji ||
            '📦',

          sellerId:
            user.id,

          seller:
            user.name,

          verified:
            !!user.verified,

          rating: 5,

          score:
            Number(
              user.score ||
                100
            ),

          description:
            String(
              b.description
            ).trim(),

          condition:
            b.condition ||
            'Usado',

          location:
            b.location ||
            '',

          photos:
            b.photos.slice(
              0,
              10
            ),

          createdAt:
            new Date().toISOString()
        };

        db.products.unshift(
          p
        );

        write(db);

        return json(
          res,
          201,
          publicProduct(
            db,
            p
          )
        );
      }

      const fav =
        u.pathname.match(
          /^\/api\/favorites\/([^/]+)$/
        );

      if (
        u.pathname ===
          '/api/favorites' &&
        req.method === 'GET'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão.'
            }
          );
        }

        return json(
          res,
          200,
          db.favorites
            .filter(
              x =>
                x.userId ===
                user.id
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
                publicProduct(
                  db,
                  p
                )
            )
        );
      }

      if (
        fav &&
        req.method === 'POST'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão.'
            }
          );
        }

        if (
          !db.products.some(
            p =>
              p.id ===
              fav[1]
          )
        ) {
          return json(
            res,
            404,
            {
              error:
                'Produto não encontrado.'
            }
          );
        }

        if (
          !db.favorites.some(
            x =>
              x.userId ===
                user.id &&
              x.productId ===
                fav[1]
          )
        ) {
          db.favorites.push({
            userId:
              user.id,
            productId:
              fav[1]
          });
        }

        write(db);

        return json(
          res,
          201,
          {
            ok: true
          }
        );
      }

      if (
        fav &&
        req.method === 'DELETE'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão.'
            }
          );
        }

        db.favorites =
          db.favorites.filter(
            x =>
              !(
                x.userId ===
                  user.id &&
                x.productId ===
                  fav[1]
              )
          );

        write(db);

        return json(
          res,
          200,
          {
            ok: true
          }
        );
      }

      const cartItem =
        u.pathname.match(
          /^\/api\/cart\/([^/]+)$/
        );

      if (
        u.pathname ===
          '/api/cart' &&
        req.method === 'GET'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão.'
            }
          );
        }

        const items =
          db.carts
            .filter(
              x =>
                x.userId ===
                user.id
            )
            .map(x => {
              const p =
                db.products.find(
                  p =>
                    p.id ===
                    x.productId
                );

              return p
                ? {
                    ...x,
                    product:
                      publicProduct(
                        db,
                        p
                      )
                  }
                : null;
            })
            .filter(Boolean);

        return json(
          res,
          200,
          items
        );
      }

      if (
        u.pathname ===
          '/api/cart' &&
        req.method === 'POST'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão.'
            }
          );
        }

        const b =
          await body(req);

        const p =
          db.products.find(
            x =>
              x.id ===
              b.productId
          );

        if (!p) {
          return json(
            res,
            404,
            {
              error:
                'Produto não encontrado.'
            }
          );
        }

        let x =
          db.carts.find(
            x =>
              x.userId ===
                user.id &&
              x.productId ===
                p.id
          );

        if (x) {
          x.qty = Math.min(
            99,
            x.qty +
              Math.max(
                1,
                Number(
                  b.qty || 1
                )
              )
          );
        } else {
          db.carts.push({
            userId:
              user.id,
            productId:
              p.id,
            qty:
              Math.max(
                1,
                Number(
                  b.qty || 1
                )
              )
          });
        }

        write(db);

        return json(
          res,
          201,
          {
            ok: true
          }
        );
      }

      if (
        cartItem &&
        req.method === 'DELETE'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão.'
            }
          );
        }

        db.carts =
          db.carts.filter(
            x =>
              !(
                x.userId ===
                  user.id &&
                x.productId ===
                  cartItem[1]
              )
          );

        write(db);

        return json(
          res,
          200,
          {
            ok: true
          }
        );
      }

      if (
        u.pathname ===
          '/api/orders' &&
        req.method === 'POST'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão para comprar.'
            }
          );
        }

        const b =
          await body(req);

        const order = {
          id:
            'KL-' +
            Date.now()
              .toString()
              .slice(-7),

          userId:
            user.id,

          items:
            b.items || [],

          total:
            Number(
              b.total || 0
            ),

          status:
            'Pendente',

          createdAt:
            new Date().toISOString()
        };

        db.orders.unshift(
          order
        );

        write(db);

        return json(
          res,
          201,
          order
        );
      }

      if (
        u.pathname ===
          '/api/orders' &&
        req.method === 'GET'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão para ver pedidos.'
            }
          );
        }

        return json(
          res,
          200,
          db.orders.filter(
            x =>
              x.userId ===
              user.id
          )
        );
      }

      // Kuanza Score V1.2:
      // avaliações reais de compradores
      // sobre vendedores/produtos.

      if (
        u.pathname ===
          '/api/reviews' &&
        req.method === 'GET'
      ) {
        const productId =
          String(
            u.query.productId ||
              ''
          );

        const sellerId =
          String(
            u.query.sellerId ||
              ''
          );

        let list =
          db.reviews.slice();

        if (productId) {
          list =
            list.filter(
              r =>
                r.productId ===
                productId
            );
        }

        if (sellerId) {
          list =
            list.filter(
              r =>
                r.sellerId ===
                sellerId
            );
        }

        list =
          list
            .map(r => ({
              ...r,

              buyerName:
                (
                  db.users.find(
                    x =>
                      x.id ===
                      r.buyerId
                  ) || {}
                ).name ||
                'Utilizador'
            }))
            .sort(
              (a, b) =>
                new Date(
                  b.createdAt
                ) -
                new Date(
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
        u.pathname ===
          '/api/reviews' &&
        req.method === 'POST'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão para avaliar.'
            }
          );
        }

        const b =
          await body(req);

        const productId =
          String(
            b.productId ||
              ''
          );

        const product =
          db.products.find(
            x =>
              x.id ===
              productId
          );

        if (!product) {
          return json(
            res,
            404,
            {
              error:
                'Produto não encontrado.'
            }
          );
        }

        if (
          product.sellerId ===
          user.id
        ) {
          return json(
            res,
            400,
            {
              error:
                'Não podes avaliar o teu próprio produto.'
            }
          );
        }

        const rating =
          Math.round(
            Number(
              b.rating || 0
            )
          );

        if (
          rating < 1 ||
          rating > 5
        ) {
          return json(
            res,
            400,
            {
              error:
                'A avaliação deve ser de 1 a 5 estrelas.'
            }
          );
        }

        if (
          db.reviews.some(
            r =>
              r.productId ===
                productId &&
              r.buyerId ===
                user.id
          )
        ) {
          return json(
            res,
            409,
            {
              error:
                'Já avalieste este produto.'
            }
          );
        }

        const comment =
          String(
            b.comment || ''
          )
            .trim()
            .slice(
              0,
              500
            );

        const review = {
          id:
            crypto.randomUUID(),

          productId,

          sellerId:
            product.sellerId,

          buyerId:
            user.id,

          rating,

          comment,

          createdAt:
            new Date().toISOString()
        };

        db.reviews.unshift(
          review
        );

        const seller =
          db.users.find(
            x =>
              x.id ===
              product.sellerId
          );

        if (seller) {
          seller.score =
            calculateScore(
              db,
              seller
            );
        }

        write(db);

        return json(
          res,
          201,
          {
            ...review,

            buyerName:
              user.name,

            sellerScore:
              seller
                ? calculateScore(
                    db,
                    seller
                  )
                : null
          }
        );
      }

      // Chat privado entre comprador e vendedor.

      if (
        u.pathname ===
          '/api/conversations' &&
        req.method === 'GET'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão.'
            }
          );
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
                    id !==
                    user.id
                );

              const other =
                db.users.find(
                  x =>
                    x.id ===
                    otherId
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
                  publicUser(
                    other,
                    db
                  ),

                lastMessage:
                  last ||
                  null,

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
                  b.lastMessage
                    ?.createdAt ||
                    b.createdAt
                ) -
                new Date(
                  a.lastMessage
                    ?.createdAt ||
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
        u.pathname ===
          '/api/conversations' &&
        req.method === 'POST'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão.'
            }
          );
        }

        const b =
          await body(req);

        const sellerId =
          String(
            b.sellerId || ''
          );

        if (
          !sellerId ||
          sellerId ===
            user.id
        ) {
          return json(
            res,
            400,
            {
              error:
                'Vendedor inválido.'
            }
          );
        }

        const seller =
          db.users.find(
            x =>
              x.id ===
              sellerId
          );

        if (!seller) {
          return json(
            res,
            404,
            {
              error:
                'Vendedor não encontrado.'
            }
          );
        }

        const key =
          conversationKey(
            user.id,
            sellerId
          );

        let c =
          db.conversations.find(
            x =>
              x.key ===
                key &&
              String(
                x.productId ||
                  ''
              ) ===
                String(
                  b.productId ||
                    ''
                )
          );

        if (!c) {
          c = {
            id:
              crypto.randomUUID(),

            key,

            participants: [
              user.id,
              sellerId
            ],

            productId:
              b.productId ||
              null,

            createdAt:
              new Date().toISOString()
          };

          db.conversations.push(
            c
          );

          write(db);
        }

        return json(
          res,
          201,
          c
        );
      }

      const conv =
        u.pathname.match(
          /^\/api\/conversations\/([^/]+)$/
        );

      if (
        conv &&
        req.method === 'GET'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão.'
            }
          );
        }

        const c =
          db.conversations.find(
            x =>
              x.id ===
                conv[1] &&
              x.participants.includes(
                user.id
              )
          );

        if (!c) {
          return json(
            res,
            404,
            {
              error:
                'Conversa não encontrada.'
            }
          );
        }

        const other =
          db.users.find(
            x =>
              x.id ===
              c.participants.find(
                id =>
                  id !==
                  user.id
              )
          );

        const product =
          c.productId
            ? db.products.find(
                p =>
                  p.id ===
                  c.productId
              )
            : null;

        const messages =
          db.messages
            .filter(
              m =>
                m.conversationId ===
                c.id
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

        return json(
          res,
          200,
          {
            conversation: {
              ...c,

              other:
                publicUser(
                  other,
                  db
                ),

              product:
                product
                  ? publicProduct(
                      db,
                      product
                    )
                  : null
            },

            messages
          }
        );
      }

      if (
        conv &&
        req.method === 'POST'
      ) {
        const user =
          auth(db, req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'Inicia sessão.'
            }
          );
        }

        const c =
          db.conversations.find(
            x =>
              x.id ===
                conv[1] &&
              x.participants.includes(
                user.id
              )
          );

        if (!c) {
          return json(
            res,
            404,
            {
              error:
                'Conversa não encontrada.'
            }
          );
        }

        const b =
          await body(req);

        const text =
          String(
            b.text || ''
          ).trim();

        const type =
          b.type ===
          'offer'
            ? 'offer'
            : 'text';

        if (
          !text &&
          type === 'text'
        ) {
          return json(
            res,
            400,
            {
              error:
                'Escreve uma mensagem.'
            }
          );
        }

        if (
          type ===
            'offer' &&
          (
            !Number(
              b.amount
            ) ||
            Number(
              b.amount
            ) <= 0
          )
        ) {
          return json(
            res,
            400,
            {
              error:
                'Valor da oferta inválido.'
            }
          );
        }

        const m = {
          id:
            crypto.randomUUID(),

          conversationId:
            c.id,

          senderId:
            user.id,

          type,

          text:
            text ||
            (
              'Oferta de ' +
              Number(
                b.amount
              ) +
              ' Kz'
            ),

          amount:
            type ===
            'offer'
              ? Number(
                  b.amount
                )
              : null,

          createdAt:
            new Date().toISOString()
        };

        db.messages.push(
          m
        );

        write(db);

        return json(
          res,
          201,
          m
        );
      }

      const file = path.join(
        PUBLIC,
        u.pathname === '/'
          ? 'index.html'
          : u.pathname.replace(
              /^\//,
              ''
            )
      );

      if (
        !file.startsWith(
          PUBLIC
        ) ||
        !fs.existsSync(
          file
        ) ||
        fs.statSync(
          file
        ).isDirectory()
      ) {
        return json(
          res,
          404,
          {
            error:
              'Not found'
          }
        );
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

      res.writeHead(
        200,
        {
          'Content-Type':
            types[ext] ||
            'application/octet-stream',

          'Cache-Control':
            'no-cache'
        }
      );

      fs.createReadStream(
        file
      ).pipe(res);

    } catch (e) {
      console.error(e);

      if (
        !res.headersSent
      ) {
        json(
          res,
          500,
          {
            error:
              e.message ||
              'Erro interno'
          }
        );
      }
    }
  }
);

const PORT = Number(
  process.env.PORT ||
    3000
);

server.listen(
  PORT,
  '0.0.0.0',
  () =>
    console.log(
      `Kuanza Line API running on port ${PORT}`
    )
);
