import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.ionic.starter',
  appName: 'Compraki',
  webDir: 'www/browser',
  plugins: {
    GoogleAuth: {
      scopes: ["profile", "email"],
      serverClientId: "2028715763-p879a7gv1u0u3in5n0t5k3f87r5i7sib.apps.googleusercontent.com",
      forceCodeForRefreshToken: true
    }
  }
};

export default config;
