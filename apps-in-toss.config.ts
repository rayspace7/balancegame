import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'balancegame',
  brand: {
    primaryColor: '#4A5FE8',
  },
  permissions: [],
  navigationBar: {
    withBackButton: true,
    withHomeButton: false,
    withTitle: false,
    transparentBackground: false,
    theme: 'light',
  },
  webBundleDir: 'dist',
});
