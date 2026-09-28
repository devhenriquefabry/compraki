// Lote 2 do catálogo (28/09/2026): tipos de produto em alta na Shopee Brasil
// (Mapa Shopee 2026 e balanço de mais vendidos de 2025: smartphone, projetor,
// caixa de som, drone, parafusadeira, micro-ondas, itens de pet e cozinha)
// convertidos em modelos concretos, mais campeões que faltavam no lote 1.
//
// Itens genéricos do topo da Shopee (lençol 400 fios, tapete, cortina,
// torneira, papel de parede) ficaram de fora: não têm modelo padrão para
// virar ficha de catálogo.
//
// Mesmas regras do lote 1: ficha técnica conferida no fabricante/fichas
// públicas, nada inventado, sem fotos (usa a imagem ilustrativa), embalagem
// estimada. Importado por catalog-import.mjs junto com o lote 1.

const CEL = ['cat_eletronicos', 'cat_eletronicos-celulares'];
const AUDIO = ['cat_eletronicos', 'cat_eletronicos-audio'];
const TV = ['cat_eletronicos', 'cat_eletronicos-tv-video'];
const GAMES = ['cat_eletronicos', 'cat_eletronicos-games'];
const INFO = ['cat_eletronicos', 'cat_eletronicos-informatica'];
const CAM = ['cat_eletronicos', 'cat_eletronicos-cameras'];
const ACESS = ['cat_eletronicos', 'cat_eletronicos-acessorios'];
const COZ_ELETRO = ['cat_eletrodomesticos', 'cat_eletrodomesticos-cozinha'];
const COZ_CASA = ['cat_casa', 'cat_casa-cozinha'];
const FER_EL = ['cat_ferramentas', 'cat_ferramentas-ferramentas-eletricas'];
const RACAO = ['cat_petshop', 'cat_petshop-racao'];

const VOLT = { name: 'Voltagem', values: ['127V', '220V'] };

