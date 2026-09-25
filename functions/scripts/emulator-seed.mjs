// Popula os emuladores com um cenário conhecido para testes.
//
//   npm run emulators:seed      (na raiz, com `npm run emulators` rodando)
//
// ZERA o Auth e o Firestore do emulador e recria tudo do zero, então dá para
// rodar quantas vezes quiser. Só funciona contra projeto `demo-*`: o Firebase
// não deixa um projeto demo falar com a nuvem, e este script se recusa a rodar
// em qualquer outro.
//
// Contas (login pelo app: `?testUser=admin|vendedor|comprador`):
//   test-admin      admin@vineon.test      claim admin
//   test-vendedor   vendedor@vineon.test   loja com anúncios
//   test-comprador  comprador@vineon.test  endereço cadastrado
//   test-atelie     atelie@vineon.test     segunda loja (aba Vendedores)
//
// Pedidos: ~30 nos últimos três meses, pagos, pendentes, cancelados e um
// devolvido, com as duas lojas — alimentam Métricas e a aba Vendedores.
// Senha de todas (só existe no emulador): vineon-teste

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.EMULATOR_PROJECT_ID || 'demo-vineon';
const HOST = '127.0.0.1';
const PORTS = { auth: 9099, firestore: 8080, functions: 5001 };
const PASSWORD = 'vineon-teste';

if (!PROJECT_ID.startsWith('demo-')) {
  console.error(`Recusado: "${PROJECT_ID}" não é projeto demo. O seed só roda no emulador.`);
  process.exit(1);
}

