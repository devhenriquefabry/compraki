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

// ------------------------------------------------------------------ catálogo

// Fichas prontas da aba Catálogo. Um rascunho (fica fora da busca do vendedor)
// e um anúncio do Ateliê ligado ao iPhone 15, para a "concorrência" aparecer
// quando a Loja de Teste anuncia o mesmo produto.
const catalog = [
  {
    id: 'cat-iphone-15', title: 'Apple iPhone 15', brand: 'Apple', model: 'iPhone 15', line: 'iPhone',
    categoryId: 'eletronicos', subcategoryId: 'celulares', aliases: ['iphone15'], referencePrice: 4299,
    gtins: [gtin('019425389001')],
    variantAttributes: [
      { name: 'Cor', values: ['Preto', 'Azul', 'Verde', 'Amarelo', 'Rosa'] },
      { name: 'Armazenamento', values: ['128 GB', '256 GB', '512 GB'] }
    ],
    specs: [
      ['Memória RAM', '6 GB'], ['Tamanho da tela', '6,1"'], ['Câmera principal', '48 MP'], ['Câmera frontal', '12 MP'],
      ['Processador', 'A16 Bionic'], ['Sistema operacional', 'iOS 17'], ['Dual SIM', 'Sim (chip + eSIM)'],
      ['Rede 5G', 'Sim'], ['Homologação Anatel', '127572301993']
    ],
    pkg: [0.35, 10, 6, 18],
    description: 'iPhone 15 com Dynamic Island, câmera principal de 48 MP e conector USB-C. Tela Super Retina XDR de 6,1 polegadas, chip A16 Bionic e bateria para o dia todo. Acompanha cabo USB-C.'
  },
  {
    id: 'cat-iphone-15-pro', title: 'Apple iPhone 15 Pro', brand: 'Apple', model: 'iPhone 15 Pro', line: 'iPhone',
    categoryId: 'eletronicos', subcategoryId: 'celulares', aliases: [], referencePrice: 6999,
    gtins: [gtin('019425389101')],
    variantAttributes: [
      { name: 'Cor', values: ['Titânio preto', 'Titânio natural', 'Titânio azul', 'Titânio branco'] },
      { name: 'Armazenamento', values: ['128 GB', '256 GB', '512 GB', '1 TB'] }
    ],
    specs: [
      ['Memória RAM', '8 GB'], ['Tamanho da tela', '6,1"'], ['Câmera principal', '48 MP'], ['Processador', 'A17 Pro'],
      ['Sistema operacional', 'iOS 17'], ['Rede 5G', 'Sim']
    ],
    pkg: [0.4, 10, 6, 18],
    description: 'iPhone 15 Pro com estrutura de titânio, chip A17 Pro, botão de Ação e sistema de câmeras Pro.'
  },
  {
    id: 'cat-galaxy-a56', title: 'Samsung Galaxy A56 5G', brand: 'Samsung', model: 'Galaxy A56', line: 'Galaxy A',
    categoryId: 'eletronicos', subcategoryId: 'celulares', aliases: ['a56'], referencePrice: 2199,
    gtins: [gtin('789637170001')],
    variantAttributes: [
      { name: 'Cor', values: ['Grafite', 'Rosa', 'Verde-oliva'] },
      { name: 'Armazenamento', values: ['128 GB', '256 GB'] }
    ],
    specs: [
      ['Memória RAM', '8 GB'], ['Tamanho da tela', '6,7"'], ['Câmera principal', '50 MP'], ['Bateria', '5000 mAh'],
      ['Sistema operacional', 'Android 15'], ['Dual SIM', 'Sim'], ['Rede 5G', 'Sim']
    ],
    pkg: [0.42, 9, 6, 17],
    description: 'Galaxy A56 5G com tela Super AMOLED de 6,7", câmera tripla de 50 MP, bateria de 5000 mAh e seis anos de atualizações de sistema.'
  },
  {
    id: 'cat-jbl-tune-520', title: 'Fone de Ouvido JBL Tune 520BT', brand: 'JBL', model: 'Tune 520BT', line: 'Tune',
    categoryId: 'eletronicos', subcategoryId: 'fones', aliases: ['fone jbl'], referencePrice: 279.9,
    gtins: [gtin('619659196001')],
    variantAttributes: [{ name: 'Cor', values: ['Preto', 'Azul', 'Branco', 'Roxo'] }],
    specs: [
      ['Tipo', 'Headphone on-ear'], ['Conexão', 'Bluetooth 5.3'], ['Autonomia da bateria', 'Até 57 h'],
      ['Microfone', 'Sim'], ['Cancelamento de ruído', 'Não']
    ],
    pkg: [0.25, 8, 18, 20],
    description: 'Headphone sem fio JBL Pure Bass, até 57 horas de bateria, recarga rápida e conexão com dois aparelhos ao mesmo tempo.'
  },
  {
    id: 'cat-airpods-pro-2', title: 'Apple AirPods Pro (2ª geração) com estojo USB-C', brand: 'Apple', model: 'AirPods Pro 2', line: 'AirPods',
    categoryId: 'eletronicos', subcategoryId: 'fones', aliases: ['airpods'], referencePrice: 1899,
    gtins: [gtin('019425387001')],
    variantAttributes: [],
    specs: [
      ['Tipo', 'In-ear sem fio'], ['Cancelamento de ruído', 'Ativo'], ['Autonomia da bateria', 'Até 6 h (30 h com estojo)'],
      ['Resistência à água', 'IP54'], ['Conexão', 'Bluetooth 5.3']
    ],
    pkg: [0.2, 10, 5, 10],
    description: 'AirPods Pro com cancelamento ativo de ruído até 2x mais eficaz, modo ambiente adaptativo e estojo de recarga USB-C.'
  },
  {
    id: 'cat-nike-revolution-7', title: 'Tênis Nike Revolution 7 Masculino', brand: 'Nike', model: 'Revolution 7', line: 'Revolution',
    categoryId: 'moda', subcategoryId: 'tenis', aliases: [], referencePrice: 349.9,
    gtins: [],
    variantAttributes: [
      { name: 'Cor', values: ['Preto', 'Branco'] },
      { name: 'Tamanho', values: ['38', '39', '40', '41', '42', '43'] }
    ],
    specs: [['Gênero', 'Masculino'], ['Material', 'Tecido e sintético'], ['Estilo', 'Corrida']],
    pkg: [0.9, 20, 12, 32],
    description: 'Tênis de corrida com amortecimento macio e cabedal respirável.'
  },
  {
    id: 'cat-air-fryer-mondial', title: 'Fritadeira Air Fryer Mondial 4 L', brand: 'Mondial', model: 'AFN-40', line: 'Family',
    categoryId: 'casa', subcategoryId: 'cozinha', aliases: ['airfryer', 'fritadeira sem oleo'], referencePrice: 329,
    gtins: [gtin('789988203001')],
    variantAttributes: [{ name: 'Voltagem', values: ['110V', '220V'] }],
    specs: [['Potência', '1500 W'], ['Capacidade', '4 L'], ['Cor', 'Preto'], ['Timer', '60 min']],
    pkg: [4.2, 30, 32, 34],
    description: 'Air fryer de 4 litros com timer de 60 minutos e controle de temperatura até 200 °C.'
  },
  {
    id: 'cat-ps5-slim', title: 'Console PlayStation 5 Slim', brand: 'Sony', model: 'PS5 Slim', line: 'PlayStation',
    categoryId: 'eletronicos', subcategoryId: null, aliases: ['ps5'], referencePrice: null,
    gtins: [], variantAttributes: [], specs: [], pkg: [null, null, null, null], description: '', status: 'draft', photos: 0
  }
];

