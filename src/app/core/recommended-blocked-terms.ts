/**
 * Lista recomendada de produtos não aceitos, carregada pelo admin em
 * Ajustes → Produtos não aceitos (`Adicionar lista recomendada`).
 *
 * Não existe lista pronta em formato de dados para o Brasil: os marketplaces só
 * publicam políticas por categoria. Esta foi montada a partir dessas categorias
 * e da lei brasileira (ver docs/moderacao-pedidos-frete.md). Entra no documento
 * `appConfig/storefront` como termos comuns: o admin libera qualquer um deles.
 *
 * Cuidados ao mexer:
 * - palavra sozinha só quando ela não tem outro uso no comércio: "pistola" pega
 *   pistola de cola, "cartucho" pega tinta, "heroína" pega boneca de heroína,
 *   "pirata" pega fantasia. Nesses casos, frase ("pistola 9mm");
 * - cada entrada nova deve passar em functions/scripts/product-rules.test.mjs
 *   e ser conferida contra o catálogo real antes de publicar: mudar a lista
 *   tira do ar, sozinho, o que combinar.
 *
 * Fica fora do bundle inicial: só a tela de Ajustes importa este arquivo.
 */
export const RECOMMENDED_BLOCKED_TERMS: readonly string[] = [
  // Armas de fogo, munição e explosivos (Lei 10.826/2003, art. 26 proíbe simulacros)
  'arma de fogo', 'arma de verdade', 'arma real', 'simulacro de arma', 'replica de arma',
  'ak47', 'ar15', 'ar10', 'm4a1', 'mp40', 'mp5k', 'g36c', 'glock', 'uzi', 'fuzil', 'metralhadora', 'submetralhadora',
  'revolver 38', 'revolver 357', 'revolver calibre', 'pistola 380', 'pistola 9mm', 'pistola 40', 'pistola calibre', 'pistola taurus',
  'espingarda calibre', 'espingarda 12', 'carabina calibre', 'calibre 12', 'calibre 22', 'calibre 38', 'calibre 380', 'calibre 40', 'calibre 44',
  'municao', 'polvora', 'silenciador de arma', 'silenciador de pistola', 'supressor de arma', 'carregador de pistola', 'carregador de fuzil',
  'explosivo', 'dinamite', 'bomba caseira', 'coquetel molotov', 'granada de mao', 'detonador', 'estopim',
  'taser', 'arma de choque', 'soco ingles', 'soqueira', 'spray de pimenta', 'gas lacrimogeneo', 'colete balistico', 'colete a prova de bala',

  // Drogas e substâncias controladas (Lei 11.343/2006, Portaria SVS/MS 344/98)
  'cocaina', 'crack', 'maconha', 'semente de maconha', 'cannabis', 'haxixe', 'skunk', 'lsd', 'ecstasy', 'mdma',
  'metanfetamina', 'anfetamina', 'ketamina', 'cetamina', 'lanca perfume', 'cheirinho da lolo', 'fentanil', 'morfina',

  // Medicamentos (venda exige farmácia autorizada e, nestes casos, receita)
  'medicamento controlado', 'remedio controlado', 'tarja preta', 'receituario', 'receita medica', 'atestado medico',
  'ozempic', 'wegovy', 'mounjaro', 'saxenda', 'tirzepatida', 'semaglutida', 'liraglutida', 'sibutramina',
  'rivotril', 'clonazepam', 'diazepam', 'alprazolam', 'zolpidem', 'ritalina', 'metilfenidato', 'venvanse', 'tramadol', 'oxicodona',
  'roacutan', 'isotretinoina', 'cytotec', 'misoprostol', 'abortivo', 'sildenafila', 'tadalafila',
  'anabolizante', 'esteroide', 'durateston', 'deposteron', 'dianabol', 'oxandrolona', 'stanozolol', 'trembolona', 'testosterona injetavel',
  'hormonio do crescimento', 'botox', 'toxina botulinica',

  // Cigarro eletrônico e nicotina (Anvisa RDC 855/2024)
  'vape', 'vaper', 'pod descartavel', 'cigarro eletronico', 'elf bar', 'elfbar', 'ignite v', 'juul', 'snus', 'sache de nicotina', 'cigarro contrabandeado',

  // Falsificação e pirataria (Lei 9.279/96)
  'falsificad*', 'replica primeira linha', 'replica premium', 'replica perfeita', 'replica aaa', 'pirateado', 'pirateada', 'copia pirata', 'jogo pirata',
  'iptv', 'tv box pirata', 'tv box desbloqueada', 'gatonet', 'desbloqueio de canais',

  // Fraude e documentos
  'cartao clonado', 'dados de cartao', 'gerador de cartao', 'dinheiro falso', 'nota falsa', 'cedula falsa', 'moeda falsa', 'boleto falso',
  'rg falso', 'cpf falso', 'cnh falsa', 'cnh sem exame', 'carteira de motorista falsa', 'documento falso', 'diploma falso', 'certificado falso', 'receita falsa',
  'conta laranja', 'conta bancaria laranja', 'lista de cpf', 'base de cpf', 'painel de consulta',

  // Telecom sem homologação e equipamento de bloqueio (Anatel)
  'bloqueador de sinal', 'jammer',

  // Animais e fauna (Lei 9.605/98)
  'animal vivo', 'animal silvestre', 'ave silvestre', 'filhote de papagaio', 'filhote de arara', 'filhote de macaco', 'filhote de jabuti',
  'marfim', 'pele de onca', 'casco de tartaruga',

  // Corpo humano (Lei 9.434/97)
  'orgao humano', 'rim humano', 'sangue humano', 'cranio humano', 'ossada humana',

  // Produtos perigosos
  'fogos de artificio', 'rojao', 'morteiro', 'alcool 92', 'alcool 96', 'formol', 'metanol', 'cloroformio', 'agrotoxico',

  // Crime e ódio
  'pedofilia', 'pornografia infantil', 'suastica', 'bandeira nazista', 'simbolo nazista', 'uniforme nazista',
  'farda da policia', 'distintivo de policia',
];
