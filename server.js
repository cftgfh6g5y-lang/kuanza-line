const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const ROOT = __dirname;
const DB_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DB_DIR, "db.json");

fs.mkdirSync(DB_DIR, { recursive: true });

const DEFAULT_DB = {
  users: [],
  products: [
    {
      id: "p1",
      name: "iPhone 12",
      price: 350000,
      category: "Eletrónicos",
      description: "iPhone 12 em excelente estado.",
      photos: [],
      sellerId: "demo-seller-1",
      createdAt: new Date().toISOString()
    },
    {
      id: "p2",
      name: "Tênis Nike",
      price: 85000,
      category: "Moda",
      description: "Tênis Nike novo e original.",
      photos: [],
      sellerId: "demo-seller-1",
      createdAt: new Date().toISOString()
    },
    {
      id: "p3",
      name: "Computador portátil",
      price: 420000,
      category: "Eletrónicos",
      description: "Computador portátil para estudo e trabalho.",
      photos: [],
      sellerId: "demo-seller-1",
      createdAt: new Date().toISOString()
    }
  ],
  stores: [],
  favorites: [],
  cart: [],
  orders: [],
  conversations: [],
  messages: [],
  reviews: []
};

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
      return JSON.parse(JSON.stringify(DEFAULT_DB));
    }

    const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

    for (const key of Object.keys(DEFAULT_DB)) {
      if (!Array.isArray(data[key])) {
        data[key] = DEFAULT_DB[key];
      }
    }

    return data;
  } catch (error) {
    console.error("Erro ao carregar DB:", error);
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function id() {
  return crypto.randomUUID();
}

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(String(password))
    .digest("hex");
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

const sessions = new Map();

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
  });

  res.end(body);
}

function sendText(res, status, text, type = "text/plain") {
  res.writeHead(status, {
    "Content-Type": `${type}; charset=utf-8`,
    "Access-Control-Allow-Origin": "*"
  });

  res.end(text);
}

function notFound(res) {
  sendJSON(res, 404, {
    error: "Not Found"
  });
}

function unauthorized(res) {
  sendJSON(res, 401, {
    error: "Não autenticado."
  });
}

function getToken(req) {
  const header = req.headers.authorization || "";

  if (header.startsWith("Bearer ")) {
    return header.substring(7);
  }

  return null;
}

function getCurrentUser(req) {
  const token = getToken(req);

  if (!token) {
    return null;
  }

  const userId = sessions.get(token);

  if (!userId) {
    return null;
  }

  return db.users.find((u) => u.id === userId) || null;
}

function calculateScore(user) {
  if (!user) return 50;

  let score = 50;

  const completed = db.orders.filter(
    (o) =>
      (o.buyerId === user.id || o.sellerId === user.id) &&
      o.status === "completed"
  ).length;

  score += Math.min(completed * 3, 25);

  const reviews = db.reviews.filter((r) => r.toUserId === user.id);

  if (reviews.length) {
    const average =
      reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) /
      reviews.length;

    score += Math.round((average / 5) * 20);
  }

  const cancelled = db.orders.filter(
    (o) =>
      (o.buyerId === user.id || o.sellerId === user.id) &&
      o.status === "cancelled"
  ).length;

  score -= Math.min(cancelled * 4, 15);

  if (user.verified) {
    score += 5;
  }

  return Math.max(0, Math.min(100, score));
}

function scoreLabel(score) {
  if (score >= 90) return "Excelente";
  if (score >= 75) return "Bom";
  if (score >= 50) return "Regular";
  if (score >= 25) return "Baixo";
  return "Crítico";
}

function publicUser(user) {
  if (!user) return null;

  const score = calculateScore(user);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar || "",
    verified: !!user.verified,
    score,
    scoreLabel: scoreLabel(score)
  };
}