for (const [index, item] of catalog.entries()) {
  const { id, pkg, specs, status = 'active', photos = 4, ...rest } = item;
  const [weight, width, height, length] = pkg;
  const photoList = Array.from({ length: photos }, (_, i) => `https://picsum.photos/seed/vineon-${id}-${i}/800/800`);
  const variantImages = {};
  for (const [i, value] of (rest.variantAttributes[0]?.values || []).entries()) {
    variantImages[value] = photoList[i % Math.max(1, photoList.length)];
  }
  const data = {
    ...rest,
    photos: photoList,
    specs: specs.map(([label, value]) => ({ label, value })),
    variantImages: photoList.length ? variantImages : {},
    weight, width, height, length,
    status,
    createdBy: users.admin.uid,
    updatedBy: users.admin.uid,
    createdAt: Timestamp.fromMillis(now - index * 3_600_000),
    updatedAt: Timestamp.fromMillis(now - index * 3_600_000)
  };
  await db.doc(`catalogProducts/${id}`).set({ ...data, keywords: catalogKeywords(data) });
}

// Anúncio do Ateliê feito a partir do catálogo (concorrência do iPhone 15).
await db.doc('products/iphone-15-atelie').set({
  name: 'Apple iPhone 15',
  price: 4399,
  priceDiscounted: 4199,
  description: 'iPhone 15 lacrado, nota fiscal e garantia Apple de 1 ano.',
  photoURL: ['https://picsum.photos/seed/vineon-cat-iphone-15-0/800/800'],
  condition: 'novo',
  stock: 3,
  soldCount: 0,
  categoryIds: ['eletronicos'],
  subcategoryIds: ['celulares'],
  acceptOffers: false,
  paymentMethods: ['PIX', 'CARTÃO'],
  shipping: 'Frete Grátis',
  weight: 0.35, width: 10, height: 6, length: 18,
  specs: catalog[0].specs.map(([label, value]) => ({ label, value })),
  catalogId: 'cat-iphone-15',
  location: 'Florianópolis - SC',
  sellerId: users.atelie.uid,
  createdAt: Timestamp.fromMillis(now - 86_400_000),
  updatedAt: Timestamp.fromMillis(now - 86_400_000)
});

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
const DAY_MS = 86_400_000;
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
    // Igual ao checkout: retido desde a compra (releaseDate só ordena a lista do admin).
    escrowInfo: status === 'REFUNDED'
      ? { status: 'REFUNDED', releaseDate: Timestamp.fromMillis(created + 7 * 86_400_000) }
      : { status: 'HOLDING', releaseDate: Timestamp.fromMillis(created + 7 * 86_400_000) },
    customerData: { name: users.comprador.displayName, cpf: users.comprador.cpf, phone: users.comprador.phoneNumber, email: users.comprador.email },
    addressData: { street: 'Avenida Paulista', number: '1000', city: 'São Paulo', state: 'SP', postalCode: '01310100', neighborhood: 'Bela Vista' },
    shippingInfo: { serviceId: 1, serviceName: 'PAC', price: 24.9, deliveryTime: 6 }
  });
}

