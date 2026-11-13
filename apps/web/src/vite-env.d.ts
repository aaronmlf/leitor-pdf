/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'tesseract.js/dist/tesseract.esm.min.js' {
  const tesseract: typeof import('tesseract.js')
  export default tesseract
}
