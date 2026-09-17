import { Category, Subcategory } from '../interfaces/category';

/**
 * Conjunto sugerido de categorias, no molde do Mercado Livre — ajustado para
 * o tamanho do nosso catálogo (menos subcategorias que o ML, o vendedor
 * completa o resto pela própria tela de "Gerenciar Categorias").
 *
 * `id` é o slug fixo da categoria: `FirebaseCategories.seedDefaults()` grava
 * com `setDoc(..., { merge: true })` nesse id, então rodar de novo nunca cria
 * duplicata — só preenche o que ainda está vazio.
 *
 * `cat_eletronicos`, `cat_casa` e `cat_moda` já existem no banco (criadas à
 * mão antes deste seed, e já usadas por produtos publicados) — por isso os
 * ids batem com os que já estão lá; a importação só completa ícone e
 * subcategorias sem trocar o `id` de nenhuma, então nenhum anúncio existente
 * perde a categoria. O `id` continua com o nome antigo mesmo quando a
 * categoria é renomeada (ex.: `cat_eletronicos` → "Tecnologia") — é só um
 * slug interno, nunca aparece pro comprador.
 */

function sub(categoryId: string, slug: string, name: string): Subcategory {
  return { id: `${categoryId}-${slug}`, name };
}

export interface DefaultCategory extends Category {
  /**
   * Nome anterior desta categoria, só quando a importação está RENOMEANDO
   * algo que já existe (ex.: "Casa e Decoração" → "Casa e Móveis"). A tela
   * mostra essa troca antes de aplicar; sem isto o nome atual é preservado.
   */
  renameFrom?: string;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    // A categoria mais procurada do ML: fica em primeiro na lista de propósito.
    id: 'cat_eletronicos',
    name: 'Tecnologia',
    renameFrom: 'Eletrônicos',
    icon: 'phone-portrait-outline',
    subcategories: [
      sub('cat_eletronicos', 'celulares', 'Celulares e Telefones'),
      sub('cat_eletronicos', 'informatica', 'Informática'),
      sub('cat_eletronicos', 'televisores', 'Televisores'),
      sub('cat_eletronicos', 'audio-video', 'Eletrônicos, Áudio e Vídeo'),
      sub('cat_eletronicos', 'games', 'Games e Consoles'),
      sub('cat_eletronicos', 'cameras', 'Câmeras e Acessórios'),
      sub('cat_eletronicos', 'acessorios', 'Acessórios e Cabos'),
    ],
  },
  {
    id: 'cat_casa',
    name: 'Casa e Móveis',
    renameFrom: 'Casa e Decoração',
    icon: 'bed-outline',
    subcategories: [
      sub('cat_casa', 'moveis', 'Móveis'),
      sub('cat_casa', 'decoracao', 'Decoração'),
      sub('cat_casa', 'cama-mesa-banho', 'Cama, Mesa e Banho'),
      sub('cat_casa', 'cozinha', 'Cozinha e Utilidades'),
      sub('cat_casa', 'iluminacao', 'Iluminação'),
      sub('cat_casa', 'organizacao', 'Organização'),
      sub('cat_casa', 'jardim', 'Jardim e Área Externa'),
    ],
  },
  {
    id: 'cat_eletrodomesticos',
    name: 'Eletrodomésticos',
    icon: 'home-outline',
    subcategories: [
      sub('cat_eletrodomesticos', 'cozinha', 'Fogão, Forno e Micro-ondas'),
      sub('cat_eletrodomesticos', 'geladeira', 'Geladeira e Freezer'),
      sub('cat_eletrodomesticos', 'lavanderia', 'Lavadora e Secadora'),
      sub('cat_eletrodomesticos', 'climatizacao', 'Ventilador e Ar-condicionado'),
      sub('cat_eletrodomesticos', 'pequenos', 'Pequenos Eletrodomésticos'),
      sub('cat_eletrodomesticos', 'aspiradores', 'Aspiradores e Limpeza'),
    ],
  },
  {
    id: 'cat_moda',
    name: 'Moda',
    icon: 'shirt-outline',
    subcategories: [
      sub('cat_moda', 'feminina', 'Roupas Femininas'),
      sub('cat_moda', 'masculina', 'Roupas Masculinas'),
      sub('cat_moda', 'calcados', 'Calçados'),
      sub('cat_moda', 'bolsas', 'Bolsas e Acessórios'),
      sub('cat_moda', 'relogios-joias', 'Relógios e Joias'),
      sub('cat_moda', 'infantil', 'Moda Infantil'),
    ],
  },
  {
    id: 'cat_beleza',
    name: 'Beleza e Cuidado Pessoal',
    icon: 'brush-outline',
    subcategories: [
      sub('cat_beleza', 'maquiagem', 'Maquiagem'),
      sub('cat_beleza', 'perfumaria', 'Perfumaria'),
      sub('cat_beleza', 'cabelos', 'Cuidados com Cabelo'),
      sub('cat_beleza', 'pele', 'Cuidados com a Pele'),
      sub('cat_beleza', 'barbearia', 'Barbearia'),
    ],
  },
  {
    id: 'cat_supermercado',
    name: 'Supermercado',
    icon: 'fast-food-outline',
    subcategories: [
      sub('cat_supermercado', 'mercearia', 'Alimentos e Bebidas'),
      sub('cat_supermercado', 'limpeza', 'Limpeza'),
      sub('cat_supermercado', 'higiene', 'Higiene Pessoal'),
      sub('cat_supermercado', 'hortifruti', 'Hortifruti'),
      sub('cat_supermercado', 'padaria', 'Padaria e Laticínios'),
      sub('cat_supermercado', 'bebidas-alcoolicas', 'Bebidas Alcoólicas'),
    ],
  },
  {
    id: 'cat_saude',
    name: 'Saúde',
    icon: 'nutrition-outline',
    subcategories: [
      sub('cat_saude', 'medicamentos', 'Medicamentos e Farmácia'),
      sub('cat_saude', 'suplementos', 'Suplementos e Vitaminas'),
      sub('cat_saude', 'ortopedicos', 'Equipamentos Ortopédicos'),
      sub('cat_saude', 'primeiros-socorros', 'Primeiros Socorros'),
      sub('cat_saude', 'bem-estar', 'Bem-estar'),
    ],
  },
  {
    id: 'cat_esportes',
    name: 'Esportes e Fitness',
    icon: 'basketball-outline',
    subcategories: [
      sub('cat_esportes', 'musculacao', 'Musculação'),
      sub('cat_esportes', 'ciclismo', 'Ciclismo'),
      sub('cat_esportes', 'futebol', 'Futebol'),
      sub('cat_esportes', 'roupas-esportivas', 'Roupas Esportivas'),
      sub('cat_esportes', 'ar-livre', 'Camping e Ar Livre'),
    ],
  },
  {
    id: 'cat_brinquedos',
    name: 'Brinquedos e Games',
    icon: 'game-controller-outline',
    subcategories: [
      sub('cat_brinquedos', 'bonecas-bonecos', 'Bonecas e Bonecos'),
      sub('cat_brinquedos', 'jogos-tabuleiro', 'Jogos de Tabuleiro'),
      sub('cat_brinquedos', 'educativos', 'Brinquedos Educativos'),
      sub('cat_brinquedos', 'videogames', 'Videogames'),
      sub('cat_brinquedos', 'ar-livre', 'Brinquedos para Ar Livre'),
    ],
  },
  {
    id: 'cat_bebes',
    name: 'Bebês e Infantil',
    icon: 'gift-outline',
    subcategories: [
      sub('cat_bebes', 'enxoval', 'Enxoval'),
      sub('cat_bebes', 'passeio', 'Carrinhos e Bebê Conforto'),
      sub('cat_bebes', 'alimentacao', 'Alimentação Infantil'),
      sub('cat_bebes', 'fraldas-higiene', 'Fraldas e Higiene'),
      sub('cat_bebes', 'quarto-bebe', 'Quarto de Bebê'),
    ],
  },
  {
    id: 'cat_petshop',
    name: 'Pet Shop',
    icon: 'paw-outline',
    subcategories: [
      sub('cat_petshop', 'racao', 'Ração'),
      sub('cat_petshop', 'brinquedos-pet', 'Brinquedos para Pets'),
      sub('cat_petshop', 'higiene-pet', 'Higiene e Cuidados'),
      sub('cat_petshop', 'acessorios-pet', 'Coleiras e Acessórios'),
      sub('cat_petshop', 'aquarismo', 'Aquarismo'),
    ],
  },
  {
    id: 'cat_ferramentas',
    name: 'Ferramentas e Construção',
    icon: 'build-outline',
    subcategories: [
      sub('cat_ferramentas', 'ferramentas-eletricas', 'Ferramentas Elétricas'),
      sub('cat_ferramentas', 'ferramentas-manuais', 'Ferramentas Manuais'),
      sub('cat_ferramentas', 'materiais-construcao', 'Materiais de Construção'),
      sub('cat_ferramentas', 'tintas', 'Tintas e Acessórios'),
      sub('cat_ferramentas', 'seguranca-eletrica', 'Elétrica e Segurança'),
    ],
  },
  {
    id: 'cat_veiculos',
    name: 'Veículos e Acessórios',
    icon: 'car-outline',
    subcategories: [
      sub('cat_veiculos', 'pecas-acessorios', 'Peças e Acessórios'),
      sub('cat_veiculos', 'som-multimidia', 'Som e Multimídia'),
      sub('cat_veiculos', 'pneus-rodas', 'Pneus e Rodas'),
      sub('cat_veiculos', 'motos', 'Motos e Acessórios'),
      sub('cat_veiculos', 'ferramentas-automotivas', 'Ferramentas Automotivas'),
    ],
  },
  {
    id: 'cat_negocios',
    name: 'Para seu Negócio',
    icon: 'briefcase-outline',
    subcategories: [
      sub('cat_negocios', 'escritorio', 'Escritório e Papelaria'),
      sub('cat_negocios', 'embalagens', 'Embalagens'),
      sub('cat_negocios', 'equipamentos-comerciais', 'Equipamentos Comerciais'),
      sub('cat_negocios', 'uniformes', 'Uniformes e EPIs'),
      sub('cat_negocios', 'tecnologia-negocio', 'Tecnologia para o Negócio'),
    ],
  },
];