function publicProduct(product) {
  if (!product) return null;

  const seller = db.users.find((u) => u.id === product.sellerId);

  return {
    id: product.id,
    name: product.name,
    price: Number(product.price),
    category: product.category || "Outros",
    description: product.description || "",
    photos: Array.isArray(product.photos) ? product.photos : [],
    sellerId: product.sellerId,
    seller: seller
      ? {
          id: seller.id,
          name: seller.name,
          score: calculateScore(seller),
          scoreLabel: scoreLabel(calculateScore(seller)),
          verified: !!seller.verified
        }
      : null,
    createdAt: product.createdAt
  };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("JSON inválido."));
      }
    });

    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  let pathname = decodeURIComponent(req.url.split("?")[0]);

  if (pathname === "/") {
    pathname = "/index.html";
  }

  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    notFound(res);
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      notFound(res);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();

    const types = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon"
    };

    res.writeHead(200, {
      "Content-Type": `${types[ext] || "application/octet-stream"}; charset=utf-8"
    });

    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleAPI(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
    });

    res.end();
    return;
  }

  if (pathname === "/api/health" && method === "GET") {
    sendJSON(res, 200, {
      ok: true,
      service: "Kuanza Line API",
      version: "1.1-stable"
    });
    return;
  }

  if (pathname === "/api/products" && method === "GET") {
    sendJSON(res, 200, db.products.map(publicProduct));
    return;
  }

  const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/);

  if (productMatch && method === "GET") {
    const product = db.products.find((p) => p.id === productMatch[1]);

    if (!product) {
      notFound(res);
      return;
    }

    sendJSON(res, 200, publicProduct(product));
    return;
  }

  if (pathname === "/api/register" && method === "POST") {
    try {
      const body = await parseBody(req);

      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");

      if (!name || !email || !password) {
        sendJSON(res, 400, {
          error: "Preencha nome, email e senha."
        });
        return;
      }

      if (password.length < 6) {
        sendJSON(res, 400, {
          error: "A senha deve ter pelo menos 6 caracteres."
        });
        return;
      }

      if (db.users.some((u) => u.email === email)) {
        sendJSON(res, 409, {
          error: "Este email já está registado."
        });
        return;
      }

      const user = {
        id: id(),
        name,
        email,
        password: hashPassword(password),
        role: body.role === "seller" ? "seller" : "buyer",
        avatar: "",
        verified: false,
        createdAt: new Date().toISOString()
      };

      db.users.push(user);
      saveDB();

      const token = createToken();
      sessions.set(token, user.id);

      sendJSON(res, 201, {
        token,
        user: publicUser(user)
      });
    } catch (error) {
      sendJSON(res, 400, {
        error: error.message
      });
    }

    return;
  }

  if (pathname === "/api/login" && method === "POST") {
    try {
      const body = await parseBody(req);

      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");

      const user = db.users.find((u) => u.email === email);

      if (!user || user.password !== hashPassword(password)) {
        sendJSON(res, 401, {
          error: "Email ou senha incorretos."
        });
        return;
      }

      const token = createToken();
      sessions.set(token, user.id);

      sendJSON(res, 200, {
        token,
        user: publicUser(user)
      });
    } catch (error) {
      sendJSON(res, 400, {
        error: error.message
      });
    }

    return;
  }

  if (pathname === "/api/me" && method === "GET") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    const pu = publicUser(user);

    sendJSON(res, 200, {
      ...pu,
      user: pu
    });

    return;
  }

  if (pathname === "/api/me/role" && method === "PATCH") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    try {
      const body = await parseBody(req);
      const role = body.role;

      if (role !== "buyer" && role !== "seller") {
        sendJSON(res, 400, {
          error: "Tipo de conta inválido."
        });
        return;
      }

      user.role = role;
      saveDB();

      const pu = publicUser(user);

      sendJSON(res, 200, {
        ...pu,
        user: pu,
        ok: true
      });
    } catch (error) {
      sendJSON(res, 400, {
        error: error.message
      });
    }

    return;
  }

  if (pathname === "/api/me/score" && method === "GET") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    const score = calculateScore(user);

    sendJSON(res, 200, {
      score,
      label: scoreLabel(score),
      factors: {
        completedOrders: db.orders.filter(
          (o) =>
            (o.buyerId === user.id || o.sellerId === user.id) &&
            o.status === "completed"
        ).length,
        reviews: db.reviews.filter((r) => r.toUserId === user.id).length,
        verified: !!user.verified
      }
    });

    return;
  }

  if (pathname === "/api/stores" && method === "GET") {
    const stores = db.stores.map((store) => {
      const seller = db.users.find((u) => u.id === store.sellerId);

      return {
        ...store,
        seller: seller ? publicUser(seller) : null
      };
    });

    sendJSON(res, 200, stores);
    return;
  }

  if (pathname === "/api/stores" && method === "PATCH") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    if (user.role !== "seller") {
      sendJSON(res, 403, {
        error: "Apenas vendedores podem editar a loja."
      });
      return;
    }

    try {
      const body = await parseBody(req);

      let store = db.stores.find((s) => s.sellerId === user.id);

      if (!store) {
        store = {
          id: id(),
          sellerId: user.id,
          name: `${user.name} Store`,
          description: "",
          logo: "",
          createdAt: new Date().toISOString()
        };

        db.stores.push(store);
      }

      if (body.name !== undefined) {
        store.name = String(body.name).trim();
      }

      if (body.description !== undefined) {
        store.description = String(body.description).trim();
      }

      if (body.logo !== undefined) {
        store.logo = String(body.logo);
      }

      saveDB();

      sendJSON(res, 200, store);
    } catch (error) {
      sendJSON(res, 400, {
        error: error.message
      });
    }

    return;
  }

  if (pathname === "/api/products" && method === "POST") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    if (user.role !== "seller") {
      sendJSON(res, 403, {
        error: "Mude para conta de vendedor para publicar produtos."
      });
      return;
    }

    try {
      const body = await parseBody(req);

      const name = String(body.name || "").trim();
      const description = String(body.description || "").trim();
      const price = Number(body.price);
      const category = String(body.category || "Outros").trim();
      const photos = Array.isArray(body.photos) ? body.photos : [];

      if (!name) {
        sendJSON(res, 400, {
          error: "Informe o nome do produto."
        });
        return;
      }

      if (!Number.isFinite(price) || price <= 0) {
        sendJSON(res, 400, {
          error: "Informe um preço válido."
        });
        return;
      }

      if (description.length < 15) {
        sendJSON(res, 400, {
          error: "A descrição deve ter pelo menos 15 caracteres."
        });
        return;
      }

      if (photos.length < 5 || photos.length > 10) {
        sendJSON(res, 400, {
          error: "O produto deve ter entre 5 e 10 fotos."
        });
        return;
      }

      const product = {
        id: id(),
        name,
        price,
        category,
        description,
        photos,
        sellerId: user.id,
        createdAt: new Date().toISOString()
      };

      db.products.push(product);
      saveDB();

      sendJSON(res, 201, {
        ok: true,
        product: publicProduct(product)
      });
    } catch (error) {
      sendJSON(res, 400, {
        error: error.message
      });
    }

    return;
  }

  const favoriteMatch = pathname.match(/^\/api\/favorites\/([^/]+)$/);

  if (pathname === "/api/favorites" && method === "GET") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    const items = db.favorites
      .filter((f) => f.userId === user.id)
      .map((f) => db.products.find((p) => p.id === f.productId))
      .filter(Boolean)
      .map(publicProduct);

    sendJSON(res, 200, items);
    return;
  }

  if (pathname === "/api/favorites" && method === "POST") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    try {
      const body = await parseBody(req);
      const productId = String(body.productId || "");

      const product = db.products.find((p) => p.id === productId);

      if (!product) {
        sendJSON(res, 404, {
          error: "Produto não encontrado."
        });
        return;
      }

      const exists = db.favorites.some(
        (f) => f.userId === user.id && f.productId === productId
      );

      if (!exists) {
        db.favorites.push({
          id: id(),
          userId: user.id,
          productId
        });

        saveDB();
      }

      sendJSON(res, 201, {
        ok: true
      });
    } catch (error) {
      sendJSON(res, 400, {
        error: error.message
      });
    }

    return;
  }

  if (favoriteMatch && method === "DELETE") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    const productId = favoriteMatch[1];

    db.favorites = db.favorites.filter(
      (f) => !(f.userId === user.id && f.productId === productId)
    );

    saveDB();

    sendJSON(res, 200, {
      ok: true
    });

    return;
  }

  if (pathname === "/api/cart" && method === "GET") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    const items = db.cart
      .filter((c) => c.userId === user.id)
      .map((c) => {
        const product = db.products.find((p) => p.id === c.productId);

        if (!product) return null;

        return {
          id: c.id,
          userId: c.userId,
          productId: c.productId,
          qty: Number(c.qty || 1),
          product: publicProduct(product)
        };
      })
      .filter(Boolean);

    sendJSON(res, 200, items);
    return;
  }

  if (pathname === "/api/cart" && method === "POST") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    try {
      const body = await parseBody(req);

      const productId = String(body.productId || "");
      const qty = Math.max(1, Number(body.qty || 1));

      const product = db.products.find((p) => p.id === productId);

      if (!product) {
        sendJSON(res, 404, {
          error: "Produto não encontrado."
        });
        return;
      }

      const existing = db.cart.find(
        (c) => c.userId === user.id && c.productId === productId
      );

      if (existing) {
        existing.qty += qty;
      } else {
        db.cart.push({
          id: id(),
          userId: user.id,
          productId,
          qty
        });
      }

      saveDB();

      sendJSON(res, 201, {
        ok: true
      });
    } catch (error) {
      sendJSON(res, 400, {
        error: error.message
      });
    }

    return;
  }

  const cartMatch = pathname.match(/^\/api\/cart\/([^/]+)$/);

  if (cartMatch && method === "PATCH") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    try {
      const body = await parseBody(req);

      const item = db.cart.find(
        (c) => c.id === cartMatch[1] && c.userId === user.id
      );

      if (!item) {
        notFound(res);
        return;
      }

      item.qty = Math.max(1, Number(body.qty || 1));

      saveDB();

      sendJSON(res, 200, {
        ok: true
      });
    } catch (error) {
      sendJSON(res, 400, {
        error: error.message
      });
    }

    return;
  }

  if (cartMatch && method === "DELETE") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    db.cart = db.cart.filter(
      (c) => !(c.id === cartMatch[1] && c.userId === user.id)
    );

    saveDB();

    sendJSON(res, 200, {
      ok: true
    });

    return;
  }

  if (pathname === "/api/orders" && method === "GET") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    const orders = db.orders.filter(
      (o) => o.buyerId === user.id || o.sellerId === user.id
    );

    sendJSON(res, 200, orders);
    return;
  }

  if (pathname === "/api/orders" && method === "POST") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    try {
      const body = await parseBody(req);

      const items = Array.isArray(body.items) ? body.items : [];

      if (!items.length) {
        sendJSON(res, 400, {
          error: "O carrinho está vazio."
        });
        return;
      }

      const validItems = [];

      for (const item of items) {
        const product = db.products.find(
          (p) => p.id === String(item.productId)
        );

        if (!product) continue;

        validItems.push({
          productId: product.id,
          productName: product.name,
          price: Number(product.price),
          qty: Math.max(1, Number(item.qty || 1)),
          sellerId: product.sellerId
        });
      }

      if (!validItems.length) {
        sendJSON(res, 400, {
          error: "Nenhum produto válido encontrado."
        });
        return;
      }

      const grouped = {};

      for (const item of validItems) {
        grouped[item.sellerId] = grouped[item.sellerId] || [];
        grouped[item.sellerId].push(item);
      }

      const created = [];

      for (const sellerId of Object.keys(grouped)) {
        const sellerItems = grouped[sellerId];

        const total = sellerItems.reduce(
          (sum, item) => sum + item.price * item.qty,
          0
        );

        const order = {
          id: id(),
          buyerId: user.id,
          sellerId,
          items: sellerItems,
          total,
          status: "pending",
          createdAt: new Date().toISOString()
        };

        db.orders.push(order);
        created.push(order);
      }

      db.cart = db.cart.filter((c) => c.userId !== user.id);

      saveDB();

      sendJSON(res, 201, {
        ok: true,
        orders: created
      });
    } catch (error) {
      sendJSON(res, 400, {
        error: error.message
      });
    }

    return;
  }

  if (pathname === "/api/reviews" && method === "POST") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    try {
      const body = await parseBody(req);

      const toUserId = String(body.toUserId || "");
      const rating = Number(body.rating);
      const comment = String(body.comment || "").trim();

      if (!toUserId || !Number.isFinite(rating) || rating < 1 || rating > 5) {
        sendJSON(res, 400, {
          error: "Avaliação inválida."
        });
        return;
      }

      const target = db.users.find((u) => u.id === toUserId);

      if (!target) {
        sendJSON(res, 404, {
          error: "Utilizador não encontrado."
        });
        return;
      }

      const review = {
        id: id(),
        fromUserId: user.id,
        toUserId,
        rating,
        comment,
        createdAt: new Date().toISOString()
      };

      db.reviews.push(review);
      saveDB();

      sendJSON(res, 201, {
        ok: true,
        review
      });
    } catch (error) {
      sendJSON(res, 400, {
        error: error.message
      });
    }

    return;
  }

  if (pathname === "/api/conversations" && method === "GET") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    const conversations = db.conversations
      .filter(
        (c) => c.buyerId === user.id || c.sellerId === user.id
      )
      .map((c) => {
        const otherId =
          c.buyerId === user.id ? c.sellerId : c.buyerId;

        const otherUser = db.users.find((u) => u.id === otherId);

        const messages = db.messages
          .filter((m) => m.conversationId === c.id)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        return {
          ...c,
          otherUser: publicUser(otherUser),
          lastMessage: messages.length
            ? messages[messages.length - 1]
            : null
        };
      });

    sendJSON(res, 200, conversations);
    return;
  }

  if (pathname === "/api/conversations" && method === "POST") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    try {
      const body = await parseBody(req);

      const sellerId = String(body.sellerId || "");
      const productId = String(body.productId || "");

      const seller = db.users.find((u) => u.id === sellerId);

      if (!seller) {
        sendJSON(res, 404, {
          error: "Vendedor não encontrado."
        });
        return;
      }

      let conversation = db.conversations.find(
        (c) =>
          c.buyerId === user.id &&
          c.sellerId === sellerId &&
          (!productId || c.productId === productId)
      );

      if (!conversation) {
        conversation = {
          id: id(),
          buyerId: user.id,
          sellerId,
          productId: productId || null,
          createdAt: new Date().toISOString()
        };

        db.conversations.push(conversation);
        saveDB();
      }

      sendJSON(res, 201, conversation);
    } catch (error) {
      sendJSON(res, 400, {
        error: error.message
      });
    }

    return;
  }

  const conversationMatch = pathname.match(
    /^\/api\/conversations\/([^/]+)$/
  );

  if (conversationMatch && method === "GET") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    const conversation = db.conversations.find(
      (c) => c.id === conversationMatch[1]
    );

    if (!conversation) {
      notFound(res);
      return;
    }

    if (
      conversation.buyerId !== user.id &&
      conversation.sellerId !== user.id
    ) {
      sendJSON(res, 403, {
        error: "Acesso negado."
      });
      return;
    }

    const messages = db.messages
      .filter((m) => m.conversationId === conversation.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    sendJSON(res, 200, {
      conversation,
      messages
    });

    return;
  }

  if (conversationMatch && method === "POST") {
    const user = getCurrentUser(req);

    if (!user) {
      unauthorized(res);
      return;
    }

    try {
      const conversation = db.conversations.find(
        (c) => c.id === conversationMatch[1]
      );

      if (!conversation) {
        notFound(res);
        return;
      }

      if (
        conversation.buyerId !== user.id &&
        conversation.sellerId !== user.id
      ) {
        sendJSON(res, 403, {
          error: "Acesso negado."
        });
        return;
      }

      const body = await parseBody(req);

      const text = String(body.text || "").trim();
      const offer = body.offer !== undefined ? Number(body.offer) : null;

      if (!text && !Number.isFinite(offer)) {
        sendJSON(res, 400, {
          error: "Envie uma mensagem ou uma oferta."
        });
        return;
      }

      const message = {
        id: id(),
        conversationId: conversation.id,
        senderId: user.id,
        text,
        offer: Number.isFinite(offer) ? offer : null,
        createdAt: new Date().toISOString()
      };

      db.messages.push(message);
      saveDB();

      sendJSON(res, 201, message);
    } catch (error) {
      sendJSON(res, 400, {
        error: error.message
      });
    }

    return;
  }

  notFound(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    );

    if (url.pathname.startsWith("/api/")) {
      await handleAPI(req, res, url);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    console.error("Erro:", error);

    sendJSON(res, 500, {
      error: "Erro interno do servidor."
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Kuanza Line API running on port ${PORT}`);
});
