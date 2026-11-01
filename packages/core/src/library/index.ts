export type {
  PdfMetadata,
  PdfOutlineItem,
  PdfPageText,
  PdfTextLine,
  PdfTextSource,
  RecognizedLine,
} from './text-source'
export { cachedPdfTextSource, joinRecognizedLines, pageTextFromLines } from './text-source'

export type {
  PdfLibraryMetadataOverrides,
  PdfLibraryOcrResult,
  PdfLibraryRecord,
  PdfSectionComponent,
  PdfSectionComponentKind,
  PdfSectionFindingMethod,
  PdfSectionLocation,
  PdfTextPosition,
  PdfTextSpan,
} from './model'
export {
  PDF_SECTION_COMPONENT_KINDS,
  PDF_SECTION_FINDING_METHODS,
  SWIFT_REFERENCE_DATE_OFFSET_SECONDS,
  dateFromSwiftDate,
  swiftDateFromDate,
} from './model'

export type { PdfSectionLocationInit } from './section'
export {
  activeSectionForPage,
  componentId,
  confidenceLabel,
  findingMethodLabel,
  hasHighConfidence,
  makeSectionLocation,
  normalizeSectionQuery,
  sectionId,
  sectionMatchesSearch,
} from './section'

export {
  compareLibraryRecords,
  metadataOverridesFromRecord,
  preservingMetadata,
  recordDisplayAuthor,
  recordDisplayCredits,
  recordDisplayEdition,
  recordDisplayLanguage,
  recordDisplayPublisher,
  recordDisplayTitle,
  recordDisplayVolume,
  recordDisplayYear,
} from './record'

export {
  authorsFromPdfMetadata,
  cleanPdfFilename,
  copyLabelFromFilename,
  filenameFromPath,
  isFeastingTitle,
  titleFromPdfMetadata,
} from './metadata'

export type { PdfSectionMatchKind } from './matching'
export {
  PDF_SECTION_MATCH_ORDER,
  matchSection,
  matchingSectionCount,
  referencesEqual,
  sameIndexedReference,
  sectionReferences,
} from './matching'

export type { PageHeadingCandidate, ScanHeadingsOptions } from './headings'
export {
  FEASTING_OCR_HEADING_LINE_LIMIT,
  HEADING_LINE_LIMIT,
  countBookmarks,
  flattenOutline,
  isReferenceHeading,
  pageHeadingCandidates,
  scanHeadings,
} from './headings'

export {
  BIBLICAL_TEXT_COMPONENT_TITLE,
  FEASTING_PERSPECTIVES,
  authorSignature,
  enrichFeastingSections,
  feastingComponents,
} from './feasting'

export type {
  IndexPdfOptions,
  LibraryMigration,
  PdfFileInfo,
  RecognizeScannedPagesOptions,
  SectionsForDocumentOptions,
} from './indexer'
export {
  OCR_CANCELLED_NOTICE,
  PDF_LIBRARY_INDEX_VERSION,
  backfillBookmarkMethod,
  extractSpanText,
  indexPdf,
  mergeOcrSections,
  migrateLibraryRecords,
  ocrResultNotice,
  recognizeScannedPages,
  requiresReindex,
  reviewPageText,
  sectionsForDocument,
} from './indexer'

export {
  decodeLibraryRecord,
  decodeLibraryRecords,
  decodeSectionLocation,
  encodeLibraryRecord,
  encodeLibraryRecords,
  encodeSectionLocation,
} from './codec'

export type {
  ExtractPdfReviewSourcesOptions,
  ReviewMaterialSource,
  ReviewTabInput,
  SermonReviewMaterialErrorCode,
  WebReviewPage,
} from './review'
export {
  REVIEW_MAX_BYTES_PER_SOURCE,
  REVIEW_MAX_PAGES_PER_SOURCE,
  SermonReviewMaterialError,
  extractPdfReviewSources,
  makeWebReviewSource,
  webReviewCitation,
} from './review'
