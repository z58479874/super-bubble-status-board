import { pathToFileURL } from 'node:url';
export const {chromium}=process.env.SB_PLAYWRIGHT_PATH
  ? await import(pathToFileURL(process.env.SB_PLAYWRIGHT_PATH).href) : await import('playwright');
export const launchOptions=process.env.SB_BROWSER_PATH?{executablePath:process.env.SB_BROWSER_PATH}:{};
