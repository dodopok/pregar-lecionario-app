export type { ReaderArchive, ReaderPdfPosition, ReaderTab, ReaderTabKind, ReaderWebPosition } from './model'
export {
  READER_CLOSED_TAB_LIMIT,
  READER_WEB_POSITION_LIMIT,
  countTabsMarkedForReview,
  isTabIncludedForReview,
  isValidPdfPosition,
  isValidWebPosition,
} from './model'

export {
  decodeReaderArchive,
  decodeReaderTab,
  decodeRememberedPages,
  encodeReaderArchive,
  encodeReaderTab,
} from './codec'

export type { LinkGesture } from './web'
export {
  INVALID_WEB_ADDRESS_MESSAGE,
  isWebScheme,
  linkOpensNewTab,
  printedPageLabel,
  readerTabWidth,
  readerWebUrl,
  urlHost,
  urlScheme,
  urlWithoutFragment,
} from './web'

export type { OpenPdfTabOptions, OpenWebTabOptions, ReaderOpenResult, ReaderState } from './state'
export {
  GENERAL_RESEARCH_CONTEXT_KEY,
  GENERAL_RESEARCH_LABEL,
  activateReaderSermon,
  beginPdfOpen,
  canReopenClosedTab,
  closeOtherReaderTabs,
  closeReaderTab,
  createReaderState,
  duplicateReaderTab,
  isPdfLocationOpen,
  materialsMarkedForReview,
  moveReaderTab,
  newReaderID,
  openLinkTab,
  openPdfPageInNewTab,
  openPdfTab,
  openWebTab,
  readerArchiveFromState,
  readerContextKey,
  readerContextLabel,
  readerContextTitle,
  readerStateFromArchive,
  recordPdfTabPage,
  recordPdfTabPosition,
  recordWebTabPosition,
  rememberSectionLink,
  reopenClosedReaderTab,
  savedSermonDates,
  sectionLinkKey,
  selectReaderTab,
  selectRelativeReaderTab,
  selectedReaderTab,
  setPdfTabPage,
  setReaderActiveReference,
  setTabReviewInclusion,
  updateWebTabLocation,
  updateWebTabTitle,
  visibleReaderTabs,
} from './state'

// Seções do PDF (definidas com o índice da Biblioteca) também fazem parte do modelo do Leitor.
export type { PdfSectionLocation } from '../library/model'
export {
  activeSectionForPage,
  confidenceLabel,
  findingMethodLabel,
  hasHighConfidence,
  makeSectionLocation,
  normalizeSectionQuery,
  sectionId,
  sectionMatchesSearch,
} from '../library/section'