for (const [productId, count] of Object.entries(soldCount)) {
  await db.doc(`products/${productId}`).update({ soldCount: count });
}

// --------------------------------------------------------------- avaliações

// A Marina (Ateliê) também compra: três pedidos entregues de produtos da Loja
// de Teste, avaliados por ela. O comprador avalia dois dos que recebeu e fica
// com o resto em "Para avaliar". Os campos do servidor (selo, loja, nome do
// produto) já vão preenchidos; com o emulador de functions ligado,
// `onProductReviewWritten` confere a compra e grava a nota agregada.
const reviewBuyerOrders = [
  ['seed-r1', 'fone', 9],
  ['seed-r2', 'panela', 15],
  ['seed-r3', 'smartphone', 24],
];
for (const [orderId, productId, daysAgo] of reviewBuyerOrders) {
  const created = now - daysAgo * DAY_MS;
  const productData = productDocs[productId];
  await db.doc(`orders/${orderId}`).set({
    userId: users.atelie.uid,
    items: [{ productId, quantity: 1, addedAt: Timestamp.fromMillis(created), productData }],
    total: Math.round(((productData.priceDiscounted ?? productData.price) + 24.9) * 100) / 100,
    status: 'DELIVERED',
    shipmentStatus: 'DELIVERED',
    paymentMethod: 'PIX',
    sellerIds: [productData.sellerId],
    createdAt: Timestamp.fromMillis(created),
    paymentConfirmedAt: Timestamp.fromMillis(created + 15 * 60_000),
    deliveredAt: Timestamp.fromMillis(created + 4 * DAY_MS),
    escrowInfo: { status: 'HOLDING', releaseDate: Timestamp.fromMillis(created + 7 * DAY_MS) },
    customerData: { name: users.atelie.displayName, cpf: users.atelie.cpf, phone: users.atelie.phoneNumber, email: users.atelie.email },
    addressData: { street: 'Rua das Rendeiras', number: '200', city: 'Florianópolis', state: 'SC', postalCode: '88062000', neighborhood: 'Lagoa da Conceição' },
    shippingInfo: { serviceId: 1, serviceName: 'PAC', price: 24.9, deliveryTime: 6 }
  });
}

