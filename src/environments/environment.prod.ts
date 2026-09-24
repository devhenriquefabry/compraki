// Build de produção. Ver a nota sobre segredos em `environment.ts`.

export const environment = {
  production: true,

  firebase: {
    apiKey: "AIzaSyBD5AH1b1_p6AghhPx3Nr0fBVab8djRbkI",
    // Dominio proprio: o popup do Google mostra "Prosseguir para
    // www.vineonsite.com.br". Funciona porque o server.mjs faz proxy de
    // /__/auth/* para compraki-mcu.firebaseapp.com. O dev (environment.ts)
    // continua no firebaseapp.com, ja que o `ng serve` nao tem esse proxy.
    authDomain: "www.vineonsite.com.br",
    databaseURL: "https://compraki-mcu-default-rtdb.firebaseio.com",
    projectId: "compraki-mcu",
    storageBucket: "compraki-mcu.firebasestorage.app",
    messagingSenderId: "2028715763",
    appId: "1:2028715763:web:5507a8b12473bfc6e50186",
    measurementId: "G-92Q7R0CQR0"
  },

  functionsBaseUrl: 'https://us-central1-compraki-mcu.cloudfunctions.net',

  mediaCacheEnabled: true,

  /**
   * Vazio em produção de propósito: o bot-server e o receptor de webhook de
   * teste rodam na máquina do desenvolvedor. Os serviços que dependem deles
   * tratam string vazia como "indisponível" em vez de tentar `localhost`.
   */
  botServerUrl: '',
  webhookTesterUrl: ''
};
