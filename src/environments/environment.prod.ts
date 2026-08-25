// Build de produção. Ver a nota sobre segredos em `environment.ts`.

export const environment = {
  production: true,

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

  mediaCacheEnabled: true,

  /**
   * Vazio em produção de propósito: o bot-server e o receptor de webhook de
   * teste rodam na máquina do desenvolvedor. Os serviços que dependem deles
   * tratam string vazia como "indisponível" em vez de tentar `localhost`.
   */
  botServerUrl: '',
  webhookTesterUrl: ''
};
