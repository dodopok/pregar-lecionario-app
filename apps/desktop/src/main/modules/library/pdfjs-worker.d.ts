/** O módulo do worker do PDF.js não traz tipos; só o manipulador é usado. */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