// Precisa estar definido ANTES do initializeApp: é o que faz o Admin SDK
// falar com o emulador em vez da nuvem.
process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:${PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:${PORTS.auth}`;
process.env.GCLOUD_PROJECT = PROJECT_ID;

await waitForEmulators();

initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

await resetEmulators();

// ------------------------------------------------------------------ usuários

const users = {
  admin: {
    uid: 'test-admin',
    email: 'admin@vineon.test',
    displayName: 'Admin de Teste',
    phoneNumber: '11990000001',
    cpf: cpf('123456789'),
    claims: { admin: true },
    doc: { isAdmin: true }
  },
  vendedor: {
    uid: 'test-vendedor',
    email: 'vendedor@vineon.test',
    displayName: 'Vendedora de Teste',
    phoneNumber: '11990000002',
    cpf: cpf('234567891'),
    doc: {
      username: 'loja-teste',
      shopName: 'Loja de Teste',
      shopDescription: 'Loja criada pelo seed do emulador.',
      shopPrimaryColor: '#2ECC71',
      shopSecondaryColor: '#182E3C'
    }
  },
  atelie: {
    uid: 'test-atelie',
    email: 'atelie@vineon.test',
    displayName: 'Marina Duarte',
    phoneNumber: '11990000004',
    cpf: cpf('456789123'),
    doc: {
      username: 'atelie-mare',
      shopName: 'Ateliê Maré',
      shopDescription: 'Peças feitas à mão.'
    }
  },
  comprador: {
    uid: 'test-comprador',
    email: 'comprador@vineon.test',
    displayName: 'Comprador de Teste',
    phoneNumber: '11990000003',
    cpf: cpf('345678912'),
    doc: {}
  }
};

for (const user of Object.values(users)) {
  await auth.createUser({
    uid: user.uid,
    email: user.email,
    emailVerified: true,
    password: PASSWORD,
    displayName: user.displayName
  });
  if (user.claims) await auth.setCustomUserClaims(user.uid, user.claims);

  await db.doc(`users/${user.uid}`).set({
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: null,
    phoneNumber: user.phoneNumber,
    cpf: user.cpf,
    isSeller: true,
    createdAt: FieldValue.serverTimestamp(),
    lastLoginAt: FieldValue.serverTimestamp(),
    ...user.doc
  });
}

await db.doc(`users/${users.comprador.uid}/addresses/casa`).set({
  id: 'casa',
  type: 'Casa',
  street: 'Avenida Paulista',
  number: '1000',
  complement: 'Apto 12',
  neighborhood: 'Bela Vista',
  city: 'São Paulo',
  state: 'SP',
  zipCode: '01310100',
  isDefault: true
});

// ---------------------------------------------------------------- categorias

const categories = [
  { id: 'eletronicos', name: 'Eletrônicos', icon: 'phone-portrait-outline', subcategories: [
    { id: 'celulares', name: 'Celulares' }, { id: 'fones', name: 'Fones de ouvido' }
  ] },
  { id: 'moda', name: 'Moda', icon: 'shirt-outline', subcategories: [
    { id: 'camisetas', name: 'Camisetas' }, { id: 'tenis', name: 'Tênis' }
  ] },
  { id: 'casa', name: 'Casa', icon: 'home-outline', subcategories: [
    { id: 'cozinha', name: 'Cozinha' }, { id: 'decoracao', name: 'Decoração' }
  ] },
  { id: 'esportes', name: 'Esportes', icon: 'bicycle-outline', subcategories: [
    { id: 'ciclismo', name: 'Ciclismo' }
  ] }
];

for (const { id, ...data } of categories) {
  await db.doc(`categories/${id}`).set(data);
}

// ------------------------------------------------------------------ produtos

const products = [
  ['smartphone', 'Smartphone 128 GB', 1899.9, 1699.9, 'novo', 5, 'eletronicos', 'celulares', 'Frete Grátis'],
  ['fone', 'Fone Bluetooth com cancelamento de ruído', 399.9, null, 'novo', 12, 'eletronicos', 'fones', 'A combinar'],
  ['celular-usado', 'Celular seminovo 64 GB', 749.0, null, 'usado-bom', 1, 'eletronicos', 'celulares', 'A combinar'],
  ['camiseta', 'Camiseta de algodão', 59.9, 49.9, 'novo', 30, 'moda', 'camisetas', 'Frete Grátis'],
  ['tenis', 'Tênis de corrida', 349.0, null, 'usado-como-novo', 2, 'moda', 'tenis', 'Entrega Expressa'],
  ['panela', 'Jogo de panelas antiaderente', 289.9, 259.9, 'novo', 8, 'casa', 'cozinha', 'A combinar'],
  ['luminaria', 'Luminária de mesa', 119.9, null, 'novo', 0, 'casa', 'decoracao', 'A combinar'],
  ['bicicleta', 'Bicicleta aro 29', 1450.0, null, 'usado-bom', 1, 'esportes', 'ciclismo', 'A combinar'],
  ['bolsa-palha', 'Bolsa de palha trançada', 189.0, 169.0, 'novo', 6, 'moda', 'camisetas', 'A combinar', 'atelie'],
  ['vaso-ceramica', 'Vaso de cerâmica artesanal', 129.0, null, 'novo', 4, 'casa', 'decoracao', 'A combinar', 'atelie'],
  ['colar-conchas', 'Colar de conchas', 79.9, null, 'novo', 15, 'moda', 'camisetas', 'Frete Grátis', 'atelie']
];

// Datas espaçadas: a vitrine ordena por `createdAt`.
const now = Date.now();
const productDocs = {};
for (const [index, [id, name, price, priceDiscounted, condition, stock, categoryId, subcategoryId, shipping, owner = 'vendedor']] of products.entries()) {
  productDocs[id] = { id, name, price, ...(priceDiscounted ? { priceDiscounted } : {}), photoURL: [`https://picsum.photos/seed/vineon-${id}/600/600`], sellerId: users[owner].uid };
  await db.doc(`products/${id}`).set({
    name,
    price,
    ...(priceDiscounted ? { priceDiscounted } : {}),
    description: `${name}. Anúncio de exemplo criado pelo seed do emulador.`,
    photoURL: [`https://picsum.photos/seed/vineon-${id}/600/600`],
    condition,
    stock,
    soldCount: 0,
    categoryIds: [categoryId],
    subcategoryIds: [subcategoryId],
    acceptOffers: true,
    paymentMethods: ['PIX', 'CARTÃO'],
    shipping,
    weight: 0.5,
    width: 20,
    height: 10,
    length: 20,
    location: 'São Paulo - SP',
    sellerId: users[owner].uid,
    createdAt: Timestamp.fromMillis(now - index * 60_000),
    updatedAt: Timestamp.fromMillis(now - index * 60_000)
  });
}

// ------------------------------------------------------------------- pedidos