const reviewPlan = [
  {
    user: users.atelie, product: 'fone', order: 'seed-r1', rating: 5, daysAgo: 4, match: 'yes', helpful: 3,
    comment: 'Cancelamento de ruído funciona muito bem no ônibus. Bateria dura uns 3 dias usando 2h por dia. Veio lacrado e com nota.',
    reply: 'Que bom que gostou, Marina! Qualquer dúvida sobre o pareamento é só chamar.'
  },
  {
    user: users.atelie, product: 'panela', order: 'seed-r2', rating: 2, daysAgo: 9, match: 'partly', helpful: 1,
    comment: 'As panelas são boas, mas a caixa chegou amassada e a tampa menor veio com um risco. Mandei mensagem e ainda não tive resposta.'
  },
  {
    user: users.atelie, product: 'smartphone', order: 'seed-r3', rating: 4, daysAgo: 18, match: 'yes',
    comment: 'Rápido e a câmera é ótima de dia. À noite as fotos ficam um pouco granuladas.'
  },
  {
    user: users.comprador, product: 'camiseta', order: 'seed-11', rating: 4, daysAgo: 8, match: 'yes',
    comment: 'Tecido grosso e não desbotou na primeira lavagem. Vale pedir um número acima, veste justo.'
  },
  {
    user: users.comprador, product: 'colar-conchas', order: 'seed-14', rating: 5, daysAgo: 16, match: 'yes', helpful: 2,
    comment: 'Lindo, igualzinho às fotos. Veio numa embalagem de presente caprichada.',
    reply: 'Obrigada pelo carinho! Cada peça é montada à mão aqui no ateliê.'
  },
];
for (const r of reviewPlan) {
  const at = Timestamp.fromMillis(now - r.daysAgo * DAY_MS);
  const product = productDocs[r.product];
  const [first, ...rest] = r.user.displayName.split(' ');
  await db.doc(`products/${r.product}/reviews/${r.user.uid}`).set({
    userId: r.user.uid,
    userName: rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first,
    rating: r.rating,
    comment: r.comment,
    orderId: r.order,
    photos: [],
    matchesListing: r.match,
    createdAt: at,
    updatedAt: at,
    verifiedPurchase: true,
    sellerId: product.sellerId,
    productName: product.name,
    productPhoto: product.photoURL[0],
    helpfulCount: r.helpful ?? 0,
    ...(r.reply ? { sellerReply: { text: r.reply, createdAt: at, updatedAt: at } } : {}),
  });
}

// -------------------------------------------------------------- atendimentos

