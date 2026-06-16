import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.berndgansbacher.pharmatrack',
  appName: 'PharmaTrack',
  webDir: 'dist',
  ios: {
    // openFDA is served over HTTPS; no localhost backend is required.
    contentInset: 'always',
  },
};

export default config;
