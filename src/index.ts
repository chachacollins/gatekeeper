import { devLocalIndexerRef, devLocalVectorstore } from '@genkit-ai/dev-local-vectorstore';
import { devLocalRetrieverRef } from '@genkit-ai/dev-local-vectorstore';
import { googleAI } from '@genkit-ai/google-genai';
import { z, genkit } from 'genkit';
import { Document } from 'genkit/retriever';
import { chunk } from 'llm-chunk';
import { readFile } from 'fs/promises';
import path from 'path';
import pdf from 'pdf-parse';


//TODO: add database
//TODO: add commandline parsing
//TODO: support more file types
//TODO: add server

const ai = genkit({
  plugins: [
    googleAI(),
    devLocalVectorstore([
      {
        indexName: 'thoughtsQA',
        embedder: googleAI.embedder('gemini-embedding-001'),
      },
    ]),
  ],
});

export const thoughtsIndexer = devLocalIndexerRef('thoughtsQA');

const chunkingConfig = {
  minLength: 1000,
  maxLength: 2000,
  splitter: 'sentence',
  overlap: 100,
  delimiters: '',
} as any;


async function extractTextFromPdf(filePath: string) {
  const pdfFile = path.resolve(filePath);
  const dataBuffer = await readFile(pdfFile);
  const data = await pdf(dataBuffer);
  return data.text;
}

export const indexThoughts = ai.defineFlow(
  {
    name: 'indexThoughts',
    inputSchema: z.object({ filePath: z.string().describe('PDF file path') }),
    outputSchema: z.object({
      success: z.boolean(),
      documentsIndexed: z.number(),
      error: z.string().optional(),
    }),
  },
  async ({ filePath }) => {
    try {
      filePath = path.resolve(filePath);

      const pdfTxt = await ai.run('extract-text', () => extractTextFromPdf(filePath));

      const chunks = await ai.run('chunk-it', async () => chunk(pdfTxt, chunkingConfig));

      const documents = chunks.map((text) => {
        return Document.fromText(text, { filePath });
      });

      await ai.index({
        indexer: thoughtsIndexer,
        documents,
      });

      return {
        success: true,
        documentsIndexed: documents.length,
      };
    } catch (err) {
      return {
        success: false,
        documentsIndexed: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
);

export const thoughtsRetriever = devLocalRetrieverRef('thoughtsQA');

export const thoughtsQAFlow = ai.defineFlow(
  {
    name: 'thoughtsQA',
    inputSchema: z.object({ query: z.string() }),
    outputSchema: z.object({ answer: z.string() }),
  },
  async ({ query }) => {
    const docs = await ai.retrieve({
      retriever: thoughtsRetriever,
      query,
      options: { k: 3 },
    });
    const { text } = await ai.generate({
      model: googleAI.model('gemini-2.5-flash'),
      prompt: `
You are acting as a helpful AI assistant that can answer
questions about malloc

Use only the context provided to answer the question.
If you don't know, do not make up an answer.

Question: ${query}`,
      docs,
    });

    return { answer: text };
  },
);

async function main() {
  const indexer = await indexThoughts({
        filePath: "./test.pdf"
  });
  console.log(indexer);
  const retriever = await thoughtsQAFlow({
        query: "What rules does malloc comply with?"
  });
  console.log(retriever.answer);
}

main().catch(console.error);