// "Fale com a Vineon": um de cada situação, para a fila do painel e a lista da
// pessoa já aparecerem completas. Protocolos seguem o contador `supportCounters`.
const HOUR = 3_600_000;
const year = new Date().getFullYear();

const ticketPlan = [
  {
    id: 'seedticket0000000001', user: users.comprador, role: 'buyer', topic: 'pedido-atraso', label: 'Pedido não chegou ou atrasou', priority: 'high',
    subject: 'Meu pedido não chegou', status: 'waiting_staff', createdAgo: 3 * HOUR, dueIn: 21 * HOUR, order: 'seed-04', stage: 'preparing',
    replies: [{ by: 'user', agoMs: 3 * HOUR, text: 'O prazo de entrega venceu ontem e o rastreio não anda. Pode verificar com a transportadora?' }],
  },
  {
    id: 'seedticket0000000002', user: users.comprador, role: 'buyer', topic: 'pagamento', label: 'Pagamento ou cobrança', priority: 'high',
    subject: 'Paguei o Pix e o pedido continua pendente', status: 'waiting_customer', createdAgo: 20 * HOUR, firstResponseAgo: 18 * HOUR, order: 'seed-03', stage: 'pay', userUnread: true,
    replies: [
      { by: 'user', agoMs: 20 * HOUR, text: 'Fiz o Pix ontem à noite e o pedido ainda aparece como aguardando pagamento.' },
      { by: 'staff', agoMs: 18 * HOUR, name: 'Henrique · Vineon', text: 'Olá! Conferimos aqui e não achamos o pagamento. Pode enviar o comprovante do Pix, com o horário?' },
    ],
  },
  {
    id: 'seedticket0000000003', user: users.comprador, role: 'buyer', topic: 'devolucao', label: 'Devolução e arrependimento', priority: 'normal',
    subject: 'Como peço a devolução do celular?', status: 'resolved', createdAgo: 52 * HOUR, firstResponseAgo: 50 * HOUR, resolvedAgo: 26 * HOUR,
    replies: [
      { by: 'user', agoMs: 52 * HOUR, text: 'Quero devolver o celular que comprei, mas não encontro o botão no pedido.' },
      { by: 'staff', agoMs: 50 * HOUR, name: 'Henrique · Vineon', text: 'Abra o pedido em Minha conta > Seus pedidos e toque em "Solicitar devolução". Se aparecer algum problema, responda aqui.' },
      { by: 'system', agoMs: 26 * HOUR, event: 'resolved', eventBy: 'staff' },
    ],
  },
  {
    id: 'seedticket0000000004', user: users.comprador, role: 'buyer', topic: 'outro', label: 'Outro assunto', priority: 'normal',
    subject: 'Sugestão para a vitrine', status: 'closed', createdAgo: 30 * 24 * HOUR, firstResponseAgo: 30 * 24 * HOUR - 5 * HOUR, resolvedAgo: 28 * 24 * HOUR, closedAgo: 20 * 24 * HOUR,
    csat: { score: 5, comment: 'Atendimento rápido, obrigado!' },
    replies: [
      { by: 'user', agoMs: 30 * 24 * HOUR, text: 'Seria legal poder ordenar a vitrine por menor preço.' },
      { by: 'staff', agoMs: 30 * 24 * HOUR - 5 * HOUR, name: 'Josué · Vineon', text: 'Obrigado pela sugestão! Já anotamos com o time.' },
      { by: 'system', agoMs: 28 * 24 * HOUR, event: 'resolved', eventBy: 'staff' },
      { by: 'system', agoMs: 20 * 24 * HOUR, event: 'closed', eventBy: 'staff' },
    ],
  },
  {
    id: 'seedticket0000000005', user: users.vendedor, role: 'seller', topic: 'repasse', label: 'Repasse e taxa', priority: 'normal',
    subject: 'Dúvida sobre o repasse de setembro', status: 'waiting_staff', createdAgo: 30 * HOUR, dueIn: -6 * HOUR,
    replies: [{ by: 'user', agoMs: 30 * HOUR, text: 'Gostaria de entender como a taxa da Vineon foi calculada nas vendas de setembro.' }],
  },
];

