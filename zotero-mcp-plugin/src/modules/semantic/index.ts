/**
 * Semantic Search Module
 *
 * Exports all semantic search components for use in the Zotero MCP Plugin.
 */

// Core services
export {
  SemanticSearchService,
  getSemanticSearchService,
  type SemanticSearchOptions,
  type SemanticSearchResult,
  type FindSimilarOptions,
  type IndexProgress,
  type SemanticServiceStats
} from './semanticSearchService';

export {
  itemIdentityKey,
  parseExcludeLibraryIDs,
  isIndexableLibrary,
  filterIndexableLibraries,
  resolveFindSimilarSource,
} from './libraryScope';

export {
  planSemanticIndex,
  type SemanticIndexPlan,
  type IndexableItemRef,
} from './indexPlan';

export {
  migrateSemanticDbToMultiLibrary,
  hasMultiLibrarySchema,
  type MigrateResult,
} from './migrateMultiLibrary';

// Embedding service
export {
  EmbeddingService,
  getEmbeddingService,
  type EmbeddingResult,
  type BatchEmbeddingItem,
  type EmbeddingConfig,
  type EmbeddingServiceStatus
} from './embeddingService';

// Vector storage
export {
  VectorStore,
  getVectorStore,
  type VectorRecord,
  type QuantizedVector,
  type SearchResult,
  type IndexStatus,
  type VectorStoreStats
} from './vectorStore';

// Text processing
export {
  TextChunker,
  getTextChunker,
  resetTextChunker,
  TextQualityPreprocessor,
  type ChunkerOptions,
  type TextChunk,
  type SemanticChunk
} from './textChunker';
