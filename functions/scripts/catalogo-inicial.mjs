// Catálogo inicial da Vineon: produtos novos mais vendidos/anunciados no
// Brasil (lista "Mais vendidos" do Mercado Livre, set/2026, + campeões de
// venda de cada categoria). Importado por catalog-import.mjs.
//
// Fichas técnicas conferidas em fontes do fabricante e fichas públicas
// (Samsung, Apple, Motorola, Tecnoblog, TechTudo). Entram só características
// confirmadas; na dúvida o campo fica de fora.
//
// SEM FOTOS de propósito: imagens de anúncio são de quem as fez (vendedor ou
// marca). Sem foto, o vendedor envia as dele ao anunciar; o admin pode pôr a
// foto oficial depois, quando tiver direito de uso.
//
// Medidas da embalagem (peso kg, comprimento × largura × altura cm) são
// ESTIMATIVAS para o frete — o vendedor ajusta se a dele for diferente.
// `ref` = preço visto no Mercado Livre em 27/09/2026 (referência, não regra).

const CEL = ['cat_eletronicos', 'cat_eletronicos-celulares'];
const AUDIO = ['cat_eletronicos', 'cat_eletronicos-audio'];
const TV = ['cat_eletronicos', 'cat_eletronicos-tv-video'];
const GAMES = ['cat_eletronicos', 'cat_eletronicos-games'];
const INFO = ['cat_eletronicos', 'cat_eletronicos-informatica'];
const PEQ = ['cat_eletrodomesticos', 'cat_eletrodomesticos-pequenos'];
const COZ = ['cat_eletrodomesticos', 'cat_eletrodomesticos-cozinha'];
const CLIMA = ['cat_eletrodomesticos', 'cat_eletrodomesticos-climatizacao'];
const ASP = ['cat_eletrodomesticos', 'cat_eletrodomesticos-aspiradores'];
const FER_EL = ['cat_ferramentas', 'cat_ferramentas-ferramentas-eletricas'];
const FER_MAN = ['cat_ferramentas', 'cat_ferramentas-ferramentas-manuais'];
const PELE = ['cat_beleza', 'cat_beleza-pele'];
const CABELO = ['cat_beleza', 'cat_beleza-cabelos'];
const PERF = ['cat_beleza', 'cat_beleza-perfumaria'];
const SUPL = ['cat_saude', 'cat_saude-suplementos'];
const CALC = ['cat_moda', 'cat_moda-calcados'];

const VOLT = { name: 'Voltagem', values: ['127V', '220V'] };