// Roteiro fixo (dia atrás, itens, status) para o resultado ser sempre o mesmo.
const orderPlan = [
  [1, [['fone', 1]], 'CONFIRMED'], [2, [['camiseta', 3], ['colar-conchas', 1]], 'RECEIVED'],
  [3, [['bolsa-palha', 1]], 'PENDING'], [4, [['smartphone', 1]], 'IN_ESCROW'],
  [5, [['vaso-ceramica', 2]], 'CONFIRMED'], [6, [['panela', 1]], 'DELIVERED'],
  [8, [['tenis', 1]], 'CANCELLED'], [9, [['colar-conchas', 2]], 'RECEIVED'],
  [11, [['fone', 2]], 'DELIVERED'], [12, [['bolsa-palha', 1], ['vaso-ceramica', 1]], 'DELIVERED'],
  [14, [['camiseta', 2]], 'DELIVERED'], [17, [['celular-usado', 1]], 'REFUNDED'],
  [19, [['smartphone', 1], ['fone', 1]], 'DELIVERED'], [22, [['colar-conchas', 1]], 'DELIVERED'],
  [26, [['panela', 2]], 'DELIVERED'], [29, [['bolsa-palha', 2]], 'DELIVERED'],
  [33, [['camiseta', 1]], 'DELIVERED'], [36, [['vaso-ceramica', 1]], 'DELIVERED'],
  [38, [['fone', 1]], 'PENDING'], [41, [['bicicleta', 1]], 'DELIVERED'],
  [45, [['colar-conchas', 3]], 'DELIVERED'], [48, [['smartphone', 1]], 'DELIVERED'],
  [52, [['tenis', 1]], 'DELIVERED'], [55, [['bolsa-palha', 1]], 'DELIVERED'],
  [58, [['camiseta', 4]], 'DELIVERED'], [61, [['panela', 1], ['colar-conchas', 1]], 'DELIVERED'],
  [66, [['fone', 1]], 'CANCELLED'], [70, [['vaso-ceramica', 1]], 'DELIVERED'],
  [74, [['smartphone', 1]], 'DELIVERED'], [80, [['colar-conchas', 2]], 'DELIVERED']
];
const PAID = ['RECEIVED', 'CONFIRMED', 'DELIVERED', 'IN_ESCROW'];
const soldCount = {};

for (const [index, [daysAgo, lines, status]] of orderPlan.entries()) {
  const created = now - daysAgo * 86_400_000 - (index % 5) * 3_600_000;
  const items = lines.map(([productId, quantity]) => ({
    productId,
    quantity,
    addedAt: Timestamp.fromMillis(created),
    productData: productDocs[productId]
  }));
  const subtotal = items.reduce((sum, item) => sum + (item.productData.priceDiscounted ?? item.productData.price) * item.quantity, 0);
  const paid = PAID.includes(status) || status === 'REFUNDED';
  if (PAID.includes(status)) lines.forEach(([productId, quantity]) => { soldCount[productId] = (soldCount[productId] || 0) + quantity; });

  await db.doc(`orders/seed-${String(index + 1).padStart(2, '0')}`).set({
    userId: users.comprador.uid,
    items,
    total: Math.round((subtotal + 24.9) * 100) / 100,
    status,
    paymentMethod: index % 3 === 0 ? 'CREDIT_CARD' : 'PIX',
    sellerIds: [...new Set(items.map(item => item.productData.sellerId))],
    createdAt: Timestamp.fromMillis(created),
    ...(paid ? { paymentConfirmedAt: Timestamp.fromMillis(created + 20 * 60_000) } : {}),
    ...(status === 'DELIVERED' ? { shipmentStatus: 'DELIVERED', deliveredAt: Timestamp.fromMillis(created + 4 * 86_400_000) } : {}),
    customerData: { name: users.comprador.displayName, cpf: users.comprador.cpf, phone: users.comprador.phoneNumber, email: users.comprador.email },
    addressData: { street: 'Avenida Paulista', number: '1000', city: 'São Paulo', state: 'SP', postalCode: '01310100', neighborhood: 'Bela Vista' },
    shippingInfo: { serviceId: 1, serviceName: 'PAC', price: 24.9, deliveryTime: 6 }
  });
}

for (const [productId, count] of Object.entries(soldCount)) {
  await db.doc(`products/${productId}`).update({ soldCount: count });
}

console.log(`Seed concluído em ${PROJECT_ID}:`);
console.log(`  ${Object.keys(users).length} contas (admin, vendedor, atelie, comprador), senha "${PASSWORD}"`);
console.log(`  ${categories.length} categorias, ${products.length} produtos, ${orderPlan.length} pedidos`);
console.log('  Entre pelo app com ?testUser=admin | vendedor | atelie | comprador');

process.exit(0);

// ------------------------------------------------------------------- apoio

async function waitForEmulators() {
  const deadline = Date.now() + 90_000;
  for (const [name, port] of Object.entries(PORTS)) {
    while (true) {
      try {
        await fetch(`http://${HOST}:${port}/`);
        break;
      } catch {
        if (Date.now() > deadline) {
          console.error(`Emulador de ${name} não respondeu em ${HOST}:${port}. Rode "npm run emulators" antes.`);
          process.exit(1);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
}

async function resetEmulators() {
  const calls = [
    `http://${HOST}:${PORTS.firestore}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    `http://${HOST}:${PORTS.auth}/emulator/v1/projects/${PROJECT_ID}/accounts`
  ];
  for (const url of calls) {
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Falha ao zerar ${url}: ${response.status}`);
  }
}

/** CPF com dígitos verificadores válidos a partir de 9 dígitos (fictício). */
function cpf(base) {
  const digits = base.split('').map(Number);
  for (const length of [9, 10]) {
    const sum = digits.slice(0, length).reduce((acc, d, i) => acc + d * (length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    digits.push(rest === 10 ? 0 : rest);
  }
  return digits.join('');
}
