/**
 * Processo utilitário de indexação de PDFs (PDF.js no Node), fora do processo principal para
 * não travar as janelas. Recebe pedidos por `process.parentPort` e responde com o índice.
 */
import { runIndexerWorker } from '../services/library-worker'

runIndexerWorker()
