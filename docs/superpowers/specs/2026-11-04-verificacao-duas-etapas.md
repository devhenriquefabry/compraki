# Verificação em duas etapas (opcional, por e-mail)

Decidido com o Henrique em 2026-11-04: é opcional, o segundo fator é um código por
e-mail, e quem perde o acesso ao e-mail fala com o suporte. No mesmo dia os códigos de
recuperação saíram: o código chega no e-mail em qualquer aparelho, e guardar uma lista
era um passo a mais para um caso raro.

## Por que não é só uma tela

O Firebase Auth entrega o token já na senha. O MFA nativo só existe para app
autenticador/SMS, com upgrade para Identity Platform; para e-mail, uma tela de código
sozinha não protege, porque quem tem a senha chama a API direto. Por isso a exigência
mora no servidor, por **sessão**:

- Custom claims `tfa: true` e `tfaSessions: number[]` (os `auth_time` já confirmados,
  no máximo 10). Login novo gera `auth_time` novo, que não está na lista.
- Sessão pendente = `tfa == true` e `auth_time` fora de `tfaSessions`.
- `isSignedIn()` (Firestore e Storage) e `requireAuthenticated` (functions) recusam
  sessão pendente. O que é público continua público.

## Fluxos

Tudo na function única `twoFactor` (`{ action }`), para não criar vários serviços no
Cloud Run. Estado em `twoFactor/{uid}`, sem regra de leitura (só Admin SDK).

- **Ativar**: `requestCode(enable)` → `enable`. O e-mail de destino fica gravado no
  documento: mudar o e-mail no Auth com a senha roubada não desvia o código.
- **Entrar**: senha ou Google → `/two-factor` → `requestCode(login)` → `verifyLogin`
  → `auth_time` entra na lista → recarrega a página (os listeners do Firestore que
  morreram com permission-denied voltam).
- **Sem acesso ao e-mail**: a tela do código leva ao atendimento, que confirma quem é e
  usa `adminReset` em Gerenciar usuários, com motivo e registro em `twoFactorEvents`.
- **Reautenticar** (trocar senha, excluir conta) gera `auth_time` novo. O cliente guarda
  o token anterior, já confirmado, e `rebindSession` carrega a confirmação para a sessão
  nova, sem pedir código de novo.

## Limites conhecidos

- Com a senha, ainda dá para falar direto com o Auth (trocar senha, apagar o login).
  Não dá para ler nem mexer em dado nenhum, mas o bloqueio total disso exigiria
  Identity Platform + blocking functions.
- Realtime Database (`status/{uid}`, presença) não é coberto: é só online/offline.
- Código por e-mail protege contra senha vazada, não contra e-mail invadido.
