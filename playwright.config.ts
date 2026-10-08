import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
 testDir:'tests/browser',testMatch:'**/*.pw.ts',timeout:30000,fullyParallel:true,
 use:{baseURL:'http://127.0.0.1:4100',trace:'retain-on-failure'},
 projects:[{name:'mobile-chromium',use:{...devices['Pixel 5']}},{name:'mobile-webkit',use:{...devices['iPhone 13']}}],
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4100',url:'http://127.0.0.1:4100',reuseExistingServer:false,
  env:{VITE_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54329',VITE_PUBLIC_SUPABASE_ANON_KEY:'synthetic-public-key'}},
});
