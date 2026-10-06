/**
 * "Baixar meus dados" (tela Privacidade e dados): junta num JSON tudo o que a
 * conta lê sobre si mesma no Firestore. Atende ao acesso e à portabilidade da
 * LGPD (art. 18, II e V) sem passar por servidor — cada leitura usa as mesmas
 * regras que o app já usa, então só sai o que é do próprio dono.
 *
 * Fica de fora o que não é dado desta pessoa: vendas (são pedidos de outros
 * compradores) e avaliações (públicas, aparecem na página do produto).
 */

import { getApp } from 'firebase/app';
import { User } from 'firebase/auth';
import {
  DocumentData, Firestore, QuerySnapshot, Timestamp, collection, doc, getCountFromServer, getDoc, getDocs, getFirestore,
  query, where,
} from 'firebase/firestore';

/**
 * Contagens do painel "O que a Vineon guarda sobre você". `null` = aquela
 * leitura falhou; a tela avisa naquele item em vez de mostrar zero.
 */
export interface PrivacyCounts {
  addresses: number | null;
  orders: number | null;
  chats: number | null;
  saved: number | null;
}

const db = (): Firestore => getFirestore(getApp());

export async function countMyData(uid: string): Promise<PrivacyCounts> {
  const count = (q: Parameters<typeof getCountFromServer>[0]) =>
    getCountFromServer(q).then(snap => snap.data().count, err => {
      console.error('Privacidade: falha ao contar', err);
      return null;
    });
  const [addresses, orders, chats, saved] = await Promise.all([
    count(collection(db(), 'users', uid, 'addresses')),
    count(query(collection(db(), 'orders'), where('userId', '==', uid))),
    count(query(collection(db(), 'chats'), where('participantIds', 'array-contains', uid))),
    count(collection(db(), 'users', uid, 'savedProducts')),
  ]);
  return { addresses, orders, chats, saved };
}

export async function buildMyDataExport(user: User): Promise<Record<string, unknown>> {
  const uid = user.uid;
  const sub = (name: string) => settle(getDocs(collection(db(), 'users', uid, name)).then(rows));

  const [profile, addresses, cart, saved, following, notifications, orders, chats, tickets] = await Promise.all([
    settle(getDoc(doc(db(), 'users', uid)).then(snap => (snap.exists() ? plain(snap.data()) : null))),
    sub('addresses'),
    sub('cart'),
    sub('savedProducts'),
    sub('followingSellers'),
    sub('notifications'),
    settle(getDocs(query(collection(db(), 'orders'), where('userId', '==', uid))).then(rows)),
    settle(getDocs(query(collection(db(), 'chats'), where('participantIds', 'array-contains', uid))).then(snap =>
      Promise.all(snap.docs.map(async chat => ({
        id: chat.id,
        ...(plain(chat.data()) as object),
        messages: await getDocs(collection(db(), 'chats', chat.id, 'messages')).then(rows),
      }))),
    )),
    // Atendimentos (Fale com a Vineon): o que a pessoa e a Vineon escreveram. Notas internas da equipe não saem.
    settle(getDocs(query(collection(db(), 'supportTickets'), where('userId', '==', uid))).then(snap =>
      Promise.all(snap.docs.map(async ticket => ({
        id: ticket.id,
        ...(plain(ticket.data()) as object),
        mensagens: await getDocs(collection(db(), 'supportTickets', ticket.id, 'replies')).then(rows),
      }))),
    )),
  ]);

  if ([profile, addresses, cart, saved, following, notifications, orders, chats, tickets].every(part => isFailure(part))) {
    throw new Error('Nenhuma parte dos dados pôde ser lida.');
  }

  return {
    geradoEm: new Date().toISOString(),
    sobre: 'Cópia dos dados da sua conta na Vineon (LGPD, art. 18). Senha e dados de cartão não ficam com a Vineon e por isso não aparecem aqui.',
    conta: {
      uid,
      email: user.email,
      emailVerificado: user.emailVerified,
      criadaEm: user.metadata.creationTime ?? null,
      ultimoAcesso: user.metadata.lastSignInTime ?? null,
      formasDeEntrar: user.providerData.map(p => p.providerId),
    },
    cadastro: profile,
    enderecos: addresses,
    pedidos: orders,
    carrinho: cart,
    favoritos: saved,
    lojasQueSegue: following,
    conversas: chats,
    atendimentos: tickets,
    avisos: notifications,
  };
}

/** Entrega o JSON como arquivo `vineon-meus-dados-AAAA-MM-DD.json`. */
export function downloadJson(data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `vineon-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const FAILED = { erro: 'Não foi possível ler esta parte agora. Tente baixar de novo mais tarde.' };

/** Uma parte que falha vira um aviso no arquivo, sem derrubar o resto. */
function settle<T>(read: Promise<T>): Promise<T | typeof FAILED> {
  return read.catch(err => {
    console.error('Privacidade: falha ao exportar parte dos dados', err);
    return FAILED;
  });
}

function isFailure(part: unknown): boolean {
  return part === FAILED;
}

function rows(snap: QuerySnapshot<DocumentData>): unknown[] {
  return snap.docs.map(d => ({ id: d.id, ...(plain(d.data()) as object) }));
}

/** Timestamp do Firestore vira data ISO; o resto passa como está. */
function plain(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}