for (const [index, t] of ticketPlan.entries()) {
  const created = now - t.createdAgo;
  const order = t.order ? orderPlan[Number(t.order.split('-')[1]) - 1] : null;
  const product = order ? productDocs[order[1][0][0]] : null;
  const ref = db.doc(`supportTickets/${t.id}`);
  const lastReply = t.replies[t.replies.length - 1];
  const lastMessage = [...t.replies].reverse().find(r => r.by !== 'system');

  await ref.set({
    protocol: `VN-${year}-${String(index + 1).padStart(6, '0')}`,
    userId: t.user.uid,
    userName: t.user.displayName,
    userEmail: t.user.email,
    userRole: t.role,
    topic: t.topic,
    topicLabel: t.label,
    subject: t.subject,
    orderId: t.order ?? null,
    orderSnapshot: t.order ? {
      shortId: t.order.substring(0, 8).toUpperCase(), stage: t.stage, items: product.name, photo: product.photoURL?.[0] ?? null,
      total: 349.9, asRole: t.role,
    } : null,
    fromHelpArticle: null,
    relatedTicketId: null,
    status: t.status,
    priority: t.priority,
    assigneeId: t.firstResponseAgo ? users.admin.uid : null,
    assigneeName: t.firstResponseAgo ? 'Henrique' : null,
    channel: 'app',
    createdAt: Timestamp.fromMillis(created),
    updatedAt: Timestamp.fromMillis(now - Math.min(...t.replies.map(r => r.agoMs))),
    lastReplyAt: Timestamp.fromMillis(now - lastMessage.agoMs),
    lastReplyBy: lastMessage.by,
    replyCount: t.replies.filter(r => r.by !== 'system').length,
    firstResponseDueAt: Timestamp.fromMillis(t.dueIn !== undefined ? now + t.dueIn : created + 24 * HOUR),
    firstResponseAt: t.firstResponseAgo ? Timestamp.fromMillis(now - t.firstResponseAgo) : null,
    ...(t.resolvedAgo ? { resolvedAt: Timestamp.fromMillis(now - t.resolvedAgo), resolvedBy: 'staff' } : {}),
    ...(t.closedAgo ? { closedAt: Timestamp.fromMillis(now - t.closedAgo) } : {}),
    userUnread: t.userUnread === true,
    staffUnread: t.status === 'waiting_staff',
    csat: t.csat ? { ...t.csat, at: Timestamp.fromMillis(now - 19 * 24 * HOUR) } : null,
  });

  for (const [i, r] of t.replies.entries()) {
    await ref.collection('replies').doc(`r${i + 1}`).set({
      senderId: r.by === 'user' ? t.user.uid : users.admin.uid,
      senderRole: r.by,
      senderName: r.by === 'user' ? t.user.displayName : r.by === 'system' ? 'Vineon' : r.name,
      text: r.text ?? '',
      attachments: [],
      createdAt: Timestamp.fromMillis(now - r.agoMs),
      ...(r.event ? { event: r.event, eventBy: r.eventBy } : {}),
    });
  }
}

await db.doc(`supportCounters/${year}`).set({ seq: ticketPlan.length, updatedAt: FieldValue.serverTimestamp() });

// ------------------------------------------------------------------- cupons

