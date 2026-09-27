# Catálogo Vineon

Fichas prontas de produtos novos, no molde do catálogo do Mercado Livre. O admin
monta a ficha uma vez (fotos, ficha técnica, opções, medidas); o vendedor acha o
produto, confirma e só informa condição, preço, estoque e entrega.

## Onde fica

| O quê | Arquivo |
| --- | --- |
| Aba **Catálogo** do painel (lista + editor) | `src/app/pages/manage-catalog/` |
| Anunciar em passos (busca → conferir → preço e estoque) | `src/app/pages/upload-product/` (`catalog-finder`, `catalog-confirm`, `upload-product-form`) |
| Leitura, busca e gravação | `src/app/services/catalog.service.ts` |
| Regras sem Firestore (busca, EAN, qualidade, textos) | `src/app/core/catalog.ts` |
| Modelo | `src/app/interfaces/catalog.ts` |

## Dados

- `catalogProducts/{id}` — leitura pública, escrita só de admin (`firestore.rules`).
  `status: 'active' | 'draft'`: rascunho não aparece para o vendedor.
- Fotos em `catalog/` no Storage — leitura pública, escrita só de admin, **nunca
  apagar**: o anúncio copia as URLs.
- O anúncio (`products/{id}`) recebe uma **cópia** de título, categoria, fotos,
  ficha, opções e medidas, mais `catalogId` e `gtin`. Mudar ou excluir a ficha
  depois não altera anúncio já publicado.

## Busca

`keywords` guarda palavras e prefixos (2 a 20 letras) de título, marca, modelo,
linha, "outros nomes", EAN e opções. A busca faz um `array-contains` com a
palavra mais longa digitada e filtra o resto no cliente — sem índice composto.
Só número com 8 a 14 dígitos vira busca por código (`gtins`).

A mesma regra de `keywords` está copiada em `functions/scripts/emulator-seed.mjs`.
Mudou uma, mude a outra.

## Fluxo do vendedor

1. **Produto** — busca por nome/modelo ou código de barras (no Android dá para
   tirar foto do código: `BarcodeDetector`), navega por categoria ou vê os
   destaques. "Criar do zero" leva ao formulário antigo, sem catálogo.
2. **Conferir ficha** — "É este o produto que você vende?", com fotos, opções,
   ficha técnica e quantas lojas já vendem (menor preço com estoque).
3. **Preço e estoque** — título e categoria travados; fotos do catálogo já
   entram (dá para somar fotos próprias); o vendedor marca as opções que tem
   (cor, armazenamento…) e o estoque de cada combinação; ficha fixa + extras
   (garantia, itens inclusos). Publicado, abre a página do anúncio.

`/tabs/upload-product?catalog=<id>` abre direto no passo 2 — é o que o "Vender
um igual" faz na ficha de um anúncio feito pelo catálogo.

## Admin

Editor com seis blocos (identificação, fotos, opções, ficha técnica,
embalagem, descrição/preço de referência), nota de qualidade e prévia de como o
vendedor vê. Para ficar **Ativo** precisa de nome, marca + modelo, categoria
e medidas. Foto não é obrigatória: ficha sem foto exige que o vendedor envie
ao menos uma foto dele ao anunciar. O EAN tem o dígito verificador conferido e avisa se já
está em outra ficha. Duplicar cria rascunho sem EAN.

## Testar no emulador

`npm run emulators:seed` cria 8 fichas (1 rascunho) e um anúncio do Ateliê
ligado ao iPhone 15, para a "concorrência" aparecer:

- admin: `http://localhost:4210/admin/catalog?testUser=admin`
- vendedor: `http://localhost:4210/tabs/upload-product?testUser=vendedor`
  (tente "iphone 15", "airfryer", "galax 256" ou o EAN `0194253890010`)

## Catálogo inicial

`functions/scripts/catalogo-inicial.mjs` tem 66 fichas dos produtos novos mais
vendidos (lista "Mais vendidos" do Mercado Livre em 27/09/2026 + campeões de
cada categoria), com ficha técnica conferida em fontes do fabricante. Vão
**sem fotos** (imagem de anúncio tem dono) e com medidas de embalagem
**estimadas**. Importar:

```bash
node functions/scripts/catalog-import.mjs --emulator
node functions/scripts/catalog-import.mjs --prod --dry-run
node functions/scripts/catalog-import.mjs --prod
```

Só cria o que não existe (mesmo id), então rodar de novo não apaga edição do admin.

## Imagens ilustrativas

Ficha sem foto oficial mostra uma **imagem ilustrativa** própria da Vineon
(28 desenhos por tipo de produto, fundo branco, com a legenda "Imagem
ilustrativa") em `src/assets/catalogo/ilustracoes/`. O desenho vem do nome e
da subcategoria (`core/catalog-illustrations.ts`). No anúncio ela entra como
capa com o selo "Ilustrativa" e um aviso para trocar pela foto real; quando o
vendedor envia fotos, a ilustrativa sai sozinha. Publicar só com ela é
permitido. Para mudar ou criar desenhos: `functions/scripts/catalog-illustrations.mjs`.
