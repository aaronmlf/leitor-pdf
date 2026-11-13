import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.leitor.app',
  appName: 'Leitor',
  webDir: 'dist',
  android: {
    // Ícone e splash ficam nos recursos nativos; WebView usa https://localhost.
    allowMixedContent: false,
  },
};

export default config;
