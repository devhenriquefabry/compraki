// Build `emulator` (npm run start:emulator). Tudo aponta para os emuladores do
// Firebase na máquina local — ver docs/testes-com-emulador.md.
//
// O projeto `demo-vineon` é de propósito: o Firebase trata qualquer ID que
// começa com `demo-` como projeto sem nuvem, então nem por engano uma leitura
// ou escrita daqui chega ao `compraki-mcu` de verdade.

export const environment = {
  production: false,

  firebase: {
    apiKey: 'demo-api-key',
    authDomain: 'demo-vineon.firebaseapp.com',
    databaseURL: 'https://demo-vineon-default-rtdb.firebaseio.com',
    projectId: 'demo-vineon',
    storageBucket: 'demo-vineon.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000000000'
  },

  functionsBaseUrl: 'http://127.0.0.1:5001/demo-vineon/us-central1',

  /** Portas iguais às de `firebase.json` > `emulators`. */
  emulators: {
    host: '127.0.0.1',
    auth: 9099,
    firestore: 8080,
    database: 9000,
    storage: 9199
  },

  mediaCacheEnabled: true,

  /**
   * Chave PUBLICA do Web Push (VAPID). O par privado fica em functions/.env
   * (VAPID_PRIVATE_KEY). Trocar o par invalida as inscricoes dos celulares.
   */
  vapidPublicKey: 'BH-kDfxgw9XaIl3ZLsPlBIYJQjBjM2tSqX69885ckuHb61N2nfgQP9CY303sqgPe2k7bMwYH3C4J3Qg9V0PMZUY',

  botServerUrl: 'http://localhost:3001',
  webhookTesterUrl: 'http://localhost:3000'
};
