import { plainStatus, type Evidence, type HumanDocument } from "./retrieval";

export type FolderSummaryInput = { documents: HumanDocument[]; maxChunkCharacters?: number; maxBatchCharacters?: number };

/** Split every non-empty status into bounded, lossless pieces before sending it for summarization. */
export function buildFolderSummaryBatches({ documents, maxChunkCharacters = 4500, maxBatchCharacters = 18000 }: FolderSummaryInput) {
  const chunks: Evidence[] = [];
  let documentsWithContent = 0;
  for (const document of documents) {
    const status = plainStatus(document.status);
    if (!status) continue;
    documentsWithContent++;
    for (let offset = 0; offset < status.length; offset += maxChunkCharacters) {
      chunks.push({ id: document.id, name: document.name, text: status.slice(offset, offset + maxChunkCharacters) });
    }
  }

  const batches: Evidence[][] = [];
  let batch: Evidence[] = [];
  let batchCharacters = 0;
  for (const chunk of chunks) {
    if (batch.length && batchCharacters + chunk.text.length > maxBatchCharacters) {
      batches.push(batch);
      batch = [];
      batchCharacters = 0;
    }
    batch.push(chunk);
    batchCharacters += chunk.text.length;
  }
  if (batch.length) batches.push(batch);

  return { batches, evidence: chunks, documentsWithContent, documentsWithoutContent: documents.length - documentsWithContent };
}