// Um de cada tipo (ver docs/cupons.md). O id é o código. Contadores zerados:
// quem mexe neles é o servidor (couponQuote / onOrderWrittenCoupon).
const DAY = 86_400_000;
const couponBase = {
  maxDiscount: null, minSubtotal: 0, productIds: [], startsAt: Timestamp.fromMillis(now - DAY), endsAt: Timestamp.fromMillis(now + 30 * DAY),
  usageLimit: null, perUserLimit: 1, firstPurchaseOnly: false, visibility: 'public', status: 'active',
  sellerId: null, sellerName: null, scope: 'platform',
  redeemedCount: 0, ordersCount: 0, discountTotal: 0, createdBy: users.admin.uid,
  createdAt: Timestamp.fromMillis(now - DAY), updatedAt: Timestamp.fromMillis(now - DAY), updatedBy: users.admin.uid,
};
const coupons = [
  { code: 'VINEON10', type: 'percent', value: 10, maxDiscount: 50, minSubtotal: 100 },
  { code: 'FRETEGRATIS', type: 'shipping', value: 30, minSubtotal: 50 },
  { code: 'BEMVINDO20', type: 'fixed', value: 20, minSubtotal: 80, firstPurchaseOnly: true, endsAt: null },
  { code: 'ULTIMO1', type: 'fixed', value: 5, usageLimit: 1, visibility: 'private' },
  { code: 'VENCIDO', type: 'percent', value: 50, startsAt: Timestamp.fromMillis(now - 10 * DAY), endsAt: Timestamp.fromMillis(now - DAY) },
  { code: 'LOJA15', scope: 'seller', sellerId: users.vendedor.uid, sellerName: users.vendedor.doc.shopName, type: 'percent', value: 15, maxDiscount: 100, createdBy: users.vendedor.uid },
  { code: 'MARE20', scope: 'seller', sellerId: users.atelie.uid, sellerName: users.atelie.doc.shopName, type: 'fixed', value: 20, minSubtotal: 100, productIds: ['bolsa-palha', 'vaso-ceramica'], visibility: 'private', createdBy: users.atelie.uid },
  { code: 'PAUSADO', scope: 'seller', sellerId: users.vendedor.uid, sellerName: users.vendedor.doc.shopName, type: 'fixed', value: 10, status: 'paused', createdBy: users.vendedor.uid },
];
for (const coupon of coupons) {
  await db.doc(`coupons/${coupon.code}`).set({ ...couponBase, ...coupon });
}

console.log(`Seed concluído em ${PROJECT_ID}:`);
console.log(`  ${Object.keys(users).length} contas (admin, vendedor, atelie, comprador), senha "${PASSWORD}"`);
console.log(`  ${categories.length} categorias, ${products.length + 1} produtos, ${orderPlan.length} pedidos`);
console.log(`  ${catalog.length} produtos no catálogo (1 rascunho)`);
console.log(`  ${reviewPlan.length} avaliações (Marina avalia a Loja de Teste; o comprador avaliou 2 e tem o resto em "Para avaliar")`);
console.log(`  ${coupons.length} cupons (${coupons.map(c => c.code).join(', ')})`);
console.log(`  ${ticketPlan.length} atendimentos (um por situação: novo, aguardando cliente, resolvido, encerrado e um atrasado)`);
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

/** EAN-13 com dígito verificador válido a partir de 12 dígitos (fictício). */
function gtin(base) {
  const sum = base.split('').map(Number).reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return base + ((10 - (sum % 10)) % 10);
}

/**
 * Mesma regra de `catalogKeywords()` em src/app/core/catalog.ts: palavras e
 * prefixos (2 a 20 letras) de título, marca, modelo, linha, sinônimos, códigos
 * e opções das variações. Mudou lá, mude aqui.
 */
function catalogKeywords(p) {
  const words = new Set(
    [p.title, p.brand, p.model, p.line, ...(p.aliases || []), ...(p.gtins || []), ...(p.variantAttributes || []).flatMap(a => a.values)]
      .flatMap(text => (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  );
  const keys = new Set();
  for (const word of words) {
    if (word.length === 1) keys.add(word);
    for (let size = 2; size <= Math.min(word.length, 20); size++) keys.add(word.slice(0, size));
    keys.add(word);
  }
  return [...keys].slice(0, 400);
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
