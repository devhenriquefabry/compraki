import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.ionic.starter',
  appName: 'Compraki',
  webDir: 'www/browser',
  plugins: {
    GoogleAuth: {
      scopes: ["profile", "email"],
      serverClientId: "COLOQUE_SEU_WEB_CLIENT_ID_AQUI.apps.googleusercontent.com",
      forceCodeForRefreshToken: true
    }
  }
};

export default config;
