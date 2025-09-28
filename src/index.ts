import { devLocalIndexerRef, devLocalVectorstore } from '@genkit-ai/dev-local-vectorstore';
import { devLocalRetrieverRef } from '@genkit-ai/dev-local-vectorstore';
import { googleAI } from '@genkit-ai/google-genai';
import { z, genkit } from 'genkit';
import { Document } from 'genkit/retriever';
import { chunk } from 'llm-chunk';
import { readFile } from 'fs/promises';
import { Command } from 'commander'
import figlet from 'figlet';
import path from 'path';
import pdf from 'pdf-parse';


//TODO: add database
//TODO: add commandline parsing
//TODO: support more file types
//TODO: add server
//

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

const indexThoughtsSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('file'),
        filePath: z.string().describe('PDF file path'),
    }),
    z.object({
        type: z.literal('text'),
        data: z.string().describe('raw text to be fed into the rag'),
    })
]);

export const indexThoughts = ai.defineFlow(
  {
    name: 'indexThoughts',
    inputSchema: indexThoughtsSchema,
    outputSchema: z.object({
      success: z.boolean(),
      documentsIndexed: z.number(),
      error: z.string().optional(),
    }),
  },
  async (input) => {
    try {
      let textContent: string;
      let sourceFilePath: string;

      if (input.type === 'file') {
        sourceFilePath = path.resolve(input.filePath);
        textContent = await ai.run('extract-text', () => extractTextFromPdf(sourceFilePath));
      } else {
        textContent = input.data;
        sourceFilePath = 'raw-text-input';
      }

      const chunks = await ai.run('chunk-it', async () => chunk(textContent, chunkingConfig));
      const documents = chunks.map((text) => {
        return Document.fromText(text, { filePath: sourceFilePath });
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
questions about whatever the user asks 

Use only the context provided to answer the question.
If you don't know, do not make up an answer.

Question: ${query}`,
      docs,
    });

    return { answer: text };
  },
);

async function main() {
    console.log(figlet.textSync('GateKeeper', {font: 'ANSI Shadow'}));
    const program = new Command();
    program
        .version('1.0.0')
        .description('A RAG for your own personal knowledge base')
        .option('-a, --ask [query]', 'Query the RAG for info')
        .option('-r, --remember [content]', 'Add content to the RAG model to be queried later')
        .parse(process.argv);
    const options = program.opts();
    if (options.ask) {
        let query = typeof options.ask === 'string' ? options.ask : "What do I do for fun?";
        const retriever = await thoughtsQAFlow({query});
        console.log(retriever.answer);
    }
    if (options.remember) {
        let data = typeof options.remember === 'string' 
            ? options.remember 
            : (() => { 
                console.error("Please provide the data to be remembered after the remember command"); 
                process.exit(1);
            })();;
        const fileExtensions = ['.pdf', '.txt', '.doc', '.docx', '.md', '.json'];
        const hasKnownExtension = fileExtensions.some(ext => 
            data.toLowerCase().endsWith(ext)
        );
        let indexer;
        if (hasKnownExtension) {
            indexer = await indexThoughts({
                type: 'file',
                filePath: data
            });
        } else {
            indexer = await indexThoughts({
                type: 'text',
                data: data
            });
        }
        console.log(indexer);
    }
}

main().catch(console.error);
