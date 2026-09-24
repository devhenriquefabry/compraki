// Este arquivo é substituído no build de produção pelo `environment.prod.ts`
// (ver `fileReplacements` em angular.json).
//
// REGRA: nada de segredo aqui. Tudo em `src/` vai para o bundle que o
// navegador baixa. A config do Firebase abaixo é pública por design — quem
// protege os dados são as regras do Firestore e o App Check, não ela.
// Chave de API de gateway, token de webhook e credencial de integração ficam
// em `functions/.env` e só são usados pelas Cloud Functions.

export const environment = {
  production: false,

  firebase: {
    apiKey: "AIzaSyBD5AH1b1_p6AghhPx3Nr0fBVab8djRbkI",
    authDomain: "compraki-mcu.firebaseapp.com",
    databaseURL: "https://compraki-mcu-default-rtdb.firebaseio.com",
    projectId: "compraki-mcu",
    storageBucket: "compraki-mcu.firebasestorage.app",
    messagingSenderId: "2028715763",
    appId: "1:2028715763:web:5507a8b12473bfc6e50186",
    measurementId: "G-92Q7R0CQR0"
  },

  /** Base das Cloud Functions HTTP. No build `emulator` aponta para o emulador local. */
  functionsBaseUrl: 'https://us-central1-compraki-mcu.cloudfunctions.net',

  /**
   * Liga/desliga o cache robusto de mídias do WhatsApp (Storage + Firestore + IndexedDB).
   * Em release seguinte, removeremos o fallback `dataUrl` e este flag vira default.
   */
  mediaCacheEnabled: true,

  /**
   * Serviços auxiliares que rodam fora do Firebase.
   * Estavam com `localhost` fixo dentro do código do app — em produção isso
   * falha silenciosamente. Agora vêm daqui e o build de produção os desliga.
   */
  botServerUrl: 'http://localhost:3001',
  webhookTesterUrl: 'http://localhost:3000'
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