export const CATALOGO_LOTE_2 = [
  // ------------------------------------------------------------ celulares
  {
    id: 'xiaomi-redmi-15c', cat: CEL, title: 'Xiaomi Redmi 15C', brand: 'Xiaomi', model: 'Redmi 15C', line: 'Redmi',
    aliases: ['redmi15c', 'redmi 15c'], ref: null,
    options: [{ name: 'Armazenamento', values: ['128 GB', '256 GB'] }],
    specs: [['Tela', '6,9" LCD 120 Hz'], ['Processador', 'MediaTek Helio G81 Ultra (versão 4G)'], ['Câmera traseira', '50 MP'], ['Câmera frontal', '8 MP'], ['Bateria', '6.000 mAh'], ['Carregamento', '33 W'], ['Resistência', 'IP64'], ['NFC', 'Sim'], ['Sistema', 'Android 15 com HyperOS 2']],
    pkg: [0.5, 19, 10, 6],
    description: 'Redmi 15C com tela grande de 6,9 polegadas e 120 Hz, bateria de 6.000 mAh com carregamento de 33 W, câmera de 50 MP, NFC e proteção IP64.'
  },
  {
    id: 'xiaomi-redmi-note-15-5g', cat: CEL, title: 'Xiaomi Redmi Note 15 5G', brand: 'Xiaomi', model: 'Redmi Note 15 5G', line: 'Redmi Note',
    aliases: ['redmi note 15', 'note 15'], ref: null,
    options: [],
    specs: [['Tela', '6,77" AMOLED até 120 Hz'], ['Processador', 'Snapdragon 6 Gen 3'], ['Câmera traseira', '108 MP'], ['Câmera frontal', '20 MP'], ['Bateria', '6.000 mAh'], ['Resistência', 'IP64'], ['Rede', '5G']],
    pkg: [0.5, 19, 10, 6],
    description: 'Redmi Note 15 5G com tela AMOLED de 6,77 polegadas e até 120 Hz, câmera principal de 108 MP, Snapdragon 6 Gen 3 e bateria de 6.000 mAh.'
  },
  {
    id: 'xiaomi-poco-x7-pro', cat: CEL, title: 'Xiaomi Poco X7 Pro 5G', brand: 'Xiaomi', model: 'Poco X7 Pro', line: 'Poco',
    aliases: ['poco x7', 'pocox7'], ref: null,
    options: [{ name: 'Cor', values: ['Preto', 'Verde', 'Amarelo'] }, { name: 'Armazenamento', values: ['256 GB (8 GB RAM)', '512 GB (12 GB RAM)'] }],
    specs: [['Tela', '6,67" AMOLED 1.5K 120 Hz'], ['Processador', 'MediaTek Dimensity 8400-Ultra'], ['Câmera traseira', '50 MP com OIS + 8 MP ultra-angular'], ['Câmera frontal', '20 MP'], ['Vídeo', '4K até 60 fps'], ['Bateria', '6.000 mAh'], ['Carregamento', '90 W HyperCharge'], ['Rede', '5G']],
    pkg: [0.55, 19, 10, 6],
    description: 'Poco X7 Pro com Dimensity 8400-Ultra, tela AMOLED 1.5K de 120 Hz, câmera de 50 MP com estabilização óptica e bateria de 6.000 mAh com carregamento de 90 W.'
  },
  {
    id: 'samsung-galaxy-s25-fe', cat: CEL, title: 'Samsung Galaxy S25 FE', brand: 'Samsung', model: 'Galaxy S25 FE', line: 'Galaxy S',
    aliases: ['s25 fe', 's25fe'], ref: null,
    options: [{ name: 'Cor', values: ['Azul-marinho', 'Azul-claro', 'Preto', 'Branco'] }, { name: 'Armazenamento', values: ['128 GB', '256 GB', '512 GB'] }],
    specs: [['Tela', '6,7" Dynamic AMOLED 2X FHD+ 120 Hz'], ['Processador', 'Exynos 2400'], ['Memória RAM', '8 GB'], ['Câmera traseira', '50 MP + 12 MP ultra-angular + 8 MP teleobjetiva'], ['Câmera frontal', '12 MP'], ['Bateria', '4.900 mAh'], ['Recursos', 'Galaxy AI'], ['Rede', '5G']],
    pkg: [0.5, 18, 9, 6],
    description: 'Galaxy S25 FE com processador Exynos 2400, tela de 6,7 polegadas e 120 Hz, câmera tripla com teleobjetiva e bateria de 4.900 mAh. Recursos Galaxy AI e sete anos de atualizações do Android.'
  },

  // ------------------------------------------------------------ tablets e leitores
  {
    id: 'apple-ipad-11', cat: INFO, title: 'Apple iPad 11" (A16)', brand: 'Apple', model: 'iPad 11ª geração', line: 'iPad',
    aliases: ['ipad', 'ipad 11'], ref: null,
    options: [{ name: 'Cor', values: ['Azul', 'Rosa', 'Amarelo', 'Prateado'] }, { name: 'Armazenamento', values: ['128 GB', '256 GB', '512 GB'] }],
    specs: [['Tela', '11" Liquid Retina'], ['Chip', 'A16'], ['Conectividade', 'Wi-Fi'], ['Conector', 'USB-C'], ['Biometria', 'Touch ID no botão superior']],
    pkg: [0.9, 28, 20, 5],
    description: 'iPad de 11 polegadas com chip A16, tela Liquid Retina, Touch ID e conector USB-C. Compatível com Apple Pencil (USB-C) e Magic Keyboard Folio.'
  },
  {
    id: 'amazon-kindle-16gb', cat: INFO, title: 'Amazon Kindle 16 GB (11ª geração)', brand: 'Amazon', model: 'Kindle 11ª geração', line: 'Kindle',
    aliases: ['kindle', 'leitor digital'], ref: null,
    options: [{ name: 'Cor', values: ['Preto', 'Verde'] }],
    specs: [['Tela', '6" antirreflexo, 300 ppi'], ['Armazenamento', '16 GB'], ['Iluminação', 'Luz frontal ajustável'], ['Conector', 'USB-C'], ['Bateria', 'Até 6 semanas']],
    pkg: [0.4, 20, 14, 4],
    description: 'Kindle de 16 GB com tela de 6 polegadas e 300 ppi que parece papel, luz frontal ajustável, carregamento por USB-C e bateria de semanas.'
  },

  // ------------------------------------------------------------ vestíveis
  {
    id: 'xiaomi-smart-band-10', cat: ACESS, title: 'Xiaomi Smart Band 10', brand: 'Xiaomi', model: 'Smart Band 10', line: 'Smart Band',
    aliases: ['mi band', 'smart band', 'pulseira inteligente'], ref: null,
    options: [],
    specs: [['Tela', '1,72" AMOLED'], ['Bateria', 'Até 21 dias (uso típico)'], ['Resistência', '5 ATM (natação)'], ['Esportes', 'Mais de 150 modos'], ['Sensores', 'Frequência cardíaca, SpO2 e sono']],
    pkg: [0.15, 12, 8, 4],
    description: 'Xiaomi Smart Band 10 com tela AMOLED de 1,72 polegadas, até 21 dias de bateria, resistência a 5 ATM e mais de 150 modos esportivos, incluindo natação.'
  },
  {
    id: 'apple-watch-se-3', cat: ACESS, title: 'Apple Watch SE 3 (GPS)', brand: 'Apple', model: 'Apple Watch SE 3', line: 'Apple Watch',
    aliases: ['apple watch se', 'watch se'], ref: null,
    options: [{ name: 'Cor', values: ['Meia-noite', 'Estelar'] }, { name: 'Tamanho da caixa', values: ['40 mm', '44 mm'] }],
    specs: [['Chip', 'S10'], ['Tela', 'Retina sempre ativa'], ['Caixa', 'Alumínio'], ['Armazenamento', '64 GB'], ['Resistência', 'À água (natação)']],
    pkg: [0.4, 12, 12, 9],
    description: 'Apple Watch SE 3 com chip S10, tela Retina sempre ativa e caixa de alumínio, disponível em 40 mm e 44 mm.'
  },
  {
    id: 'apple-watch-series-11', cat: ACESS, title: 'Apple Watch Series 11 (GPS)', brand: 'Apple', model: 'Apple Watch Series 11', line: 'Apple Watch',
    aliases: ['apple watch 11', 'watch series 11'], ref: null,
    options: [{ name: 'Cor', values: ['Cinza-espacial', 'Prateado', 'Ouro-rosa', 'Preto-brilhante'] }, { name: 'Tamanho da caixa', values: ['42 mm', '46 mm'] }],
    specs: [['Chip', 'S10'], ['Tela', 'Retina sempre ativa, até 2.000 nits'], ['Caixa', 'Alumínio'], ['Resistência', 'À água até 50 m e IP6X'], ['Saúde', 'ECG, oxigênio no sangue e pontuação de sono']],
    pkg: [0.45, 12, 12, 9],
    description: 'Apple Watch Series 11 com chip S10, tela sempre ativa mais brilhante, ECG, oxigênio no sangue e pontuação de sono. Caixa de alumínio de 42 mm ou 46 mm.'
  },

  // ------------------------------------------------------------ áudio
  {
    id: 'samsung-galaxy-buds-core', cat: AUDIO, title: 'Fone Samsung Galaxy Buds Core', brand: 'Samsung', model: 'Galaxy Buds Core', line: 'Galaxy Buds',
    aliases: ['buds core'], ref: null,
    options: [{ name: 'Cor', values: ['Preto', 'Branco'] }],
    specs: [['Tipo', 'Fone sem fio TWS'], ['Cancelamento de ruído', 'Ativo (ANC)'], ['Bluetooth', '5.4'], ['Autonomia da bateria', 'Até 35 h com o estojo'], ['Resistência', 'IP54'], ['Recursos', 'Tradução com Galaxy AI']],
    pkg: [0.2, 12, 10, 5],
    description: 'Galaxy Buds Core com cancelamento ativo de ruído, Bluetooth 5.4, até 35 horas de bateria com o estojo, IP54 e tradução em tempo real com Galaxy AI.'
  },
  {
    id: 'xiaomi-redmi-buds-6-play', cat: AUDIO, title: 'Fone Xiaomi Redmi Buds 6 Play', brand: 'Xiaomi', model: 'Redmi Buds 6 Play', line: 'Redmi Buds',
    aliases: ['redmi buds'], ref: 75.05,
    options: [{ name: 'Cor', values: ['Preto', 'Branco'] }],
    specs: [['Tipo', 'Fone sem fio TWS'], ['Bluetooth', '5.4'], ['Autonomia da bateria', 'Até 7,5 h (36 h com o estojo)'], ['Driver', 'Dinâmico de 10 mm'], ['Resistência', 'IPX4'], ['Chamadas', 'Redução de ruído por IA']],
    pkg: [0.15, 12, 10, 5],
    description: 'Redmi Buds 6 Play com Bluetooth 5.4, até 36 horas de bateria com o estojo, driver de 10 mm, resistência IPX4 e redução de ruído em chamadas.'
  },
  {
    id: 'jbl-clip-5', cat: AUDIO, title: 'Caixa de Som JBL Clip 5', brand: 'JBL', model: 'Clip 5', line: 'Clip',
    aliases: ['jbl clip'], ref: null,
    options: [{ name: 'Cor', values: ['Preto', 'Azul', 'Vermelho', 'Branco'] }],
    specs: [['Tipo', 'Caixa de som portátil Bluetooth com mosquetão'], ['Potência', '7 W RMS'], ['Bluetooth', '5.3 com Auracast'], ['Resistência', 'IP67'], ['Autonomia da bateria', 'Até 12 h (+3 h com Playtime Boost)']],
    pkg: [0.4, 16, 10, 7],
    description: 'JBL Clip 5 com mosquetão integrado, 7 W RMS, Bluetooth 5.3 com Auracast, resistência IP67 e até 12 horas de bateria.'
  },
  {
    id: 'jbl-flip-7', cat: AUDIO, title: 'Caixa de Som JBL Flip 7', brand: 'JBL', model: 'Flip 7', line: 'Flip',
    aliases: ['jbl flip 7'], ref: null,
    options: [{ name: 'Cor', values: ['Preto', 'Azul', 'Vermelho'] }],
    specs: [['Tipo', 'Caixa de som portátil Bluetooth'], ['Potência', '25 W woofer + 10 W tweeter'], ['Bluetooth', '5.4 com Auracast'], ['Resistência', 'IP68, à prova de queda'], ['Autonomia da bateria', 'Até 14 h (+2 h com Playtime Boost)'], ['Recursos', 'AI Sound Boost e áudio por USB-C']],
    pkg: [0.9, 22, 10, 10],
    description: 'JBL Flip 7 com AI Sound Boost, Bluetooth 5.4 com Auracast, resistência IP68 e à prova de queda, e até 14 horas de bateria (mais 2 h com Playtime Boost).'
  },

  // ------------------------------------------------------------ TV, vídeo e câmeras
  {
    id: 'samsung-tv-50-crystal-u8000f', cat: TV, title: 'Smart TV Samsung 50" Crystal UHD 4K U8000F', brand: 'Samsung', model: 'U8000F 50"', line: 'Crystal UHD',
    aliases: ['tv 50', 'tv samsung 50', 'tv 4k'], ref: null,
    options: [],
    specs: [['Tamanho da tela', '50"'], ['Resolução', '4K UHD'], ['Processador', 'Crystal Processor 4K'], ['Sistema', 'Tizen, com 7 anos de atualizações'], ['Design', 'MetalStream'], ['Ano', '2025']],
    pkg: [12, 125, 78, 15],
    description: 'Smart TV Samsung Crystal UHD 4K de 50 polegadas (2025) com Crystal Processor 4K, sistema Tizen com sete anos de atualizações e design MetalStream.'
  },
  {
    id: 'amazon-fire-tv-stick-4k', cat: TV, title: 'Amazon Fire TV Stick 4K (2ª geração)', brand: 'Amazon', model: 'Fire TV Stick 4K', line: 'Fire TV',
    aliases: ['fire stick', 'fire tv'], ref: null,
    options: [],
    specs: [['Tipo', 'Streaming stick HDMI'], ['Resolução', '4K Ultra HD com HDR, Dolby Vision e HDR10+'], ['Conectividade', 'Wi-Fi 6'], ['Controle', 'Controle remoto por voz com Alexa']],
    pkg: [0.25, 18, 12, 5],
    description: 'Fire TV Stick 4K com Wi-Fi 6, suporte a Dolby Vision e HDR10+ e controle remoto por voz com Alexa. Transforma a TV em Smart TV pela entrada HDMI.'
  },
  {
    id: 'magcubic-projetor-hy300-pro', cat: TV, title: 'Projetor Portátil Magcubic HY300 Pro', brand: 'Magcubic', model: 'HY300 Pro', line: 'HY300',
    aliases: ['projetor 4k', 'hy300', 'mini projetor'], ref: null,
    options: [],
    specs: [['Resolução nativa', 'HD 720p (aceita sinal 4K)'], ['Brilho', '200 lúmens ANSI'], ['Sistema', 'Android 11'], ['Conectividade', 'Wi-Fi 6, Bluetooth, HDMI e USB'], ['Design', 'Base giratória 180°'], ['Tamanho da imagem', '35" a 135"']],
    pkg: [1, 20, 16, 16],
    description: 'Projetor portátil Magcubic HY300 Pro com Android 11, Wi-Fi 6, base giratória de 180° e imagem de 35 a 135 polegadas. Resolução nativa HD 720p, compatível com sinal 4K.'
  },
  {
    id: 'dji-mini-4k', cat: CAM, title: 'Drone DJI Mini 4K', brand: 'DJI', model: 'Mini 4K', line: 'DJI Mini',
    aliases: ['drone dji', 'dji mini'], ref: null,
    options: [],
    specs: [['Peso', 'Menos de 249 g'], ['Vídeo', '4K a 30 fps'], ['Foto', '12 MP'], ['Estabilização', 'Gimbal de 3 eixos'], ['Transmissão', 'Até 10 km'], ['Tempo de voo', 'Até 31 min por bateria']],
    pkg: [1.2, 26, 20, 10],
    description: 'Drone DJI Mini 4K com menos de 249 g, vídeo 4K estabilizado por gimbal de 3 eixos, transmissão de até 10 km e até 31 minutos de voo.'
  },
  {
    id: 'dji-neo', cat: CAM, title: 'Drone DJI Neo', brand: 'DJI', model: 'Neo', line: 'DJI Neo',
    aliases: ['drone', 'dji neo'], ref: null,
    options: [],
    specs: [['Peso', '135 g'], ['Vídeo', '4K a 30 fps'], ['Foto', '12 MP'], ['Recursos', 'Decola da palma da mão e segue você'], ['Tempo de voo', 'Até 18 min'], ['Proteção', 'Hélices protegidas']],
    pkg: [0.6, 20, 16, 8],
    description: 'DJI Neo, drone de 135 g que decola da palma da mão, segue você sozinho e grava em 4K. Hélices protegidas e até 18 minutos de voo.'
  },

  // ------------------------------------------------------------ games
  {
    id: 'microsoft-controle-xbox-series', cat: GAMES, title: 'Controle Sem Fio Xbox Series', brand: 'Microsoft', model: 'Controle Xbox Series', line: 'Xbox',
    aliases: ['controle xbox'], ref: null,
    options: [{ name: 'Cor', values: ['Carbon Black', 'Robot White'] }],
    specs: [['Compatibilidade', 'Xbox Series X|S, Xbox One, PC e celular'], ['Conexão', 'Sem fio e Bluetooth; USB-C'], ['Entrada de fone', 'P2 (3,5 mm)'], ['Alimentação', 'Pilhas AA']],
    pkg: [0.45, 19, 16, 7],
    description: 'Controle sem fio Xbox com botão Compartilhar, direcional híbrido e conexão Bluetooth, compatível com Xbox, PC e celular.'
  },

  // ------------------------------------------------------------ eletrodomésticos
  {
    id: 'philco-micro-ondas-pmo23', cat: COZ_ELETRO, title: 'Micro-ondas Philco 20 L PMO23', brand: 'Philco', model: 'PMO23', line: 'Micro-ondas',
    aliases: ['microondas', 'micro ondas'], ref: null,
    options: [{ name: 'Cor', values: ['Branco', 'Espelhado'] }, VOLT],
    specs: [['Capacidade', '20 L'], ['Potência', '1100 W'], ['Prato giratório', '25 cm'], ['Funções', 'Menu Fit e descongelamento por tempo ou peso'], ['Eficiência energética', 'A']],
    pkg: [11, 50, 38, 32],
    description: 'Micro-ondas Philco de 20 litros com Menu Fit, descongelamento por tempo ou por peso e interior Limpa Fácil.'
  },

  // ------------------------------------------------------------ casa e cozinha
  {
    id: 'stanley-quencher-1-18l', cat: COZ_CASA, title: 'Copo Térmico Stanley Quencher H2.0 1,18 L', brand: 'Stanley', model: 'Quencher H2.0 1,18 L', line: 'Quencher',
    aliases: ['stanley', 'copo stanley', 'copo termico'], ref: null,
    options: [],
    specs: [['Capacidade', '1,18 L'], ['Material', 'Aço inox 18/8, parede dupla a vácuo'], ['Conservação', 'Gelado por 11 h, com gelo por 2 dias, quente por 7 h'], ['Tampa', 'Giratória com 3 posições e canudo'], ['Recursos', 'Alça e base que cabe no porta-copos do carro']],
    pkg: [0.8, 30, 14, 14],
    description: 'Copo térmico Stanley Quencher H2.0 de 1,18 L em aço inox com isolamento a vácuo, tampa giratória de 3 posições, canudo e alça. Mantém bebidas geladas por horas.'
  },
  {
    id: 'tramontina-panelas-paris-7', cat: COZ_CASA, title: 'Jogo de Panelas Tramontina Paris 7 Peças Starflon Max', brand: 'Tramontina', model: 'Paris 7 peças', line: 'Paris',
    aliases: ['jogo de panelas', 'panelas tramontina'], ref: null,
    options: [{ name: 'Cor', values: ['Vermelho', 'Chumbo'] }],
    specs: [['Peças', '7: panelas 16 e 18 cm, caçarola 22 cm, fervedor 12 cm, frigideiras 18 e 20 cm e espátula'], ['Material', 'Alumínio com antiaderente Starflon Max'], ['Tampas', 'Vidro temperado com saída de vapor'], ['Fogões', 'Gás, elétrico e vitrocerâmico (não serve para indução)'], ['Lava-louças', 'Pode ir']],
    pkg: [6, 45, 30, 30],
    description: 'Jogo Tramontina Paris com 7 peças em alumínio com antiaderente Starflon Max, tampas de vidro com saída de vapor e cabos de baquelite. Não é compatível com indução.'
  },

  // ------------------------------------------------------------ ferramentas
  {
    id: 'bosch-parafusadeira-gsr-120-li', cat: FER_EL, title: 'Parafusadeira e Furadeira Bosch GSR 120-LI 12 V', brand: 'Bosch', model: 'GSR 120-LI', line: 'Bosch Professional',
    aliases: ['parafusadeira bosch', 'furadeira bosch'], ref: null,
    options: [{ name: 'Kit', values: ['1 bateria', '2 baterias'] }],
    specs: [['Bateria', '12 V de lítio'], ['Torque', '30 Nm (duro) / 14 Nm (leve)'], ['Velocidades', '2 (0–400 e 0–1.600 rpm)'], ['Mandril', '3/8" (10 mm), aperto rápido'], ['Ajuste de torque', '20 + 1 posições'], ['Perfuração máxima', 'Madeira 20 mm, aço 10 mm']],
    pkg: [2, 36, 30, 10],
    description: 'Parafusadeira e furadeira Bosch GSR 120-LI de 12 V, compacta, com torque de até 30 Nm, duas velocidades e mandril de aperto rápido de 3/8".'
  },

  // ------------------------------------------------------------ pet
  {
    id: 'premier-golden-caes-adultos-frango-15kg', cat: RACAO, title: 'Ração GoldeN Fórmula Cães Adultos Frango e Arroz 15 kg', brand: 'PremieR Pet', model: 'GoldeN Fórmula Adultos', line: 'GoldeN',
    aliases: ['racao golden', 'golden formula', 'racao cachorro'], ref: null,
    options: [],
    specs: [['Espécie', 'Cães'], ['Idade', 'Adultos'], ['Sabor', 'Frango e arroz'], ['Peso', '15 kg'], ['Destaques', 'Ômega 3 e 6, ajuda a reduzir o tártaro e o odor das fezes']],
    pkg: [15.3, 65, 42, 14],
    description: 'Ração GoldeN Fórmula para cães adultos sabor frango e arroz, 15 kg. Com ômega 3 e 6, ajuda na saúde oral, intestinal e na redução do odor das fezes.'
  },
  {
    id: 'whiskas-sache-carne-85g', cat: RACAO, title: 'Ração Úmida Whiskas Sachê Carne ao Molho Gatos Adultos 85 g', brand: 'Whiskas', model: 'Sachê Carne ao Molho 85 g', line: 'Whiskas',
    aliases: ['sache whiskas', 'racao gato'], ref: null,
    options: [{ name: 'Embalagem', values: ['1 unidade', 'Caixa com 20 unidades'] }],
    specs: [['Espécie', 'Gatos'], ['Idade', 'Adultos'], ['Sabor', 'Carne ao molho'], ['Peso', '85 g por sachê'], ['Tipo', 'Alimento úmido completo']],
    pkg: [0.1, 15, 9, 2],
    description: 'Sachê Whiskas carne ao molho para gatos adultos, 85 g. Refeição completa e balanceada, sem corantes e aromatizantes artificiais.'
  },
];