export const CATALOGO_INICIAL = [
  // ------------------------------------------------------------ celulares
  {
    id: 'apple-iphone-17', cat: CEL, title: 'Apple iPhone 17', brand: 'Apple', model: 'iPhone 17', line: 'iPhone',
    aliases: ['iphone17'], ref: 5598,
    options: [{ name: 'Cor', values: ['Preto', 'Branco', 'Lavanda', 'Azul-névoa', 'Sálvia'] }, { name: 'Armazenamento', values: ['256 GB', '512 GB'] }],
    specs: [['Tela', '6,3" Super Retina XDR com ProMotion até 120 Hz'], ['Chip', 'A19'], ['Câmera traseira', 'Fusion 48 MP + ultra-angular 48 MP'], ['Câmera frontal', '18 MP (Center Stage)'], ['Rede 5G', 'Sim'], ['Resistência', 'IP68'], ['Conector', 'USB-C'], ['Biometria', 'Face ID']],
    pkg: [0.45, 18, 10, 6],
    description: 'iPhone 17 com tela de 6,3 polegadas ProMotion de até 120 Hz, chip A19 e sistema de câmera dupla de 48 MP (Fusion e ultra-angular). Câmera frontal de 18 MP com Center Stage, Face ID, 5G e conector USB-C.'
  },
  {
    id: 'apple-iphone-17-pro', cat: CEL, title: 'Apple iPhone 17 Pro', brand: 'Apple', model: 'iPhone 17 Pro', line: 'iPhone',
    aliases: ['iphone17pro'], ref: null,
    options: [{ name: 'Cor', values: ['Laranja-cósmico', 'Azul-intenso', 'Prateado'] }, { name: 'Armazenamento', values: ['256 GB', '512 GB', '1 TB'] }],
    specs: [['Tela', '6,3" Super Retina XDR com ProMotion até 120 Hz'], ['Chip', 'A19 Pro'], ['Memória RAM', '12 GB'], ['Câmeras traseiras', 'Três de 48 MP: Fusion, ultra-angular e teleobjetiva 4x'], ['Câmera frontal', '18 MP (Center Stage)'], ['Rede 5G', 'Sim'], ['Resistência', 'IP68'], ['Conector', 'USB-C']],
    pkg: [0.5, 18, 10, 6],
    description: 'iPhone 17 Pro com chip A19 Pro, tela de 6,3 polegadas ProMotion e três câmeras traseiras de 48 MP, incluindo teleobjetiva com zoom óptico de 4x. Resistência IP68, 5G e conector USB-C.'
  },
  {
    id: 'apple-iphone-16', cat: CEL, title: 'Apple iPhone 16', brand: 'Apple', model: 'iPhone 16', line: 'iPhone',
    aliases: ['iphone16'], ref: null,
    options: [{ name: 'Cor', values: ['Preto', 'Branco', 'Rosa', 'Verde-acinzentado', 'Ultramarino'] }, { name: 'Armazenamento', values: ['128 GB', '256 GB', '512 GB'] }],
    specs: [['Tela', '6,1" Super Retina XDR'], ['Chip', 'A18'], ['Câmera traseira', 'Fusion 48 MP + ultra-angular 12 MP'], ['Câmera frontal', '12 MP'], ['Botões', 'Botão de Ação e Controle da Câmera'], ['Rede 5G', 'Sim'], ['Resistência', 'IP68'], ['Conector', 'USB-C']],
    pkg: [0.45, 18, 10, 6],
    description: 'iPhone 16 com chip A18, tela Super Retina XDR de 6,1 polegadas, câmera Fusion de 48 MP e ultra-angular de 12 MP. Tem botão de Ação, Controle da Câmera, 5G e conector USB-C.'
  },
  {
    id: 'apple-iphone-16e', cat: CEL, title: 'Apple iPhone 16e', brand: 'Apple', model: 'iPhone 16e', line: 'iPhone',
    aliases: ['iphone16e'], ref: null,
    options: [{ name: 'Cor', values: ['Preto', 'Branco'] }, { name: 'Armazenamento', values: ['128 GB', '256 GB', '512 GB'] }],
    specs: [['Tela', '6,1" Super Retina XDR OLED'], ['Chip', 'A18'], ['Câmera traseira', 'Fusion 48 MP'], ['Câmera frontal', '12 MP'], ['Biometria', 'Face ID'], ['Rede 5G', 'Sim'], ['Resistência', 'IP68'], ['Conector', 'USB-C']],
    pkg: [0.4, 18, 10, 6],
    description: 'iPhone 16e com chip A18, tela OLED de 6,1 polegadas, câmera Fusion de 48 MP e Face ID. É o iPhone de entrada da linha 16, com 5G, resistência IP68 e conector USB-C.'
  },
  {
    id: 'apple-iphone-15', cat: CEL, title: 'Apple iPhone 15', brand: 'Apple', model: 'iPhone 15', line: 'iPhone',
    aliases: ['iphone15'], ref: null,
    options: [{ name: 'Cor', values: ['Preto', 'Azul', 'Verde', 'Amarelo', 'Rosa'] }, { name: 'Armazenamento', values: ['128 GB', '256 GB', '512 GB'] }],
    specs: [['Tela', '6,1" Super Retina XDR'], ['Chip', 'A16 Bionic'], ['Câmera traseira', '48 MP + ultra-angular 12 MP'], ['Câmera frontal', '12 MP'], ['Recursos', 'Dynamic Island'], ['Rede 5G', 'Sim'], ['Resistência', 'IP68'], ['Conector', 'USB-C']],
    pkg: [0.45, 18, 10, 6],
    description: 'iPhone 15 com Dynamic Island, chip A16 Bionic, tela Super Retina XDR de 6,1 polegadas e câmera principal de 48 MP. Primeiro iPhone da linha com conector USB-C.'
  },
  {
    id: 'samsung-galaxy-a07', cat: CEL, title: 'Samsung Galaxy A07 4G', brand: 'Samsung', model: 'Galaxy A07', line: 'Galaxy A',
    aliases: ['a07'], ref: 1019,
    options: [{ name: 'Cor', values: ['Preto', 'Verde', 'Violeta'] }, { name: 'Armazenamento', values: ['128 GB (4 GB RAM)', '256 GB (8 GB RAM)'] }],
    specs: [['Tela', '6,7" LCD HD+ 90 Hz'], ['Processador', 'MediaTek Helio G99'], ['Câmera traseira', '50 MP + 2 MP (profundidade)'], ['Câmera frontal', '8 MP'], ['Bateria', '5.000 mAh'], ['Carregamento', '25 W'], ['Resistência', 'IP54'], ['Sistema', 'Android 15 (One UI 7), até 6 atualizações'], ['Cartão de memória', 'microSD']],
    pkg: [0.45, 18, 9, 6],
    description: 'Galaxy A07 com tela de 6,7 polegadas de 90 Hz, processador Helio G99, câmera de 50 MP e bateria de 5.000 mAh com carregamento de 25 W. Proteção IP54 e até seis anos de atualizações do Android.'
  },
  {
    id: 'samsung-galaxy-a17-4g', cat: CEL, title: 'Samsung Galaxy A17 4G', brand: 'Samsung', model: 'Galaxy A17', line: 'Galaxy A',
    aliases: ['a17', 'a175'], ref: 1159,
    options: [{ name: 'Cor', values: ['Preto', 'Azul', 'Cinza'] }, { name: 'Armazenamento', values: ['128 GB (4 GB RAM)', '256 GB (8 GB RAM)'] }],
    specs: [['Tela', '6,7" Super AMOLED Full HD+ 90 Hz'], ['Processador', 'MediaTek Helio G99'], ['Câmera traseira', '50 MP com OIS + 5 MP ultra-angular + 2 MP macro'], ['Câmera frontal', '13 MP'], ['Bateria', '5.000 mAh'], ['Carregamento', '25 W'], ['Resistência', 'IP54'], ['NFC', 'Sim'], ['Rede', '4G']],
    pkg: [0.45, 18, 9, 6],
    description: 'Galaxy A17 4G com tela Super AMOLED de 6,7 polegadas, câmera principal de 50 MP com estabilização óptica, bateria de 5.000 mAh e NFC. Recursos de IA e até seis anos de atualizações.'
  },
  {
    id: 'samsung-galaxy-a17-5g', cat: CEL, title: 'Samsung Galaxy A17 5G', brand: 'Samsung', model: 'Galaxy A17 5G', line: 'Galaxy A',
    aliases: ['a17 5g', 'a176'], ref: null,
    options: [{ name: 'Cor', values: ['Preto', 'Azul', 'Cinza'] }, { name: 'Armazenamento', values: ['128 GB (4 GB RAM)', '256 GB (8 GB RAM)'] }],
    specs: [['Tela', '6,7" Super AMOLED Full HD+ 90 Hz'], ['Processador', 'Exynos 1330'], ['Câmera traseira', '50 MP com OIS + 5 MP ultra-angular + 2 MP macro'], ['Câmera frontal', '13 MP'], ['Bateria', '5.000 mAh'], ['Carregamento', '25 W'], ['Resistência', 'IP54'], ['NFC', 'Sim'], ['Rede', '5G']],
    pkg: [0.45, 18, 9, 6],
    description: 'Galaxy A17 5G com processador Exynos 1330, tela Super AMOLED de 6,7 polegadas, câmera de 50 MP com OIS e bateria de 5.000 mAh. Conexão 5G, NFC e até seis anos de atualizações.'
  },
  {
    id: 'samsung-galaxy-a36-5g', cat: CEL, title: 'Samsung Galaxy A36 5G', brand: 'Samsung', model: 'Galaxy A36 5G', line: 'Galaxy A',
    aliases: ['a36'], ref: 1847,
    options: [{ name: 'Cor', values: ['Preto', 'Branco', 'Verde', 'Violeta'] }, { name: 'Armazenamento', values: ['128 GB (6 GB RAM)', '256 GB (8 GB RAM)'] }],
    specs: [['Tela', '6,7" Super AMOLED Full HD+ 120 Hz'], ['Processador', 'Snapdragon 6 Gen 3'], ['Câmera traseira', '50 MP com OIS + 8 MP ultra-angular + 5 MP macro'], ['Câmera frontal', '12 MP'], ['Bateria', '5.000 mAh'], ['Carregamento', '45 W'], ['Resistência', 'IP67'], ['NFC', 'Sim'], ['Rede', '5G']],
    pkg: [0.45, 18, 9, 6],
    description: 'Galaxy A36 5G com tela Super AMOLED de 6,7 polegadas e 120 Hz, Snapdragon 6 Gen 3, câmera tripla com principal de 50 MP e bateria de 5.000 mAh com carregamento de 45 W. Resistência IP67 e recursos de IA.'
  },
  {
    id: 'samsung-galaxy-a56-5g', cat: CEL, title: 'Samsung Galaxy A56 5G', brand: 'Samsung', model: 'Galaxy A56 5G', line: 'Galaxy A',
    aliases: ['a56'], ref: null,
    options: [{ name: 'Cor', values: ['Grafite', 'Cinza', 'Verde-oliva', 'Rosa'] }, { name: 'Armazenamento', values: ['128 GB', '256 GB'] }],
    specs: [['Tela', '6,7" Super AMOLED Full HD+ 120 Hz'], ['Processador', 'Exynos 1580'], ['Memória RAM', '8 GB'], ['Câmera traseira', '50 MP com OIS + 12 MP ultra-angular + 5 MP macro'], ['Câmera frontal', '12 MP'], ['Bateria', '5.000 mAh'], ['Carregamento', '45 W'], ['Resistência', 'IP67'], ['Rede', '5G']],
    pkg: [0.45, 18, 9, 6],
    description: 'Galaxy A56 5G com processador Exynos 1580, 8 GB de RAM, tela Super AMOLED de 6,7 polegadas e 120 Hz e câmera tripla de 50 MP. Bateria de 5.000 mAh com carregamento de 45 W e resistência IP67.'
  },
  {
    id: 'samsung-galaxy-a57-5g', cat: CEL, title: 'Samsung Galaxy A57 5G', brand: 'Samsung', model: 'Galaxy A57 5G', line: 'Galaxy A',
    aliases: ['a57'], ref: 1709,
    options: [{ name: 'Cor', values: ['Azul-marinho', 'Cinza', 'Azul-claro', 'Lilás'] }, { name: 'Armazenamento', values: ['128 GB', '256 GB'] }],
    specs: [['Tela', '6,7" Super AMOLED+ Full HD+ 120 Hz'], ['Processador', 'Exynos 1680'], ['Memória RAM', '8 GB'], ['Câmera traseira', '50 MP com OIS + 12 MP ultra-angular + 5 MP macro'], ['Câmera frontal', '12 MP'], ['Bateria', '5.000 mAh'], ['Resistência', 'IP68'], ['Rede', '5G']],
    pkg: [0.45, 18, 9, 6],
    description: 'Galaxy A57 5G com processador Exynos 1680, tela Super AMOLED+ de 6,7 polegadas e 120 Hz, câmera principal de 50 MP com OIS e bateria de 5.000 mAh. Resistência IP68 e recursos de IA.'
  },
  {
    id: 'motorola-moto-g06', cat: CEL, title: 'Motorola Moto G06', brand: 'Motorola', model: 'Moto G06', line: 'Moto G',
    aliases: ['g06', 'motog06'], ref: 782,
    options: [{ name: 'Cor', values: ['Azul-marinho', 'Laranja', 'Verde', 'Bege'] }, { name: 'Armazenamento', values: ['128 GB', '256 GB'] }],
    specs: [['Tela', '6,88" LCD HD+ 120 Hz'], ['Processador', 'MediaTek Helio G81 Extreme'], ['Memória RAM', '4 GB (+ RAM Boost)'], ['Câmera traseira', '50 MP'], ['Câmera frontal', '8 MP'], ['Bateria', '5.200 mAh'], ['Resistência', 'IP64']],
    pkg: [0.45, 18, 9, 6],
    description: 'Moto G06 com tela grande de 6,88 polegadas e 120 Hz, câmera de 50 MP e bateria de 5.200 mAh. Proteção IP64 contra respingos e poeira e cores em parceria com a Pantone.'
  },
  {
    id: 'motorola-moto-g17', cat: CEL, title: 'Motorola Moto G17', brand: 'Motorola', model: 'Moto G17', line: 'Moto G',
    aliases: ['g17', 'motog17'], ref: 799,
    options: [{ name: 'Cor', values: ['Roxo', 'Azul-claro', 'Rosa'] }, { name: 'Armazenamento', values: ['128 GB', '256 GB'] }],
    specs: [['Tela', '6,72" LCD Full HD+'], ['Processador', 'MediaTek Helio G81 Extreme'], ['Memória RAM', '4 GB (+ RAM Boost)'], ['Câmera traseira', '50 MP Sony LYTIA 600'], ['Câmera frontal', '32 MP'], ['Bateria', '5.200 mAh'], ['Resistência', 'IP64']],
    pkg: [0.45, 18, 9, 6],
    description: 'Moto G17 com câmera de 50 MP Sony LYTIA 600, selfie de 32 MP, tela Full HD+ de 6,72 polegadas e bateria de 5.200 mAh. Proteção IP64 e cores Pantone.'
  },
  {
    id: 'motorola-moto-g86-5g', cat: CEL, title: 'Motorola Moto G86 5G', brand: 'Motorola', model: 'Moto G86 5G', line: 'Moto G',
    aliases: ['g86', 'motog86'], ref: 1827,
    options: [{ name: 'Cor', values: ['Pantone Spellbound', 'Pantone Chrysanthemum', 'Pantone Cosmic Sky', 'Pantone Golden Cypress'] }, { name: 'Armazenamento', values: ['256 GB', '512 GB'] }],
    specs: [['Tela', '6,67" pOLED Super HD (1.5K) 120 Hz'], ['Processador', 'MediaTek Dimensity 7300'], ['Câmera traseira', '50 MP Sony LYTIA 600 com OIS + 8 MP ultra-angular'], ['Câmera frontal', '32 MP'], ['Vídeo', '4K'], ['Bateria', '5.200 mAh'], ['Resistência', 'IP68 e IP69, padrão militar MIL-STD-810H'], ['Rede', '5G']],
    pkg: [0.45, 18, 9, 6],
    description: 'Moto G86 5G com tela pOLED 1.5K de 6,67 polegadas, Dimensity 7300, câmera de 50 MP com estabilização óptica e gravação em 4K. Bateria de 5.200 mAh, IP68/IP69 e resistência de padrão militar.'
  },

  // ------------------------------------------------------------ áudio
  {
    id: 'jbl-go-4', cat: AUDIO, title: 'Caixa de Som JBL Go 4', brand: 'JBL', model: 'Go 4', line: 'Go',
    aliases: ['jbl go', 'caixinha jbl'], ref: null,
    options: [{ name: 'Cor', values: ['Preto', 'Azul', 'Vermelho', 'Branco', 'Rosa'] }],
    specs: [['Tipo', 'Caixa de som portátil Bluetooth'], ['Bluetooth', '5.3 com Auracast'], ['Resistência', 'IP67 (água e poeira)'], ['Autonomia da bateria', 'Até 7 h'], ['Carregamento', 'USB-C']],
    pkg: [0.3, 12, 8, 6],
    description: 'Caixa de som portátil JBL Go 4 com som JBL Pro, Bluetooth 5.3 com Auracast para conectar mais caixas, resistência IP67 e até 7 horas de bateria. Compacta, com alça para levar em qualquer lugar.'
  },
  {
    id: 'jbl-flip-6', cat: AUDIO, title: 'Caixa de Som JBL Flip 6', brand: 'JBL', model: 'Flip 6', line: 'Flip',
    aliases: ['jbl flip'], ref: null,
    options: [{ name: 'Cor', values: ['Preto', 'Azul', 'Vermelho'] }],
    specs: [['Tipo', 'Caixa de som portátil Bluetooth'], ['Potência', '30 W (20 W woofer + 10 W tweeter)'], ['Resistência', 'IP67 (água e poeira)'], ['Autonomia da bateria', 'Até 12 h'], ['Recursos', 'PartyBoost'], ['Carregamento', 'USB-C']],
    pkg: [0.8, 22, 10, 10],
    description: 'JBL Flip 6 com alto-falante de dois canais (woofer e tweeter), som JBL Pro, resistência IP67 e até 12 horas de bateria. Conecta com outras caixas compatíveis pelo PartyBoost.'
  },
  {
    id: 'jbl-charge-5', cat: AUDIO, title: 'Caixa de Som JBL Charge 5', brand: 'JBL', model: 'Charge 5', line: 'Charge',
    aliases: ['jbl charge'], ref: null,
    options: [{ name: 'Cor', values: ['Preto', 'Azul', 'Vermelho'] }],
    specs: [['Tipo', 'Caixa de som portátil Bluetooth'], ['Potência', '40 W (30 W woofer + 10 W tweeter)'], ['Resistência', 'IP67 (água e poeira)'], ['Autonomia da bateria', 'Até 20 h'], ['Recursos', 'PartyBoost e power bank para carregar o celular'], ['Carregamento', 'USB-C']],
    pkg: [1.3, 26, 12, 12],
    description: 'JBL Charge 5 com som potente de dois canais, até 20 horas de bateria e saída para carregar o celular. Resistência IP67 e PartyBoost para tocar junto com outras caixas JBL.'
  },
  {
    id: 'jbl-tune-520bt', cat: AUDIO, title: 'Fone de Ouvido JBL Tune 520BT', brand: 'JBL', model: 'Tune 520BT', line: 'Tune',
    aliases: ['jbl tune', 'fone jbl'], ref: null,
    options: [{ name: 'Cor', values: ['Preto', 'Azul', 'Branco', 'Roxo'] }],
    specs: [['Tipo', 'Headphone on-ear sem fio'], ['Bluetooth', '5.3'], ['Autonomia da bateria', 'Até 57 h'], ['Som', 'JBL Pure Bass'], ['Microfone', 'Sim'], ['Multiponto', 'Conecta a dois aparelhos ao mesmo tempo']],
    pkg: [0.35, 20, 18, 7],
    description: 'Fone JBL Tune 520BT com som JBL Pure Bass, até 57 horas de bateria, recarga rápida e conexão multiponto. Leve, dobrável e com microfone para chamadas.'
  },
  {
    id: 'jbl-quantum-100m2', cat: GAMES, title: 'Headset Gamer JBL Quantum 100M2', brand: 'JBL', model: 'Quantum 100M2', line: 'Quantum',
    aliases: ['headset jbl', 'fone gamer jbl'], ref: 165.77,
    options: [],
    specs: [['Tipo', 'Headset gamer over-ear com fio'], ['Microfone', 'Removível'], ['Conexão', 'P2 (3,5 mm)'], ['Compatibilidade', 'PS4, PS5, Xbox, PC e celular com entrada P2'], ['Cor', 'Preto']],
    pkg: [0.5, 22, 20, 10],
    description: 'Headset gamer JBL Quantum 100M2 com som JBL Quantum, microfone removível e conexão P2 de 3,5 mm, compatível com consoles, PC e celular.'
  },
  {
    id: 'apple-airpods-4', cat: AUDIO, title: 'Apple AirPods 4', brand: 'Apple', model: 'AirPods 4', line: 'AirPods',
    aliases: ['airpods'], ref: null,
    options: [{ name: 'Versão', values: ['Sem cancelamento de ruído', 'Com cancelamento ativo de ruído'] }],
    specs: [['Tipo', 'Fone sem fio intra-auricular'], ['Chip', 'H2'], ['Estojo', 'Recarga por USB-C'], ['Resistência', 'IP54 (fones e estojo)'], ['Áudio Espacial', 'Personalizado, com rastreamento dinâmico da cabeça']],
    pkg: [0.2, 10, 10, 5],
    description: 'AirPods 4 com chip H2, novo formato mais confortável, Áudio Espacial personalizado e estojo com recarga USB-C. Disponível também na versão com cancelamento ativo de ruído.'
  },
  {
    id: 'apple-airpods-pro-2', cat: AUDIO, title: 'Apple AirPods Pro (2ª geração) com estojo USB-C', brand: 'Apple', model: 'AirPods Pro 2', line: 'AirPods',
    aliases: ['airpods pro'], ref: null,
    options: [],
    specs: [['Tipo', 'Fone sem fio intra-auricular'], ['Chip', 'H2'], ['Cancelamento de ruído', 'Ativo, com modo Ambiente adaptativo'], ['Estojo', 'MagSafe com recarga USB-C'], ['Resistência', 'IP54 (fones e estojo)']],
    pkg: [0.2, 10, 10, 5],
    description: 'AirPods Pro de 2ª geração com chip H2, cancelamento ativo de ruído, modo Ambiente adaptativo e estojo MagSafe com recarga USB-C.'
  },
  {
    id: 'anker-soundcore-p30i', cat: AUDIO, title: 'Fone de Ouvido Sem Fio Soundcore P30i Anker', brand: 'Anker', model: 'Soundcore P30i', line: 'Soundcore',
    aliases: ['soundcore', 'p30i'], ref: 196.59,
    options: [],
    specs: [['Tipo', 'Fone sem fio TWS'], ['Bluetooth', '5.4'], ['Cancelamento de ruído', 'Adaptativo'], ['Autonomia da bateria', 'Até 45 h com o estojo'], ['Resistência', 'IP54'], ['Estojo', '2 em 1, vira suporte para o celular']],
    pkg: [0.2, 12, 10, 5],
    description: 'Fone soundcore P30i da Anker com cancelamento de ruído adaptativo, graves reforçados, Bluetooth 5.4 e até 45 horas de reprodução. O estojo também serve de suporte para o celular.'
  },
  {
    id: 'amazon-echo-dot-5', cat: AUDIO, title: 'Amazon Echo Dot 5ª geração com Alexa', brand: 'Amazon', model: 'Echo Dot 5ª geração', line: 'Echo',
    aliases: ['alexa', 'echo dot'], ref: null,
    options: [{ name: 'Cor', values: ['Preta', 'Branca', 'Azul'] }],
    specs: [['Tipo', 'Smart speaker com Alexa'], ['Conectividade', 'Wi-Fi e Bluetooth'], ['Sensor', 'Temperatura'], ['Casa inteligente', 'Controla dispositivos compatíveis por voz'], ['Privacidade', 'Botão para desligar os microfones'], ['Alimentação', 'Fonte bivolt']],
    pkg: [0.5, 12, 12, 11],
    description: 'Echo Dot de 5ª geração com Alexa, som mais cheio que as gerações anteriores, sensor de temperatura e controle de casa inteligente por voz. Conecta por Wi-Fi e Bluetooth.'
  },

  // ------------------------------------------------------------ TV e vídeo
  {
    id: 'philco-smart-tv-32-p32vik', cat: TV, title: 'Smart TV Philco 32" Roku TV P32VIK', brand: 'Philco', model: 'P32VIK', line: 'Roku TV',
    aliases: ['tv 32', 'tv philco'], ref: null,
    options: [],
    specs: [['Tamanho da tela', '32"'], ['Tipo de tela', 'LED'], ['Resolução', 'HD'], ['Sistema', 'Roku TV'], ['Recursos', 'HDR e Dolby Audio'], ['Conectividade', 'Wi-Fi'], ['Voltagem', 'Bivolt']],
    pkg: [5, 80, 51, 12],
    description: 'Smart TV Philco de 32 polegadas com sistema Roku TV, HDR, Dolby Audio e Wi-Fi. Acesso aos principais aplicativos de streaming direto na TV.'
  },
  {
    id: 'roku-streaming-stick-2025', cat: TV, title: 'Roku Streaming Stick (2025)', brand: 'Roku', model: 'Streaming Stick 3840BR', line: 'Streaming Stick',
    aliases: ['roku', 'stick tv'], ref: null,
    options: [],
    specs: [['Tipo', 'Streaming stick HDMI'], ['Resolução', 'Até Full HD'], ['Controle', 'Controle remoto com comando de voz'], ['Conectividade', 'Wi-Fi'], ['Modelo', '3840BR']],
    pkg: [0.2, 18, 11, 4],
    description: 'Roku Streaming Stick transforma a TV em Smart TV pela entrada HDMI, com controle remoto por voz e acesso aos principais aplicativos de streaming.'
  },

  // ------------------------------------------------------------ games
  {
    id: 'sony-playstation-5-slim', cat: GAMES, title: 'Console Sony PlayStation 5 Slim', brand: 'Sony', model: 'PlayStation 5 Slim', line: 'PlayStation',
    aliases: ['ps5', 'play 5', 'playstation5'], ref: 4369,
    options: [{ name: 'Versão', values: ['Digital (sem leitor de disco)', 'Com leitor de disco'] }],
    specs: [['Armazenamento', 'SSD de 1 TB'], ['Resolução', 'Até 4K'], ['Taxa de quadros', 'Até 120 fps'], ['Recursos', 'Ray tracing e áudio 3D'], ['Controle', 'DualSense incluso'], ['Conectividade', 'Wi-Fi 6 e Bluetooth']],
    pkg: [4.5, 48, 40, 14],
    description: 'PlayStation 5 Slim com SSD de 1 TB, jogos em até 4K e 120 fps, ray tracing e controle DualSense com feedback tátil e gatilhos adaptáveis. Versões digital ou com leitor de disco.'
  },
  {
    id: 'sony-dualsense-ps5', cat: GAMES, title: 'Controle Sem Fio Sony DualSense PS5', brand: 'Sony', model: 'DualSense', line: 'PlayStation',
    aliases: ['controle ps5', 'dualsense'], ref: 417.57,
    options: [{ name: 'Cor', values: ['Branco', 'Midnight Black', 'Cosmic Red', 'Starlight Blue', 'Nova Pink', 'Galactic Purple'] }],
    specs: [['Compatibilidade', 'PlayStation 5 e PC'], ['Conexão', 'Sem fio (Bluetooth) e USB-C'], ['Recursos', 'Feedback tátil e gatilhos adaptáveis'], ['Microfone', 'Embutido'], ['Bateria', 'Recarregável']],
    pkg: [0.45, 19, 17, 8],
    description: 'Controle DualSense original do PS5 com feedback tátil, gatilhos adaptáveis, microfone embutido e bateria recarregável por USB-C.'
  },
  {
    id: 'sony-dualshock-4', cat: GAMES, title: 'Controle Sem Fio Sony DualShock 4 PS4', brand: 'Sony', model: 'DualShock 4', line: 'PlayStation',
    aliases: ['controle ps4', 'dualshock'], ref: 549.99,
    options: [],
    specs: [['Compatibilidade', 'PlayStation 4 e PC'], ['Conexão', 'Sem fio (Bluetooth)'], ['Recursos', 'Touchpad, barra de luz e alto-falante'], ['Entrada de fone', 'P2 (3,5 mm)'], ['Bateria', 'Recarregável']],
    pkg: [0.4, 19, 17, 8],
    description: 'Controle DualShock 4 original do PS4 com touchpad, barra de luz, alto-falante embutido e entrada para fone de ouvido.'
  },
  {
    id: 'microsoft-xbox-series-s', cat: GAMES, title: 'Console Microsoft Xbox Series S', brand: 'Microsoft', model: 'Xbox Series S', line: 'Xbox',
    aliases: ['xbox', 'series s'], ref: null,
    options: [{ name: 'Armazenamento', values: ['512 GB (branco)', '1 TB (preto)'] }],
    specs: [['Tipo', 'Console 100% digital (sem leitor de disco)'], ['Resolução', 'Até 1440p, com streaming em 4K'], ['Taxa de quadros', 'Até 120 fps'], ['Armazenamento', 'SSD'], ['Controle', 'Controle sem fio Xbox incluso']],
    pkg: [3.2, 35, 30, 11],
    description: 'Xbox Series S, console totalmente digital com SSD, jogos em até 1440p e 120 fps e compatibilidade com o Game Pass. Acompanha controle sem fio.'
  },
  {
    id: 'nintendo-switch-2', cat: GAMES, title: 'Console Nintendo Switch 2', brand: 'Nintendo', model: 'Switch 2', line: 'Switch',
    aliases: ['switch 2', 'switch2'], ref: null,
    options: [],
    specs: [['Tela', '7,9" LCD Full HD, até 120 Hz, com HDR'], ['Armazenamento', '256 GB'], ['Na TV', 'Até 4K pela base (dock)'], ['Controles', 'Joy-Con 2 magnéticos'], ['Cartão de memória', 'microSD Express']],
    pkg: [2.2, 35, 20, 12],
    description: 'Nintendo Switch 2 com tela de 7,9 polegadas Full HD de até 120 Hz, 256 GB de armazenamento e saída em até 4K na TV. Novos Joy-Con 2 com encaixe magnético.'
  },
  {
    id: 'nintendo-switch-oled', cat: GAMES, title: 'Console Nintendo Switch OLED', brand: 'Nintendo', model: 'Switch OLED', line: 'Switch',
    aliases: ['switch oled', 'nintendo switch'], ref: null,
    options: [{ name: 'Cor', values: ['Branco', 'Neon (azul e vermelho)'] }],
    specs: [['Tela', '7" OLED'], ['Armazenamento', '64 GB'], ['Base', 'Com porta de rede (LAN)'], ['Modos', 'TV, semiportátil e portátil'], ['Controles', 'Joy-Con']],
    pkg: [1.9, 34, 19, 11],
    description: 'Nintendo Switch modelo OLED com tela de 7 polegadas, 64 GB de armazenamento, suporte ajustável e base com porta de rede para jogar na TV.'
  },

  // ------------------------------------------------------------ informática
  {
    id: 'kingston-nv3-1tb', cat: INFO, title: 'SSD Kingston NV3 1 TB M.2 NVMe', brand: 'Kingston', model: 'NV3 1TB', line: 'NV3',
    aliases: ['ssd 1tb', 'ssd nvme'], ref: 1003,
    options: [],
    specs: [['Capacidade', '1 TB'], ['Formato', 'M.2 2280'], ['Interface', 'PCIe 4.0 NVMe'], ['Leitura', 'Até 6.000 MB/s'], ['Gravação', 'Até 4.000 MB/s']],
    pkg: [0.1, 15, 10, 2],
    description: 'SSD Kingston NV3 de 1 TB no formato M.2 2280 com interface PCIe 4.0 NVMe e leitura de até 6.000 MB/s. Ideal para acelerar PC, notebook e consoles compatíveis.'
  },
  {
    id: 'logitech-mx-master-3s', cat: INFO, title: 'Mouse Sem Fio Logitech MX Master 3S', brand: 'Logitech', model: 'MX Master 3S', line: 'MX',
    aliases: ['mx master'], ref: null,
    options: [{ name: 'Cor', values: ['Grafite', 'Cinza-claro'] }],
    specs: [['Sensor', 'Até 8.000 DPI, funciona até sobre vidro'], ['Cliques', 'Silenciosos'], ['Rolagem', 'MagSpeed eletromagnética'], ['Conexão', 'Bluetooth e receptor Logi Bolt'], ['Dispositivos', 'Até 3 pareados'], ['Bateria', 'Recarregável por USB-C, até 70 dias']],
    pkg: [0.3, 17, 11, 7],
    description: 'Mouse Logitech MX Master 3S com sensor de 8.000 DPI, cliques silenciosos, rolagem MagSpeed e conexão com até três dispositivos. Bateria recarregável por USB-C.'
  },
  {
    id: 'logitech-mk270', cat: INFO, title: 'Combo Teclado e Mouse Sem Fio Logitech MK270', brand: 'Logitech', model: 'MK270', line: 'MK',
    aliases: ['teclado e mouse', 'mk270'], ref: null,
    options: [],
    specs: [['Conexão', 'Sem fio 2,4 GHz com receptor USB'], ['Layout do teclado', 'ABNT2'], ['Teclas', 'Atalhos de mídia'], ['Alimentação', 'Pilhas (inclusas)'], ['Cor', 'Preto']],
    pkg: [0.8, 48, 17, 5],
    description: 'Combo sem fio Logitech MK270 com teclado ABNT2 com teclas de mídia e mouse compacto, ligados por um único receptor USB.'
  },
  {
    id: 'starlink-mini', cat: INFO, title: 'Kit Starlink Mini Internet via Satélite', brand: 'Starlink', model: 'Mini', line: 'Starlink',
    aliases: ['starlink', 'internet satelite'], ref: 474.05,
    options: [],
    specs: [['Tipo', 'Antena de internet via satélite portátil'], ['Wi-Fi', 'Roteador integrado'], ['Resistência', 'IP67'], ['Alimentação', '12–48 V DC ou USB-C PD (100 W)'], ['Peso', 'Cerca de 1,1 kg']],
    pkg: [2, 38, 32, 8],
    description: 'Starlink Mini, antena compacta de internet via satélite com roteador Wi-Fi integrado, resistência IP67 e alimentação por fonte DC ou USB-C. Requer plano de serviço Starlink.'
  },

  // ------------------------------------------------------------ eletrodomésticos
  {
    id: 'elgin-air-fryer-quad-fry-4-2l', cat: PEQ, title: 'Fritadeira Air Fryer Elgin Quad Fry 4,2 L', brand: 'Elgin', model: 'Quad Fry', line: 'Air Fryer',
    aliases: ['airfryer', 'fritadeira sem oleo'], ref: 459,
    options: [VOLT],
    specs: [['Capacidade', '4,2 L'], ['Potência', '1400 W'], ['Tipo', 'Fritadeira elétrica sem óleo']],
    pkg: [4.5, 35, 32, 34],
    description: 'Air fryer Elgin Quad Fry com cesto de 4,2 litros e 1400 W de potência. Frita, assa e reaquece sem óleo.'
  },
  {
    id: 'philco-air-fryer-oven-paf16c', cat: PEQ, title: 'Fritadeira Air Fryer Oven Philco 16 L PAF16C', brand: 'Philco', model: 'PAF16C', line: 'Air Fryer',
    aliases: ['airfryer forno', 'air fryer oven'], ref: 346,
    options: [VOLT],
    specs: [['Capacidade', '16 L'], ['Tipo', 'Air fryer forno (oven)'], ['Cor', 'Preto']],
    pkg: [8, 45, 40, 42],
    description: 'Air fryer forno Philco de 16 litros para fritar sem óleo, assar e gratinar, com espaço para receitas maiores.'
  },
  {
    id: 'mondial-air-fryer-oven-afon-12l', cat: PEQ, title: 'Fritadeira Air Fryer Oven Mondial 12 L AFON-12L-BG', brand: 'Mondial', model: 'AFON-12L-BG', line: 'Air Fryer',
    aliases: ['airfryer forno mondial'], ref: 632.49,
    options: [VOLT],
    specs: [['Capacidade', '12 L'], ['Tipo', 'Air fryer forno (oven)'], ['Cor', 'Preto']],
    pkg: [7.5, 42, 38, 40],
    description: 'Air fryer forno Mondial de 12 litros: frita sem óleo, assa e gratina em um só aparelho.'
  },
  {
    id: 'mondial-liquidificador-l99-fb', cat: PEQ, title: 'Liquidificador Mondial Turbo Power 550 W L-99 FB', brand: 'Mondial', model: 'L-99 FB', line: 'Turbo Power',
    aliases: ['liquidificador mondial'], ref: 110.99,
    options: [VOLT],
    specs: [['Potência', '550 W'], ['Linha', 'Turbo Power'], ['Cor', 'Preto']],
    pkg: [2.5, 24, 22, 38],
    description: 'Liquidificador Mondial Turbo Power L-99 de 550 W para sucos, vitaminas e massas do dia a dia.'
  },
  {
    id: 'oster-liquidificador-oliq610', cat: PEQ, title: 'Liquidificador Oster Full 1400 W 3,2 L OLIQ610', brand: 'Oster', model: 'OLIQ610', line: 'Full',
    aliases: ['liquidificador oster'], ref: 178.95,
    options: [VOLT],
    specs: [['Potência', '1400 W'], ['Capacidade da jarra', '3,2 L'], ['Cor', 'Preto']],
    pkg: [3, 26, 24, 42],
    description: 'Liquidificador Oster OLIQ610 de 1400 W com jarra de 3,2 litros para preparar grandes quantidades.'
  },
  {
    id: 'mondial-batedeira-b44', cat: PEQ, title: 'Batedeira Mondial Prática 400 W B-44', brand: 'Mondial', model: 'B-44', line: 'Prática',
    aliases: ['batedeira'], ref: 102.57,
    options: [VOLT],
    specs: [['Potência', '400 W'], ['Linha', 'Prática'], ['Tipo', 'Batedeira com tigela']],
    pkg: [2.5, 32, 22, 28],
    description: 'Batedeira Mondial Prática de 400 W para massas, bolos e cremes, com tigela e batedores inclusos.'
  },
  {
    id: 'electrolux-cafeteira-ecm10', cat: PEQ, title: 'Cafeteira Elétrica Electrolux ECM10 15 Xícaras', brand: 'Electrolux', model: 'ECM10', line: 'Cafeteira',
    aliases: ['cafeteira'], ref: 113.25,
    options: [VOLT],
    specs: [['Capacidade', '600 ml (até 15 xícaras)'], ['Acabamento', 'Inox'], ['Filtro', 'Permanente e removível'], ['Recursos', 'Corta-pingos e mantém aquecido']],
    pkg: [1.8, 30, 22, 30],
    description: 'Cafeteira Electrolux ECM10 com acabamento em inox, capacidade de 600 ml (até 15 xícaras), filtro permanente removível, sistema corta-pingos e placa que mantém o café aquecido.'
  },
  {
    id: 'mondial-ventilador-vsp-30', cat: CLIMA, title: 'Ventilador de Mesa Mondial Super Power 30 cm VSP-30', brand: 'Mondial', model: 'VSP-30', line: 'Super Power',
    aliases: ['ventilador'], ref: 117.81,
    options: [VOLT],
    specs: [['Diâmetro', '30 cm'], ['Potência', '60 W'], ['Velocidades', '3'], ['Oscilação', 'Horizontal']],
    pkg: [2.5, 36, 18, 36],
    description: 'Ventilador de mesa Mondial Super Power de 30 cm e 60 W com 3 velocidades e oscilação horizontal.'
  },
  {
    id: 'britania-aspirador-bas1295p', cat: ASP, title: 'Aspirador de Pó Britânia 1250 W BAS1295P', brand: 'Britânia', model: 'BAS1295P', line: 'Aspirador',
    aliases: ['aspirador britania'], ref: 139.61,
    options: [VOLT],
    specs: [['Potência', '1250 W'], ['Capacidade do reservatório', '1 L'], ['Cor', 'Preto']],
    pkg: [2.5, 40, 20, 26],
    description: 'Aspirador de pó Britânia BAS1295P com 1250 W de potência e reservatório de 1 litro.'
  },
  {
    id: 'electrolux-aspirador-vertical-stk15', cat: ASP, title: 'Aspirador de Pó Vertical Electrolux 1450 W STK15', brand: 'Electrolux', model: 'STK15', line: 'Vertical',
    aliases: ['aspirador vertical'], ref: 265.23,
    options: [VOLT],
    specs: [['Potência', '1450 W'], ['Tipo', 'Vertical 2 em 1 (vira aspirador de mão)'], ['Capacidade', '1,6 L'], ['Filtro', 'HEPA'], ['Alimentação', 'Com fio'], ['Cor', 'Cinza-escuro']],
    pkg: [3, 60, 25, 16],
    description: 'Aspirador vertical Electrolux STK15 de 1450 W, 2 em 1 (vertical e de mão), reservatório de 1,6 L e filtro HEPA.'
  },
  {
    id: 'wap-aspirador-vertical-ci10', cat: ASP, title: 'Aspirador Vertical WAP Power Speed Max CI10 3 em 1 1600 W', brand: 'WAP', model: 'Power Speed Max CI10', line: 'Power Speed',
    aliases: ['aspirador wap'], ref: 223.83,
    options: [VOLT],
    specs: [['Potência', '1600 W'], ['Tipo', 'Vertical 3 em 1'], ['Alimentação', 'Com fio']],
    pkg: [3, 60, 25, 16],
    description: 'Aspirador vertical WAP Power Speed Max CI10, 3 em 1, com 1600 W de potência para o dia a dia.'
  },
  {
    id: 'wap-aspirador-po-agua-gtw10', cat: ASP, title: 'Aspirador de Pó e Água WAP GTW 10 1400 W', brand: 'WAP', model: 'GTW 10', line: 'GTW',
    aliases: ['aspirador po e agua'], ref: 398,
    options: [VOLT],
    specs: [['Potência', '1400 W'], ['Função', 'Aspira pó e água e sopra'], ['Capacidade', '10 L'], ['Cor', 'Cinza']],
    pkg: [5, 40, 36, 42],
    description: 'Aspirador de pó e água WAP GTW 10 com 1400 W, reservatório de 10 litros e função sopro.'
  },

  // ------------------------------------------------------------ ferramentas
  {
    id: 'karcher-lavadora-compacta', cat: FER_EL, title: 'Lavadora de Alta Pressão Kärcher Compacta 1500 PSI', brand: 'Kärcher', model: 'Compacta', line: 'Lavadora',
    aliases: ['lava jato', 'karcher'], ref: 367.91,
    options: [VOLT],
    specs: [['Pressão', '1500 PSI'], ['Potência', '1400 W'], ['Vazão', '300 L/h'], ['Acessórios', 'Aplicador de detergente e lança regulável']],
    pkg: [6, 45, 30, 30],
    description: 'Lavadora de alta pressão Kärcher Compacta com 1500 PSI, 1400 W e vazão de 300 L/h. Acompanha aplicador de detergente e lança regulável.'
  },
  {
    id: 'wap-lavadora-ousada-wl2600', cat: FER_EL, title: 'Lavadora de Alta Pressão WAP Ousada WL 2600 Ultra 1750 PSI', brand: 'WAP', model: 'Ousada WL 2600 Ultra', line: 'Ousada',
    aliases: ['lava jato wap'], ref: 597,
    options: [VOLT],
    specs: [['Pressão', '1750 PSI'], ['Potência', '1500 W'], ['Recursos', 'Kit desobstruidor']],
    pkg: [7, 50, 32, 32],
    description: 'Lavadora de alta pressão WAP Ousada WL 2600 Ultra com 1750 PSI e 1500 W, com função desobstruidora.'
  },
  {
    id: 'makita-serra-marmore-4100nh3zx', cat: FER_EL, title: 'Serra Mármore Makita 4100NH3ZX 1300 W 110 mm', brand: 'Makita', model: '4100NH3ZX', line: 'Serra mármore',
    aliases: ['serra marmore', 'makita'], ref: 347.43,
    options: [VOLT],
    specs: [['Potência', '1300 W'], ['Diâmetro do disco', '110 mm'], ['Acessórios', '2 discos inclusos']],
    pkg: [3.5, 32, 20, 16],
    description: 'Serra mármore Makita 4100NH3ZX de 1300 W para discos de 110 mm, com dois discos inclusos.'
  },
  {
    id: 'gedore-jogo-chaves-combinadas-8-19', cat: FER_MAN, title: 'Jogo de Chaves Combinadas Gedore 8 a 19 mm 8 Peças', brand: 'Gedore', model: '002614', line: 'Chaves combinadas',
    aliases: ['jogo de chaves'], ref: 183.75,
    options: [],
    specs: [['Peças', '8'], ['Medidas', '8 a 19 mm'], ['Tipo', 'Chave combinada (boca e estria)']],
    pkg: [1, 30, 12, 4],
    description: 'Jogo Gedore com 8 chaves combinadas (boca e estria) de 8 a 19 mm.'
  },
  {
    id: 'vonder-estilete-es218', cat: FER_MAN, title: 'Estilete Largo Vonder ES 218 Lâmina 18 mm', brand: 'Vonder', model: 'ES 218', line: 'Estilete',
    aliases: ['estilete'], ref: 19,
    options: [],
    specs: [['Largura da lâmina', '18 mm'], ['Tipo', 'Estilete largo']],
    pkg: [0.1, 20, 6, 3],
    description: 'Estilete largo Vonder ES 218 com lâmina de 18 mm.'
  },

  // ------------------------------------------------------------ beleza
  {
    id: 'la-roche-posay-cicaplast-baume-b5', cat: PELE, title: 'La Roche-Posay Cicaplast Baume B5+ 40 ml', brand: 'La Roche-Posay', model: 'Cicaplast Baume B5+', line: 'Cicaplast',
    aliases: ['cicaplast'], ref: 71.52,
    options: [],
    specs: [['Volume', '40 ml'], ['Tipo de pele', 'Todos os tipos'], ['Uso', 'Rosto e corpo, dia e noite'], ['Ativos', 'Pantenol e madecassoside']],
    pkg: [0.1, 16, 5, 4],
    description: 'Cicaplast Baume B5+ da La Roche-Posay, bálsamo reparador multiuso para rosto e corpo com pantenol e madecassoside. Indicado para todos os tipos de pele.'
  },
  {
    id: 'cerave-locao-hidratante-473ml', cat: PELE, title: 'CeraVe Loção Hidratante Corporal 473 ml', brand: 'CeraVe', model: 'Loção Hidratante', line: 'CeraVe',
    aliases: ['cerave'], ref: 90.92,
    options: [],
    specs: [['Volume', '473 ml'], ['Ativos', '3 ceramidas essenciais e ácido hialurônico'], ['Fragrância', 'Sem perfume'], ['Textura', 'Fluida']],
    pkg: [0.6, 20, 8, 8],
    description: 'Loção hidratante CeraVe de 473 ml com três ceramidas essenciais e ácido hialurônico, textura fluida e sem perfume.'
  },
  {
    id: 'la-roche-posay-anthelios-antioleosidade-fps80', cat: PELE, title: 'Protetor Solar Facial La Roche-Posay Anthelios Antioleosidade FPS 80 40 g', brand: 'La Roche-Posay', model: 'Anthelios Antioleosidade FPS 80', line: 'Anthelios',
    aliases: ['anthelios', 'protetor solar'], ref: 67.7,
    options: [],
    specs: [['Proteção', 'FPS 80'], ['Peso', '40 g'], ['Uso', 'Facial'], ['Indicação', 'Pele oleosa (antioleosidade)']],
    pkg: [0.1, 15, 5, 4],
    description: 'Protetor solar facial Anthelios Antioleosidade da La Roche-Posay com FPS 80, em embalagem de 40 g.'
  },
  {
    id: 'loreal-elseve-oleo-extraordinario-100ml', cat: CABELO, title: "L'Oréal Paris Elseve Óleo Extraordinário 100 ml", brand: "L'Oréal Paris", model: 'Óleo Extraordinário', line: 'Elseve',
    aliases: ['elseve oleo'], ref: 39.9,
    options: [],
    specs: [['Volume', '100 ml'], ['Tipo', 'Óleo capilar leave-in'], ['Benefícios', 'Antifrizz e protetor térmico'], ['Tipo de cabelo', 'Todos']],
    pkg: [0.2, 15, 5, 5],
    description: "Óleo Extraordinário Elseve da L'Oréal Paris, leave-in de 100 ml com ação antifrizz e proteção térmica para todos os tipos de cabelo."
  },
  {
    id: 'britania-escova-secadora-bec07r', cat: CABELO, title: 'Escova Secadora Britânia 4 em 1 1300 W BEC07R', brand: 'Britânia', model: 'BEC07R', line: 'Escova secadora',
    aliases: ['escova secadora'], ref: 103.16,
    options: [],
    specs: [['Potência', '1300 W'], ['Funções', '4 em 1: seca, alisa, modela e dá volume'], ['Revestimento', 'Cerâmica'], ['Voltagem', 'Bivolt'], ['Cor', 'Rosa']],
    pkg: [0.9, 38, 14, 10],
    description: 'Escova secadora Britânia 4 em 1 de 1300 W com revestimento cerâmico: seca, alisa, modela e dá volume. Bivolt.'
  },
  {
    id: 'mondial-escova-rotativa-erb01', cat: CABELO, title: 'Escova Rotativa Mondial Tourmaline Ion 3 em 1 ERB-01', brand: 'Mondial', model: 'ERB-01', line: 'Tourmaline Ion',
    aliases: ['escova rotativa'], ref: 139,
    options: [VOLT],
    specs: [['Funções', '3 em 1'], ['Revestimento', 'Cerâmica com turmalina e íons'], ['Cor', 'Rosa']],
    pkg: [1, 40, 14, 10],
    description: 'Escova rotativa Mondial Tourmaline Ion 3 em 1 com revestimento cerâmico e turmalina, para escovar e modelar com menos frizz.'
  },
  {
    id: 'boticario-insensatez-100ml', cat: PERF, title: 'O Boticário Insensatez Desodorante Colônia 100 ml', brand: 'O Boticário', model: 'Insensatez', line: 'Insensatez',
    aliases: ['insensatez', 'perfume feminino'], ref: 113.31,
    options: [],
    specs: [['Volume', '100 ml'], ['Tipo', 'Desodorante colônia'], ['Público', 'Feminino']],
    pkg: [0.4, 14, 8, 6],
    description: 'Insensatez, desodorante colônia feminina de O Boticário em frasco de 100 ml.'
  },
  {
    id: 'natura-kaiak-ultra-100ml', cat: PERF, title: 'Natura Kaiak Ultra Colônia Masculina 100 ml', brand: 'Natura', model: 'Kaiak Ultra', line: 'Kaiak',
    aliases: ['kaiak', 'perfume masculino'], ref: 93.7,
    options: [],
    specs: [['Volume', '100 ml'], ['Tipo', 'Desodorante colônia'], ['Público', 'Masculino']],
    pkg: [0.4, 14, 8, 6],
    description: 'Kaiak Ultra, desodorante colônia masculina da Natura em frasco de 100 ml.'
  },

  // ------------------------------------------------------------ suplementos
  {
    id: 'growth-creatina-monohidratada', cat: SUPL, title: 'Creatina Monohidratada Growth Supplements', brand: 'Growth Supplements', model: 'Creatina Monohidratada', line: 'Creatina',
    aliases: ['creatina growth', 'creatina'], ref: null,
    options: [{ name: 'Peso', values: ['250 g', '500 g', '1 kg'] }],
    specs: [['Tipo', 'Creatina monohidratada em pó'], ['Sabor', 'Sem sabor']],
    pkg: [0.4, 14, 10, 10],
    description: 'Creatina monohidratada em pó da Growth Supplements, sem sabor, para misturar em água ou na bebida de preferência.'
  },
  {
    id: 'growth-whey-concentrado-1kg', cat: SUPL, title: 'Whey Protein Concentrado Growth Supplements 1 kg', brand: 'Growth Supplements', model: 'Whey Concentrado', line: 'Whey',
    aliases: ['whey growth', 'whey'], ref: null,
    options: [{ name: 'Sabor', values: ['Baunilha', 'Chocolate', 'Morango', 'Cookies'] }],
    specs: [['Tipo', 'Whey protein concentrado em pó'], ['Peso', '1 kg']],
    pkg: [1.2, 25, 18, 8],
    description: 'Whey protein concentrado da Growth Supplements em embalagem de 1 kg, para complementar a ingestão de proteína na dieta.'
  },
  {
    id: 'max-titanium-whey-pro-1kg', cat: SUPL, title: 'Whey Pro Concentrado Max Titanium 1 kg', brand: 'Max Titanium', model: 'Whey Pro', line: 'Whey',
    aliases: ['whey max titanium'], ref: null,
    options: [{ name: 'Sabor', values: ['Morango', 'Chocolate', 'Baunilha'] }],
    specs: [['Tipo', 'Whey protein concentrado em pó'], ['Peso', '1 kg']],
    pkg: [1.2, 25, 18, 8],
    description: 'Whey Pro concentrado da Max Titanium em embalagem de 1 kg, para complementar a proteína da dieta.'
  },
  {
    id: 'integralmedica-creatina-300g', cat: SUPL, title: 'Creatina Integralmédica 300 g', brand: 'Integralmédica', model: 'Creatina 300 g', line: 'Creatina',
    aliases: ['creatina integralmedica'], ref: null,
    options: [],
    specs: [['Tipo', 'Creatina em pó'], ['Peso', '300 g'], ['Sabor', 'Sem sabor']],
    pkg: [0.45, 14, 10, 10],
    description: 'Creatina em pó Integralmédica, sem sabor, em pote de 300 g.'
  },

  // ------------------------------------------------------------ calçados
  {
    id: 'havaianas-top', cat: CALC, title: 'Chinelo Havaianas Top', brand: 'Havaianas', model: 'Top', line: 'Top',
    aliases: ['havaianas', 'chinelo'], ref: null,
    options: [{ name: 'Cor', values: ['Branco', 'Preto', 'Azul-marinho', 'Vermelho'] }, { name: 'Tamanho', values: ['33/34', '35/36', '37/38', '39/40', '41/42', '43/44', '45/46'] }],
    specs: [['Tipo', 'Chinelo de dedo'], ['Material', 'Borracha'], ['Gênero', 'Unissex']],
    pkg: [0.3, 30, 12, 4],
    description: 'Chinelo Havaianas Top, o clássico de borracha em cor única, unissex e confortável para o dia a dia.'
  },
  {
    id: 'havaianas-power-2', cat: CALC, title: 'Chinelo Havaianas Power 2.0 Masculino', brand: 'Havaianas', model: 'Power 2.0', line: 'Power',
    aliases: ['havaianas power'], ref: null,
    options: [{ name: 'Tamanho', values: ['37/38', '39/40', '41/42', '43/44', '45/46'] }],
    specs: [['Tipo', 'Chinelo de dedo'], ['Palmilha', 'Anatômica massageadora'], ['Gênero', 'Masculino']],
    pkg: [0.35, 31, 12, 5],
    description: 'Chinelo Havaianas Power 2.0 masculino com palmilha anatômica massageadora.'
  },
];
